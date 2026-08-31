import { SpecError } from '../../util/errors.js';
import { COMMAND_REF_PATTERN, type WorkflowCommand } from '../workflows/types.js';
import { workflowCommandIds } from '../workflows/index.js';
import type { HarnessAdapter } from './types.js';

/**
 * Swaps every `commandRef` placeholder for the way this harness types that
 * command. Every user-facing string goes through here, so a Codex file can never
 * end up telling the user to run a Claude Code slash command.
 */
export function renderCommandRefs(text: string, adapter: HarnessAdapter): string {
  const known = workflowCommandIds();
  return text.replace(COMMAND_REF_PATTERN, (_match, id: string) => {
    if (!known.includes(id)) {
      // A typo here would ship a literal placeholder into a command file, where
      // it reads as an instruction to run something that does not exist.
      throw new SpecError(`Referência a um comando inexistente: ${id}`, {
        code: 'unknown_command_ref',
        fix: `Use um destes ids: ${known.join(', ')}`,
      });
    }
    return adapter.invocation(id);
  });
}

/** One workflow command with every command reference resolved for one harness. */
export function resolveCommand(command: WorkflowCommand, adapter: HarnessAdapter): WorkflowCommand {
  return {
    ...command,
    description: renderCommandRefs(command.description, adapter),
    argumentHint: renderCommandRefs(command.argumentHint, adapter),
    body: renderCommandRefs(command.body, adapter),
  };
}
