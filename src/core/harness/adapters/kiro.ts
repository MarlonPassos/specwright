import path from 'node:path';
import { commandName } from '../../workflows/types.js';
import { yamlScalar, type HarnessAdapter } from '../types.js';

export const kiroAdapter: HarnessAdapter = {
  id: 'kiro',
  name: 'Kiro',
  directory: path.join('.kiro', 'prompts'),

  filePath(commandId) {
    return path.join('.kiro', 'prompts', `${commandName(commandId)}.prompt.md`);
  },

  format(command) {
    return `---
description: ${yamlScalar(command.description)}
---

${command.body}
`;
  },
};
