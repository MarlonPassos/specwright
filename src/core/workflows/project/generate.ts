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

**O campo \`skeletons\` do dry-run**: todo id ali listado nasce com Escopo e
Critérios macro vazios de propósito (§7.5) — \`generate\` nunca inventa prosa,
só formaliza o que o plano já tem. Isso é esperado para um incremento distante
(guardrail 2) e não é um erro a corrigir agora. Mas para um incremento que o
usuário pretende encarar em seguida, \`generate\` sozinho não basta: mostre o
\`skeletons\` ANTES do sim do passo 4 e pergunte se o conteúdo (Escopo,
Critérios macro) já existe para escrever agora, via \`op: "replacePlannedChange"\`
no mesmo \`specs project bundle-schema --json\` — nesse caso monte esse bundle
em vez de rodar \`generate\` vazio. Sem conteúdo ainda, siga com \`generate\` e
avise que o incremento ficará \`inconsistente\`/bloqueado até alguém preencher
essas seções. \`specs project validate\` depois de gerar um esqueleto vai mesmo
acusar ERROR ali; isso não é um novo problema para investigar, é o mesmo aviso
do dry-run confirmado no disco.

Depois de materializar, aponte ${commandRef('project-next')} para escolher o
próximo incremento.

${PLAN_WRITE_PROTOCOL}

${EVIDENCE_LABELS}

${PROJECT_GUARDRAILS}`,
  };
}
