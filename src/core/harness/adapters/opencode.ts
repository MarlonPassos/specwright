import path from 'node:path';
import { commandName } from '../../workflows/types.js';
import { slashInvocation, yamlScalar, type HarnessAdapter } from '../types.js';

const ARGUMENT_PLACEHOLDER = /\$ARGUMENTS\b/;

/**
 * Arguments only reach an OpenCode command through an explicit placeholder, so
 * the body gets one appended. Every other harness passes the user's text
 * automatically, which is why this lives in the adapter rather than in the
 * shared body.
 */
function withArguments(body: string, argumentHint: string): string {
  if (ARGUMENT_PLACEHOLDER.test(body)) return body;
  const label = argumentHint ? `**Input** (${argumentHint})` : '**Input**';
  return `${body}\n\n${label}: $ARGUMENTS\n`;
}

export const opencodeAdapter: HarnessAdapter = {
  id: 'opencode',
  name: 'OpenCode',
  directory: path.join('.opencode', 'commands'),
  envMarkers: ['OPENCODE', 'OPENCODE_BIN_PATH'],

  filePath(commandId) {
    return path.join('.opencode', 'commands', `${commandName(commandId)}.md`);
  },

  invocation: slashInvocation,

  format(command) {
    return `---
description: ${yamlScalar(command.description)}
---

${withArguments(command.body, command.argumentHint)}
`;
  },
};
