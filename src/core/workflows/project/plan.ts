import { commandRef, type WorkflowCommand } from '../types.js';
import {
  CLI_NOTE,
  EVIDENCE_LABELS,
  PLAN_WRITE_PROTOCOL,
  PROJECT_BOUNDARY,
  PROJECT_GUARDRAILS,
} from '../shared.js';

const READ_TOOLS = 'Bash(specs:*), Read, Glob, Grep';

export function projectPlanCommand(): WorkflowCommand {
  return {
    id: 'project-plan',
    name: 'Spec Project Plan',
    description: 'Analisa documentos-fonte e monta ou atualiza o plano do projeto',
    argumentHint: '[paths de documentos, ou nada]',
    allowedTools: READ_TOOLS,
    body: `Analise os documentos-fonte e proponha um plano de incrementos. Você NÃO implementa e NÃO
cria uma change: o resultado é um Project Plan revisado por uma pessoa.

${CLI_NOTE}

${PROJECT_BOUNDARY}

## Passos

1. \`specs project status --json\`. Se vier \`plan_not_found\`, proponha
   \`specs project create <plan-id> [fontes...]\` e espere o sim.
2. Confirme que cada documento-fonte existe e liste os paths lidos.
3. Leia as fontes em partes. Resuma cada parte com suas palavras — nunca copie
   trechos para o plano.
4. Proponha domínios, incrementos, dependências (por ID), milestones e prioridade.
5. Mostre o resumo, as suposições que fez e as dúvidas críticas que mudam escopo.
6. \`specs project bundle-schema --json\` — o contrato do bundle. Leia antes de
   montar o primeiro; não descubra o formato errando contra \`apply\`.
7. \`specs project apply --dry-run --json\` (bundle com \`expectRevision\`). Um
   plano novo é UM bundle: \`addChange\` com \`ref\` para cada incremento, depois
   \`setMilestones\` citando esses mesmos \`ref\`.
8. Espere a aprovação em uma mensagem separada.
9. \`specs project apply\` sem \`--dry-run\`.
10. \`specs project validate --strict --json\` e reporte.
11. Pare e aponte ${commandRef('project-review')}.

${PLAN_WRITE_PROTOCOL}

${EVIDENCE_LABELS}

${PROJECT_GUARDRAILS}`,
  };
}
