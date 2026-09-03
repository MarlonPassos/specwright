import type { Command } from 'commander';
import { SpecError } from '../../util/errors.js';
import { buildOverview } from '../../core/overview.js';
import { requireWorkspace } from '../../core/workspace.js';
import { OVERVIEW_TAB, buildTabs, runPanel } from '../panel.js';
import type { ViewOptions } from '../theme.js';
import { fail, printJson } from '../output.js';

export const OVERVIEW_SCHEMA_VERSION = 1;

function intervalMs(raw: string | undefined): number {
  const seconds = Number(raw ?? '2');
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new SpecError(`"${raw}" não é um intervalo válido. Use um número de segundos maior que zero.`, {
      code: 'invalid_interval',
    });
  }
  return Math.round(seconds * 1000);
}

function viewOptions(command: Command): ViewOptions {
  const noColor = command.opts().color === false;
  return {
    color: !noColor && !process.env.NO_COLOR && Boolean(process.stdout.isTTY),
    width: process.stdout.columns ?? 80,
  };
}

export function registerWatchCommands(program: Command): void {
  program
    .command('watch [plan-id]')
    .description('Painel único: RESUMO, CHANGES e PLANO, trocados por Tab ou 1/2/3')
    .option('--interval <segundos>', 'Intervalo de repintura em segundos', '2')
    .option('--once', 'Desenha um quadro e sai, sem entrar no loop')
    .option('--json', 'Publica a projeção combinada e sai')
    .option('--no-color', 'Desenha o painel sem cor nem glifos Unicode')
    .action(async function (
      this: Command,
      planId: string | undefined,
      options: { interval?: string; once?: boolean; json?: boolean; color?: boolean }
    ) {
      try {
        if (options.json && options.once) {
          throw new SpecError('--json e --once são mutuamente exclusivos.', {
            code: 'invalid_option',
            fix: 'specs watch --json',
          });
        }

        const workspace = await requireWorkspace();

        if (options.json) {
          const data = await buildOverview(workspace, { planId });
          printJson({
            ...data,
            overviewSchemaVersion: OVERVIEW_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
          });
          return;
        }

        const view = viewOptions(this);

        if (options.once) {
          // One frame of the tab this command opens on. Without a plan the
          // overview tab does not exist, so the first tab is what gets drawn.
          const tabs = await buildTabs(workspace, view, planId);
          const tab = tabs.find((entry) => entry.id === OVERVIEW_TAB) ?? tabs[0];
          process.stdout.write(await tab.frame());
          return;
        }

        await runPanel(workspace, {
          initial: OVERVIEW_TAB,
          intervalMs: intervalMs(options.interval),
          view,
          planId,
        });
      } catch (error) {
        fail(error, { json: options.json, payload: { overview: null } });
      }
    });
}
