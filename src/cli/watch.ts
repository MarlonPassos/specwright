/**
 * The watch loop behind `specs status --watch`.
 *
 * Repainting clears nothing up front: each line is written over the one below
 * it, in a single write. Clearing the screen and then drawing leaves the
 * terminal blank between the two steps, and that gap is what reads as a flicker.
 */

const HOME = '\u001b[H';
/** Erases from the cursor to the end of the line, then of the screen. */
const CLEAR_LINE = '\u001b[K';
const CLEAR_BELOW = '\u001b[J';
const HIDE_CURSOR = '\u001b[?25l';
const SHOW_CURSOR = '\u001b[?25h';
const CLEAR_SCREEN = '\u001b[2J';

export interface WatchOptions {
  intervalMs: number;
  /** Renders one frame. Called once per tick. */
  frame: () => Promise<string>;
  /** The command named in the "window too small" line. */
  command?: string;
}

/**
 * Fits a frame to the window. A frame taller than the terminal would scroll the
 * top away, and the next repaint would then start drawing halfway down the
 * previous one. Cutting it is the honest failure.
 */
export function fitFrame(
  text: string,
  rows: number | undefined,
  command = 'specs status'
): string {
  let lines = text.replace(/\n+$/, '').split('\n');
  if (rows && lines.length > rows - 1) {
    const kept = Math.max(rows - 2, 1);
    const hidden = lines.length - kept;
    lines = lines.slice(0, kept);
    lines.push(` … +${hidden} linha(s) — amplie a janela ou rode '${command}'`);
  }
  return HOME + lines.join(CLEAR_LINE + '\n') + CLEAR_LINE + CLEAR_BELOW;
}

export async function watch(options: WatchOptions): Promise<void> {
  const tty = Boolean(process.stdout.isTTY);
  let stopped = false;
  let firstFrame = true;

  // Ctrl+C has to end the loop now; without this it would still sit out the
  // rest of the interval before noticing.
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

  const stop = (): void => {
    stopped = true;
    wake?.();
  };
  const showCursor = (): void => {
    if (tty) process.stdout.write(SHOW_CURSOR);
  };

  process.once('SIGINT', stop);
  if (tty) {
    process.stdout.write(HIDE_CURSOR + CLEAR_SCREEN + HOME);
    process.once('exit', showCursor);
  }

  try {
    while (!stopped) {
      const text = await options.frame();
      if (tty) {
        process.stdout.write(fitFrame(text, process.stdout.rows, options.command));
      } else {
        // Without a terminal there is nothing to repaint over, so the frames
        // stack up as separate snapshots.
        if (!firstFrame) process.stdout.write('\n');
        process.stdout.write(text.endsWith('\n') ? text : text + '\n');
      }
      firstFrame = false;
      if (!stopped) await sleep(options.intervalMs);
    }
  } finally {
    process.off('SIGINT', stop);
    showCursor();
    process.off('exit', showCursor);
  }

  if (tty) process.stdout.write('\nMonitoramento encerrado.\n');
}
