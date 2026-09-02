import { commandRef, type WorkflowCommand } from '../types.js';
import {
  CLI_NOTE,
  EVIDENCE_LABELS,
  PLAN_WRITE_PROTOCOL,
  PROJECT_BOUNDARY,
  PROJECT_GUARDRAILS,
} from '../shared.js';

export function projectGenerateCommand(): WorkflowCommand {
  return {
    id: 'project-generate',
    name: 'Spec Project Generate',
    description: 'Materializa os Planned Changes dos incrementos aprovados',
    argumentHint: '[--milestone <id> | --change <id>...]',
    allowedTools: 'Bash(specs:*), Read',
    body: `Materialize os Planned Changes selecionados. Uma edição humana em um brief NUNCA é
sobrescrita sem decisão explícita da pessoa.

${CLI_NOTE}

${PROJECT_BOUNDARY}

## Passos

1. \`specs project status --json\` para confirmar o que está aprovado e a revisão.
2. \`specs project generate --milestone <id> --dry-run --json\` (ou \`--change <id>\`).
3. Mostre o que seria gravado, o que seria pulado e os conflitos.
4. Espere o sim em uma mensagem separada.
5. \`specs project generate\` sem \`--dry-run\`.
6. \`specs project validate --strict --json\` e reporte.

Se vier \`planned_change_modified\`, mostre \`recordedContentHash\` e
\`currentContentHash\`, explique o conflito e PARE. Não use \`--force\` sem o usuário pedir.

Depois de materializar, aponte ${commandRef('project-next')} para escolher o
próximo incremento.

${PLAN_WRITE_PROTOCOL}

${EVIDENCE_LABELS}

${PROJECT_GUARDRAILS}`,
  };
}
