import path from 'node:path';
import { commandName } from '../../workflows/types.js';
import { slashInvocation, yamlScalar, type HarnessAdapter } from '../types.js';

/** Commands the generated files are allowed to run without a fresh prompt. */
export const ALLOWED_TOOLS = 'Bash(specs:*)';

export const claudeAdapter: HarnessAdapter = {
  id: 'claude',
  name: 'Claude Code',
  directory: path.join('.claude', 'commands'),
  envMarkers: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'],
  supportsParallelDispatch: true,
  parallelDispatchPrimitive: 'Task',

  filePath(commandId) {
    return path.join('.claude', 'commands', `${commandName(commandId)}.md`);
  },

  invocation: slashInvocation,

  format(command) {
    return `---
name: ${yamlScalar(commandName(command.id))}
description: ${yamlScalar(command.description)}
argument-hint: ${yamlScalar(command.argumentHint)}
allowed-tools: ${command.allowedTools ?? ALLOWED_TOOLS}
---

${command.body}
`;
  },
};
