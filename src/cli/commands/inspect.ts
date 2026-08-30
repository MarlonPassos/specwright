import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Command } from 'commander';
import { SpecError } from '../../util/errors.js';
import { listChangeEntries, listSpecEntries } from '../../core/list.js';
import { resolveItemType, showChange, showSpec } from '../../core/show.js';
import { validateChange } from '../../core/validate/change-validator.js';
import { validateSpecContent } from '../../core/validate/spec-validator.js';
import type { ValidationReport } from '../../core/validate/report.js';
import { listSpecs } from '../../core/specs.js';
import { listArchivedChanges, listChanges, requireWorkspace, type Workspace } from '../../core/workspace.js';
import { fail, printJson, printLines } from '../output.js';

export function registerInspectCommands(program: Command): void {
  program
    .command('list')
    .description('List changes (default) or specs')
    .option('--changes', 'List changes')
    .option('--specs', 'List specs')
    .option('--sort <order>', 'Sort changes by "recent" (default) or "name"', 'recent')
    .option('--json', 'Output as JSON')
    .action(async (options: { changes?: boolean; specs?: boolean; sort?: string; json?: boolean }) => {
      try {
        const workspace = await requireWorkspace();

        if (options.specs) {
          const specs = await listSpecEntries(workspace);
          if (options.json) {
            printJson({ workspace: workspace.root, specs });
            return;
          }
          printLines(
            specs.length === 0
              ? ['No specs yet.']
              : specs.map(
                  (spec) => `  ${spec.capability.padEnd(32)} ${String(spec.requirements).padStart(3)} requirement(s)`
                )
          );
          return;
        }

        const sort = options.sort === 'name' ? 'name' : 'recent';
        const changes = await listChangeEntries(workspace, sort);

        if (options.json) {
          printJson({ workspace: workspace.root, changes });
          return;
        }

        printLines(
          changes.length === 0
            ? ['No active changes.']
            : changes.map((change) => {
                const tasks = change.tasks ? `${change.tasks.completed}/${change.tasks.total}` : '-';
                return `  ${change.id.padEnd(32)} deltas ${String(change.deltas).padStart(2)}  tasks ${tasks}`;
              })
        );
      } catch (error) {
        fail(error, {
          json: options.json,
          payload: options.specs ? { specs: [] } : { changes: [] },
        });
      }
    });

  program
    .command('show [item]')
    .description('Show a change or a spec')
    .option('--type <type>', 'Disambiguate: change or spec')
    .option('--deltas-only', 'Show only the spec deltas of a change')
    .option('--json', 'Output as JSON')
    .action(async (item: string | undefined, options: { type?: string; deltasOnly?: boolean; json?: boolean }) => {
      try {
        const workspace = await requireWorkspace();
        const name = item ?? (await onlyActiveChange(workspace));
        const type = await resolveItemType(workspace, name, options.type);

        if (type === 'spec') {
          const spec = await showSpec(workspace, name);
          if (options.json) {
            printJson(spec);
            return;
          }
          printLines([
            `Spec: ${spec.capability}`,
            '',
            'Purpose:',
            `  ${spec.purpose || '(none)'}`,
            '',
            ...spec.requirements.flatMap((requirement) => [
              `  ${requirement.name}`,
              ...requirement.scenarios.map((scenario) => `    - ${scenario.name}`),
            ]),
          ]);
          return;
        }

        const change = await showChange(workspace, name, { deltasOnly: options.deltasOnly });
        if (options.json) {
          printJson(change);
          return;
        }

        printLines([
          `Change: ${change.id}${change.schema ? `   Schema: ${change.schema}` : ''}`,
          ...(change.proposal ? ['', 'Why:', `  ${change.proposal.why.split('\n').join('\n  ')}`] : []),
          '',
          `Deltas (${change.deltas.length}):`,
          ...change.deltas.map((delta) => `  ${delta.operation.padEnd(9)} ${delta.capability}: ${delta.requirement ?? delta.rename?.from ?? ''}`),
          ...(change.tasks
            ? ['', `Tasks: ${change.tasks.completed}/${change.tasks.total} complete`, ...change.tasks.pending.map((task) => `  [ ] ${task}`)]
            : []),
        ]);
      } catch (error) {
        fail(error, { json: options.json, payload: { item: null } });
      }
    });

  program
    .command('validate [item]')
    .description('Validate a change or a spec')
    .option('--all', 'Validate every change and spec')
    .option('--changes', 'Validate every active change')
    .option('--specs', 'Validate every spec')
    .option('--archived', 'Validate archived changes, requiring every task to be complete')
    .option('--type <type>', 'Disambiguate: change or spec')
    .option('--strict', 'Treat warnings as failures')
    .option('--json', 'Output as JSON')
    .action(async (item: string | undefined, options: { all?: boolean; changes?: boolean; specs?: boolean; archived?: boolean; type?: string; strict?: boolean; json?: boolean }) => {
      try {
        const workspace = await requireWorkspace();
        const strict = options.strict === true;
        const reports: ValidationReport[] = [];

        const wantsBatch = options.all || options.changes || options.specs || options.archived;

        if (wantsBatch) {
          if (options.all || options.changes) {
            for (const id of await listChanges(workspace)) {
              reports.push(await validateChange(workspace, id, { strict }));
            }
          }
          if (options.archived) {
            for (const id of await listArchivedChanges(workspace)) {
              reports.push(
                await validateChange(workspace, id, { strict, requireCompletedTasks: true }, path.join(workspace.archivePath, id))
              );
            }
          }
          if (options.all || options.specs) {
            for (const entry of await listSpecs(workspace)) {
              reports.push(
                validateSpecContent(entry.capability, await fs.readFile(entry.filePath, 'utf8'), { strict })
              );
            }
          }
        } else {
          const name = item ?? (await onlyActiveChange(workspace));
          const type = await resolveItemType(workspace, name, options.type);
          if (type === 'change') {
            reports.push(await validateChange(workspace, name, { strict }));
          } else {
            const entry = (await listSpecs(workspace)).find((candidate) => candidate.capability === name)!;
            reports.push(
              validateSpecContent(name, await fs.readFile(entry.filePath, 'utf8'), { strict })
            );
          }
        }

        const valid = reports.every((report) => report.valid);

        if (options.json) {
          printJson({
            valid,
            strict,
            reports,
            summary: {
              items: reports.length,
              errors: reports.reduce((total, report) => total + report.summary.errors, 0),
              warnings: reports.reduce((total, report) => total + report.summary.warnings, 0),
            },
          });
        } else {
          printLines(formatReports(reports, valid));
        }

        if (!valid) process.exitCode = 1;
      } catch (error) {
        fail(error, { json: options.json, payload: { valid: false, reports: [] } });
      }
    });
}

function formatReports(reports: ValidationReport[], valid: boolean): string[] {
  if (reports.length === 0) return ['Nothing to validate.'];

  const lines: string[] = [];
  for (const report of reports) {
    const verdict = report.valid ? 'ok' : 'FAILED';
    lines.push(`${report.type} ${report.item}: ${verdict}`);
    for (const issue of report.issues) {
      const where = issue.line ? `${issue.path}:${issue.line}` : issue.path;
      lines.push(`  ${issue.level.padEnd(7)} ${where} - ${issue.message}`);
    }
  }
  lines.push('', valid ? 'All checks passed.' : 'Validation failed.');
  return lines;
}

async function onlyActiveChange(workspace: Workspace): Promise<string> {
  const active = await listChanges(workspace);
  if (active.length === 1) return active[0];
  if (active.length === 0) {
    throw new SpecError('No active change', { code: 'no_active_change', fix: 'specs new change <name>' });
  }
  throw new SpecError(`Several active changes: ${active.join(', ')}. Name the one you mean.`, {
    code: 'ambiguous_change',
  });
}
