import { describe, expect, it } from 'vitest';
import { actionFor, runTabbedWatch, tabBar, type Tab, type TuiStreams } from '../../src/cli/tui.js';
import { PLAIN } from '../../src/cli/theme.js';

const ESC = String.fromCharCode(27);
const VIEW = { color: false, width: 100 };

/**
 * Streams de mentira. É por causa deste par que o controlador recebe `streams`
 * em vez de usar `process.stdin`: um pseudo-TTY real era a condição que fez a
 * especificação adiar este item, e aqui ele não é necessário.
 */
function fakeStreams(): {
  streams: TuiStreams;
  written: string[];
  send: (chunk: string) => void;
  rawMode: () => boolean | undefined;
  listeners: () => number;
} {
  const handlers = new Set<(chunk: string) => void>();
  const written: string[] = [];
  let raw: boolean | undefined;

  const input = {
    isTTY: true,
    setRawMode: (mode: boolean) => {
      raw = mode;
    },
    on(event: string, handler: (chunk: string) => void) {
      if (event === 'data') handlers.add(handler);
      return this;
    },
    off(event: string, handler: (chunk: string) => void) {
      if (event === 'data') handlers.delete(handler);
      return this;
    },
    resume() {
      return this;
    },
    pause() {
      return this;
    },
    setEncoding() {
      return this;
    },
  };

  const output = {
    isTTY: true,
    rows: 40,
    columns: 100,
    write: (chunk: string) => {
      written.push(chunk);
      return true;
    },
  };

  return {
    streams: { input, output } as unknown as TuiStreams,
    written,
    send: (chunk) => {
      for (const handler of [...handlers]) handler(chunk);
    },
    rawMode: () => raw,
    listeners: () => handlers.size,
  };
}

/**
 * Cada quadro agenda a próxima tecla. Isso torna o teste determinístico e, de
 * quebra, prova FR-T05: o intervalo é de um segundo e o teste termina em
 * milissegundos, então a repintura veio da tecla, não do relógio.
 */
function scriptedTabs(ids: string[], keys: string[], seen: string[]): Tab[] {
  const pending = [...keys];
  let send: ((chunk: string) => void) | undefined;
  const tabs = ids.map((id) => ({
    id,
    label: id.toUpperCase(),
    command: `specs ${id}`,
    frame: async () => {
      seen.push(id);
      const key = pending.shift();
      if (key !== undefined) setTimeout(() => send?.(key), 0);
      return `${id}\n\ncorpo de ${id}`;
    },
  }));
  return Object.assign(tabs, {
    bind(fn: (chunk: string) => void) {
      send = fn;
    },
  });
}

describe('actionFor', () => {
  it('mapeia cada tecla do contrato', () => {
    expect(actionFor('\t')).toEqual({ kind: 'next' });
    expect(actionFor(ESC + '[C')).toEqual({ kind: 'next' });
    expect(actionFor(ESC + '[Z')).toEqual({ kind: 'prev' });
    expect(actionFor(ESC + '[D')).toEqual({ kind: 'prev' });
    expect(actionFor('3')).toEqual({ kind: 'goto', index: 2 });
    expect(actionFor('r')).toEqual({ kind: 'redraw' });
    expect(actionFor('q')).toEqual({ kind: 'quit' });
    // Em modo raw o Ctrl+C não vira SIGINT; sem este caso o painel não sairia.
    expect(actionFor(String.fromCharCode(3))).toEqual({ kind: 'quit' });
    expect(actionFor(ESC)).toEqual({ kind: 'quit' });
  });

  it('ignora o que não reconhece, e distingue Esc de seta pelo chunk', () => {
    expect(actionFor('x')).toBeUndefined();
    expect(actionFor('0')).toBeUndefined();
    expect(actionFor(ESC + '[A')).toBeUndefined();
    // O mesmo primeiro byte, ações diferentes: é o chunk que decide.
    expect(actionFor(ESC)).not.toEqual(actionFor(ESC + '[C'));
  });
});

