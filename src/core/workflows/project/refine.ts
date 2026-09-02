import { commandRef, type WorkflowCommand } from '../types.js';
import {
  CLI_NOTE,
  EVIDENCE_LABELS,
  PLAN_WRITE_PROTOCOL,
  PROJECT_BOUNDARY,
  PROJECT_GUARDRAILS,
} from '../shared.js';

const READ_TOOLS = 'Bash(specs:*), Read, Glob, Grep';

export function projectRefineCommand(): WorkflowCommand {
  return {
    id: 'project-refine',
    name: 'Spec Project Refine',
    description: 'Ajusta granularidade: split, merge, renomeação e decisões globais',
    argumentHint: '[um ID, ou a decisão global em texto]',
    allowedTools: READ_TOOLS,
    body: `Ajuste a estrutura do plano: granularidade, split, merge, renomeação de slug ou uma
decisão global. Um esqueleto na Fase 2; o fluxo completo de bundle chega depois.

${CLI_NOTE}

${PROJECT_BOUNDARY}

## Passos

1. \`specs project status --json\` e \`specs project impact --change <id>... --json\`.
2. Separe o **impacto estrutural** (cálculo do core: dependentes, ancestrais,
   milestones, changes vinculadas) do **impacto semântico** (sua recomendação).
3. Proponha split, merge, renomeação ou uma change corretiva nova, com uma tabela
   de rewire explícita de todos os dependentes.
4. Se o impacto atinge um incremento concluído, recomende uma change corretiva
   nova em vez de mutar o histórico.
5. \`specs project apply --dry-run --json\`, confirme, \`specs project apply\`.
6. Feche com \`specs project validate --strict --json\`.

${PLAN_WRITE_PROTOCOL}

${EVIDENCE_LABELS}

Depois de refinar, aponte ${commandRef('project-review')} para revalidar o plano.

${PROJECT_GUARDRAILS}`,
  };
}
