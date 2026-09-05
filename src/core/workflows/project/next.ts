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

6. **Se \`implementBatch.batch\` tiver mais de um incremento**: essas changes já estão
   propostas (proposal/design/tasks/deltas escritos — confirmado contra o status
   nativo da change, não só contra o \`execution\` do plano) e não compartilham
   nenhuma capability entre si — cálculo, não suposição sua. São candidatas a
   rodar ${commandRef('implement')} em paralelo, uma por worktree:

   a. Cada entrada do lote tem \`id\` (o incremento, CH-NNN) e \`link\` (o slug
      real da change). **Use sempre \`link\` nos comandos abaixo, nunca \`id\`** —
      podem divergir, e \`--change\` só aceita o slug.
   b. Para cada uma, \`specs worktree create --change <link> --whole-change --json\`
      (isola a change inteira, não uma tarefa — \`--whole-change\` é obrigatório
      aqui, não é o padrão ao omitir \`--task\`).
   c. Dispare um subagente por change do lote **na mesma mensagem**, cada um
      trabalhando só dentro do \`path\` do worktree dele, seguindo
      ${commandRef('implement')} (e, se quiser, ${commandRef('verify')}) até o fim.
      Dentro desse worktree, \`parallelDispatch.supported\` vem sempre \`false\`
      mesmo que a change tenha \`parallel: true\` — dispatch por tarefa exige a
      árvore principal, e o subagente já está isolado numa árvore que não é
      ela; ele segue o passo 4 (checklist sequencial) normalmente. Nenhum
      subagente roda \`specs worktree finish\` — isso é sempre você, depois.
   d. Espere todos voltarem. Para cada sucesso real (não "reportou sucesso" —
      commit de verdade), **em sequência, uma de cada vez**:
      \`specs worktree finish --change <link> --whole-change --json\`.
      \`conflict: true\` → pare, aponte \`path\`/\`branch\`, a resolução é manual na
      árvore principal; só depois
      \`specs worktree resume --change <link> --whole-change --json\`.
   e. \`specs archive\` de cada change continua manual, uma de cada vez, depois do
      merge — arquivamento nunca entra no lote.

   Uma change em \`excluded\` com \`capability_conflict:<nome>\` não é bug: ela
   disputa a mesma capability de outra já escolhida pro lote (a de maior
   prioridade venceu). Rode-a depois, sozinha. \`implement_blocked:<...>\` também
   não é bug — a change ainda não tem os artefatos que ${commandRef('implement')}
   precisa; trate como \`excluded\` normal, aponte ${commandRef('propose')}.

${EVIDENCE_LABELS}

${PROJECT_GUARDRAILS}`,
  };
}
