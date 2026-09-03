import { fitFrame, watch } from './watch.js';
import { pad, themeFor, type Theme, type ViewOptions } from './theme.js';

const HIDE_CURSOR = '\u001b[?25l';
const SHOW_CURSOR = '\u001b[?25h';
const CLEAR_SCREEN = '\u001b[2J';
const HOME = '\u001b[H';

export interface Tab {
  /** Stable key, used by the entry points to pick the initial tab. */
  id: string;
  label: string;
  /** Renders this tab. Called only while it is the active one. */
  frame: () => Promise<string>;
  /** Command named in the "window too small" line and in an error frame. */
  command: string;
}

/**
 * The streams the controller drives. Narrowed to what it actually touches so a
 * test can hand it a pair of in-memory streams instead of a pseudo-TTY — which
 * is the whole reason this is a parameter and not `process.stdin` inline.
 */
export interface TuiStreams {
  input: Pick<NodeJS.ReadStream, 'on' | 'off' | 'resume' | 'pause' | 'setEncoding'> & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => unknown;
  };
  output: Pick<NodeJS.WriteStream, 'write'> & { isTTY?: boolean; rows?: number; columns?: number };
}

export interface TabbedWatchOptions {
  tabs: Tab[];
  /** `id` of the tab to open on. Falls back to the first tab. */
  initial: string;
  intervalMs: number;
  view: ViewOptions;
  streams?: TuiStreams;
}

type Action = { kind: 'next' } | { kind: 'prev' } | { kind: 'goto'; index: number } | { kind: 'redraw' } | { kind: 'quit' };

/**
 * Maps one chunk of raw-mode input to an action.
 *
 * The chunk boundary is what disambiguates a bare Esc from an arrow key: a
 * terminal delivers `ESC` alone as one chunk and `ESC [ C` as another. Reading
 * byte by byte would need a timer to tell them apart; reading the chunk does not.
 */
export function actionFor(chunk: string): Action | undefined {
  switch (chunk) {
    case '\t':
    case '\u001b[C':
      return { kind: 'next' };
    case '\u001b[Z':
    case '\u001b[D':
      return { kind: 'prev' };
    case 'r':
    case 'R':
      return { kind: 'redraw' };
    case 'q':
    case 'Q':
    case '\u001b':
    // Ctrl+C does not raise SIGINT while the terminal is in raw mode, so the
    // byte has to be handled here or the panel would be unquittable.
    case '\u0003':
      return { kind: 'quit' };
    default: {
      if (/^[1-9]$/.test(chunk)) return { kind: 'goto', index: Number(chunk) - 1 };
      return undefined;
    }
  }
}

/** ` [1] RESUMO   2 CHANGES   3 PLANO            Tab ↹  r recarrega  q sai` */
export function tabBar(tabs: Tab[], active: number, theme: Theme, width: number): string {
  const cells = tabs.map((tab, index) => {
    const key = String(index + 1);
    if (index === active) {
      return theme.bold + theme.cyan + '[' + key + '] ' + tab.label + theme.off;
    }
    return theme.dim + key + ' ' + tab.label + theme.off;
  });

  const left = ' ' + cells.join('   ');
  const hint = 'Tab troca  ·  r recarrega  ·  q sai';
  // The visible length ignores the escapes, which never occupy a column.
  const visible = 1 + tabs.reduce((sum, tab, index) => sum + tab.label.length + (index === active ? 4 : 2), 0) +
    (tabs.length - 1) * 3;
  const gap = width - visible - hint.length - 1;
  return gap > 2 ? left + ' '.repeat(gap) + theme.dim + hint + theme.off : left;
}

/**
 * The panel loop with a keyboard on top of it.
 *
 * Only the active tab is collected: switching is what pays for the new tab's
 * I/O, so an invisible tab costs nothing per tick. Anything that is not a real
 * terminal — a pipe, CI, a `setRawMode` that is missing or throws — falls back
 * to `watch()`, the loop that has always been there, on the initial tab.
 */
export async function runTabbedWatch(options: TabbedWatchOptions): Promise<void> {
  const streams: TuiStreams = options.streams ?? { input: process.stdin, output: process.stdout };
  const tabs = options.tabs;
  if (tabs.length === 0) throw new Error('runTabbedWatch precisa de ao menos uma aba');

  let active = Math.max(tabs.findIndex((tab) => tab.id === options.initial), 0);

  const interactive =
    tabs.length > 1 &&
    Boolean(streams.output.isTTY) &&
    Boolean(streams.input.isTTY) &&
    typeof streams.input.setRawMode === 'function';

  if (!interactive) {
    // One tab, or nowhere to read keys from: this is exactly the old command.
    await watch({
      intervalMs: options.intervalMs,
      command: tabs[active].command,
      frame: () => safeFrame(tabs[active]),
    });
    return;
  }

  let stopped = false;
  let wake: (() => void) | undefined;
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = undefined;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
    });

  const onKey = (chunk: string): void => {
    const action = actionFor(chunk);
    if (!action) return;
    switch (action.kind) {
      case 'quit':
        stopped = true;
        break;
      case 'next':
        active = (active + 1) % tabs.length;
        break;
      case 'prev':
        active = (active - 1 + tabs.length) % tabs.length;
        break;
      case 'goto':
        if (action.index >= tabs.length) return;
        active = action.index;
        break;
      case 'redraw':
        break;
    }
    // Every recognised key repaints now. Waiting out the interval would make a
    // tab switch feel broken on anything but the shortest one.
    wake?.();
  };

  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    streams.input.off('data', onKey);
    try {
      streams.input.setRawMode?.(false);
    } catch {
      // Nothing to do: the terminal is already gone.
    }
    streams.input.pause();
    streams.output.write(SHOW_CURSOR);
  };

  const onSigint = (): void => {
    stopped = true;
    wake?.();
  };

  try {
    streams.input.setRawMode?.(true);
    streams.input.resume();
    streams.input.setEncoding('utf8');
    streams.input.on('data', onKey);
    process.once('SIGINT', onSigint);
    process.once('exit', restore);
    streams.output.write(HIDE_CURSOR + CLEAR_SCREEN + HOME);

    while (!stopped) {
      const tab = tabs[active];
      const body = await safeFrame(tab);
      const bar = tabBar(tabs, active, themeFor(options.view), streams.output.columns ?? options.view.width);
      streams.output.write(fitFrame(withBar(body, bar), streams.output.rows, tab.command));
      if (!stopped) await sleep(options.intervalMs);
    }
  } finally {
    process.off('SIGINT', onSigint);
    process.off('exit', restore);
    restore();
  }

  streams.output.write('\nMonitoramento encerrado.\n');
}

/**
 * The bar goes under the header, not above it: the wordmark is what tells the
 * reader which tool they are looking at, and it has to survive being the first
 * thing on screen.
 */
function withBar(body: string, bar: string): string {
  const lines = body.replace(/\n+$/, '').split('\n');
  const header = lines.findIndex((line, index) => index > 0 && line.trim() === '');
  const at = header === -1 ? lines.length : header;
  return [...lines.slice(0, at), '', bar, ...lines.slice(at)].join('\n');
}

/** A tab that cannot be collected reports it inside its own frame (FR-T12). */
async function safeFrame(tab: Tab): Promise<string> {
  try {
    return await tab.frame();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return ['', ' ' + pad(tab.label, 12), '', ' ' + message, '', ` Rode '${tab.command}' para o detalhe.`, ''].join('\n');
  }
}
