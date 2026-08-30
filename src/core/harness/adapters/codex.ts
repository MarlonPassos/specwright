import path from 'node:path';
import { commandName } from '../../workflows/types.js';
import { yamlScalar, type HarnessAdapter } from '../types.js';

export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  name: 'Codex',
  directory: path.join('.codex', 'prompts'),

  filePath(commandId) {
    return path.join('.codex', 'prompts', `${commandName(commandId)}.md`);
  },

  format(command) {
    return `---
description: ${yamlScalar(command.description)}
argument-hint: ${yamlScalar(command.argumentHint)}
---

${command.body}
`;
  },
};
