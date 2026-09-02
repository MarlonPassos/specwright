import { commandRef, type WorkflowCommand } from '../types.js';
import { CLI_NOTE, EVIDENCE_LABELS, PROJECT_BOUNDARY, PROJECT_GUARDRAILS } from '../shared.js';

export function projectNextCommand(): WorkflowCommand {
  return {
    id: 'project-next',
    name: 'Spec Project Next',
    description: 'Recomenda o próximo incremento e faz o handoff para o ciclo de change',
    argumentHint: '[um ID, ou nada]',
    allowedTools: 'Bash(specs:*), Read',
    body: `Recomende o próximo incremento e prepare o handoff. Nenhuma escrita.

${CLI_NOTE}

${PROJECT_BOUNDARY}

## Passos

1. \`specs project next --json\`. Se o usuário citou um ID, \`specs project show <id> --json\` também.
2. Explique a recomendação usando os \`reasonCodes\` devolvidos (cálculo), e por que
   cada incremento em \`excluded\` ficou de fora.
3. Mostre o Planned Change recomendado como **contexto** para a exploração — não o
   copie para dentro de nenhum artefato.
4. Aponte ${commandRef('explore')} ou ${commandRef('propose')} para abrir a change,
   com o nome de slug sugerido em \`startWith\`.
5. Lembre o usuário de rodar \`specs project link <change-id> <change-name>\` depois
   que a change existir.

${EVIDENCE_LABELS}

${PROJECT_GUARDRAILS}`,
  };
}
