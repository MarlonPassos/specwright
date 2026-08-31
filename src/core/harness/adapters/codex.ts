import path from 'node:path';
import { commandName } from '../../workflows/types.js';
import { yamlScalar, type HarnessAdapter } from '../types.js';

/**
 * Codex reads project-scoped instructions as skills, one directory per skill with a
 * SKILL.md inside. Custom prompts, its other mechanism, are loaded only from
 * `$CODEX_HOME/prompts` - a per-user directory outside the project - so a project
 * cannot ship them.
 */
export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  name: 'Codex',
  directory: path.join('.agents', 'skills'),
  envMarkers: ['CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_HOME'],

  filePath(commandId) {
    return path.join('.agents', 'skills', commandName(commandId), 'SKILL.md');
  },

  /** A skill is invoked with `$`, not with the slash every other harness uses. */
  invocation(commandId) {
    return `$${commandName(commandId)}`;
  },

  format(command) {
    return `---
name: ${yamlScalar(commandName(command.id))}
description: ${yamlScalar(command.description)}
---

${command.body}
`;
  },
};