describe('tabBar', () => {
  const tabs = [
    { id: 'a', label: 'RESUMO' },
    { id: 'b', label: 'CHANGES' },
    { id: 'c', label: 'PLANO' },
  ] as Tab[];

  it('marca a ativa com colchete, não só com cor', () => {
    const bar = tabBar(tabs, 0, PLAIN, 100);
    expect(bar).toContain('[1] RESUMO');
    expect(bar).toContain('2 CHANGES');
    expect(bar).toContain('3 PLANO');
    expect(bar).toContain('q sai');
  });

  it('some com a dica quando não há largura para ela', () => {
    expect(tabBar(tabs, 1, PLAIN, 40)).not.toContain('q sai');
    expect(tabBar(tabs, 1, PLAIN, 40)).toContain('[2] CHANGES');
  });
});

describe('runTabbedWatch', () => {
  it('troca de aba na tecla e sai no q, restaurando o terminal', async () => {
    const fake = fakeStreams();
    const seen: string[] = [];
    const tabs = scriptedTabs(['overview', 'changes', 'plan'], ['\t', '3', 'q'], seen);
    (tabs as unknown as { bind: (fn: (chunk: string) => void) => void }).bind(fake.send);

    await runTabbedWatch({
      tabs,
      initial: 'overview',
      intervalMs: 1000,
      view: VIEW,
      streams: fake.streams,
    });

    expect(seen).toEqual(['overview', 'changes', 'plan']);
    expect(fake.rawMode()).toBe(false);
    expect(fake.listeners()).toBe(0);
    expect(fake.written.join('')).toContain(ESC + '[?25h');
    expect(fake.written.join('')).toContain('Monitoramento encerrado.');
  });

  it('abre na aba pedida e volta com Shift+Tab', async () => {
    const fake = fakeStreams();
    const seen: string[] = [];
    const tabs = scriptedTabs(['overview', 'changes', 'plan'], [ESC + '[Z', 'q'], seen);
    (tabs as unknown as { bind: (fn: (chunk: string) => void) => void }).bind(fake.send);

    await runTabbedWatch({
      tabs,
      initial: 'changes',
      intervalMs: 1000,
      view: VIEW,
      streams: fake.streams,
    });

    expect(seen).toEqual(['changes', 'overview']);
  });

  it('desenha a barra de abas dentro do quadro', async () => {
    const fake = fakeStreams();
    const seen: string[] = [];
    const tabs = scriptedTabs(['overview', 'changes'], ['q'], seen);
    (tabs as unknown as { bind: (fn: (chunk: string) => void) => void }).bind(fake.send);

    await runTabbedWatch({ tabs, initial: 'overview', intervalMs: 1000, view: VIEW, streams: fake.streams });

    expect(fake.written.join('')).toContain('[1] OVERVIEW');
  });

  it('uma aba que falha reporta dentro dela, sem derrubar as outras', async () => {
    const fake = fakeStreams();
    const seen: string[] = [];
    const pending = ['\t', 'q'];
    const tabs: Tab[] = [
      {
        id: 'plan',
        label: 'PLANO',
        command: 'specs project',
        frame: async () => {
          seen.push('plan');
          setTimeout(() => fake.send(pending.shift()!), 0);
          throw new Error('plan.yaml inválido');
        },
      },
      {
        id: 'changes',
        label: 'CHANGES',
        command: 'specs status',
        frame: async () => {
          seen.push('changes');
          setTimeout(() => fake.send(pending.shift()!), 0);
          return 'ok\n\ncorpo';
        },
      },
    ];

    await runTabbedWatch({ tabs, initial: 'plan', intervalMs: 1000, view: VIEW, streams: fake.streams });

    const text = fake.written.join('');
    expect(text).toContain('plan.yaml inválido');
    expect(text).toContain("Rode 'specs project'");
    // O loop sobreviveu à falha e chegou na outra aba.
    expect(seen).toEqual(['plan', 'changes']);
  });

  it('ignora um dígito além do número de abas', async () => {
    const fake = fakeStreams();
    const seen: string[] = [];
    const tabs = scriptedTabs(['overview', 'changes'], ['9', 'q'], seen);
    (tabs as unknown as { bind: (fn: (chunk: string) => void) => void }).bind(fake.send);

    // Intervalo curto de propósito: um dígito fora de alcance é ignorado por
    // inteiro, então esta é a única repintura que vem do relógio.
    await runTabbedWatch({ tabs, initial: 'overview', intervalMs: 20, view: VIEW, streams: fake.streams });

    expect(seen).toEqual(['overview', 'overview']);
  });
});
