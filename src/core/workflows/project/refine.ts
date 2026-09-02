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
decisão global. Toda mudança passa por um bundle JSON aplicado por \`specs project apply\`.

${CLI_NOTE}

${PROJECT_BOUNDARY}

## Passos

1. \`specs project status --json\` (guarde \`plan.revision\`) e
   \`specs project impact --change <id>... --json\`.
2. Separe o que a CLI devolveu — dependentes, ancestrais, milestones, changes
   vinculadas, capabilities compartilhadas, incrementos concluídos atingidos — como
   **cálculo estrutural**, do seu **impacto semântico** (recomendação): decisão
   arquitetural que contradiz um brief, incremento que deveria ser cancelado,
   risco de migração ou rollout.
3. Escolha a operação:
   - **split**: um incremento grande demais vira dois ou mais. O bundle usa
     \`op: "splitChange"\` com \`into\` e um \`rewire\` que cobre **todos** os
     dependentes do id dividido. O id original fica \`cancelled\` com
     \`superseded_by\` e nunca é reutilizado.
   - **merge**: dois incrementos sobrepostos viram um. \`op: "mergeChanges"\` com
     \`survivor ∈ ids\`; os demais ficam \`cancelled\`. Recusado se qualquer
     entrada estiver concluída.
   - **renameSlug**: preserva o id, renomeia o arquivo do brief e as referências
     na mesma transação.
   - **decisão global**: registre a decisão em \`architecture.md\` via
     \`op: "writeDocument"\` e ajuste os incrementos afetados.
4. Se o impacto atinge um incremento \`archived\`, **não** o altere: recomende uma
   change corretiva nova. Só use \`--allow-completed\` se o usuário pedir
   explicitamente, ciente do \`WARNING\`.
5. Monte o bundle com \`expectRevision\` igual ao \`revision\` lido. Mostre uma
   tabela de rewire explícita.
6. \`specs project apply --dry-run --json\`. Mostre \`idMap\`, o diff e o impacto.
7. Confirme em mensagem separada. Depois do sim, \`specs project apply\`.
8. Feche com \`specs project validate --strict --json\` e aponte
   ${commandRef('project-review')}.

${PLAN_WRITE_PROTOCOL}

${EVIDENCE_LABELS}

${PROJECT_GUARDRAILS}`,
  };
}
