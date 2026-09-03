import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { SpecError } from '../../util/errors.js';
import { requireWorkspace } from '../../core/workspace.js';
import { startServer, DEFAULT_PORT } from '../../server/serve.js';
import { fail, printLines } from '../output.js';

function port(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new SpecError(`"${raw}" não é uma porta válida.`, { code: 'invalid_port' });
  }
  return value;
}

/** Opens the default browser, best effort: failing to open is not failing to serve. */
function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    child.on('error', () => {
      /* no browser, or no desktop session: the URL is printed anyway */
    });
    child.unref();
  } catch {
    /* same */
  }
}

export function registerServeCommand(program: Command): void {
  program
    .command('serve [plan-id]')
    .description('Sobe o painel do projeto no navegador, em leitura pura')
    .option('--port <n>', `Porta (padrão ${DEFAULT_PORT})`)
    .option('--host <endereço>', 'Endereço de escuta (padrão 127.0.0.1)')
    .option('--no-open', 'Não abre o navegador')
    .action(async function (
      this: Command,
      planId: string | undefined,
      options: { port?: string; host?: string; open?: boolean }
    ) {
      try {
        const workspace = await requireWorkspace();
        const server = await startServer(workspace, {
          port: port(options.port),
          ...(options.host ? { host: options.host } : {}),
          ...(planId ? { planId } : {}),
        });

        printLines([
          `Painel em ${server.url}`,
          `  observando: ${server.watching.length > 0 ? server.watching.join(', ') : '(nada ainda)'}`,
          '  somente leitura — nenhuma rota escreve no projeto',
          '  Ctrl+C encerra',
        ]);

        if (options.open !== false) openBrowser(server.url);

        await new Promise<void>((resolve) => {
          const stop = (): void => {
            process.off('SIGINT', stop);
            process.off('SIGTERM', stop);
            resolve();
          };
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
        });

        await server.close();
        printLines(['', 'Painel encerrado.']);
      } catch (error) {
        fail(error, { json: false });
      }
    });
}
