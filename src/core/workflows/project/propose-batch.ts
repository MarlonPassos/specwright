import { commandRef, type WorkflowCommand } from '../types.js';
import { CLI_NOTE, EVIDENCE_LABELS, PROJECT_BOUNDARY, PROJECT_GUARDRAILS } from '../shared.js';

export function projectProposeBatchCommand(): WorkflowCommand {
  return {
    id: 'project-propose-batch',
    name: 'Spec Project Propose Batch',
    description: 'Explora e propõe em paralelo os incrementos que não dependem uns dos outros',
    argumentHint: '[nada, ou os IDs a incluir]',
    allowedTools: 'Bash(specs:*), Read',
    body: `Proponha em lote os incrementos que o plano libera ao mesmo tempo. Um subagente por
incremento, todos na mesma onda; a onda seguinte só existe depois que esta fechar.

${CLI_NOTE}

${PROJECT_BOUNDARY}

## Quando este comando NÃO é o certo

\`specs project next --json\` devolve \`proposeBatch\`. Pare e diga qual destes é o caso,
em vez de seguir:

- \`enabled: false\` — o workspace não optou (\`parallelPropose\` em \`spec/config.yaml\`),
  o harness não sabe despachar subagente em paralelo, ou você está dentro de um worktree
  isolado. Siga o fluxo normal, um incremento por vez.
- \`batch\` com 0 ou 1 incremento — não há o que paralelizar. Um lote de um é o fluxo
  de sempre: aponte ${commandRef('explore')} ou ${commandRef('propose')} e pare.

## Passos

1. \`specs project next --json\`. Trabalhe só com \`proposeBatch.batch\`; \`excluded\`
   explica quem ficou de fora e por quê (\`depends_on_not_proposed:<ids>\` é o caso
   normal — aquele incremento entra numa onda futura).
2. Mostre o lote ao usuário: id, título, slug e o \`plannedChange\` de cada um. Faça UMA
   pergunta de sim ou não e espere a confirmação em uma mensagem separada. Se o usuário
   quiser um subconjunto, respeite exatamente o que ele listou.
3. Depois do sim, para cada incremento do lote: \`specs new change <slug>\`.
4. Dispare **um subagente por incremento, todos na mesma mensagem** — chamadas
   independentes de uma vez, nunca uma esperando a outra. Cada subagente recebe:
   - o slug da change dele e o caminho do Planned Change como **contexto de leitura**
     (nunca para copiar para dentro de um artefato);
   - a ordem de percorrer ${commandRef('explore')}, ${commandRef('propose')} e
     ${commandRef('continue')} até a change ter proposta, design, deltas e tarefas;
   - a regra que vale para todo subagente deste lote: **ao bater numa decisão que muda
     escopo, PARE e devolva a pergunta** — não escolha por conta própria. Registrar a
     dúvida em \`Riscos\` ou \`Notas para exploração\` vale para incerteza; uma decisão de
     escopo volta para o usuário.
   - a fronteira: cada subagente escreve **apenas** dentro de \`spec/changes/<slug>/\`.
     Nada de \`plan.yaml\`, nada de \`specs project\`, nada no diretório de outro.
5. Espere todos voltarem. Junte as perguntas que os subagentes devolveram e leve TODAS
   ao usuário de uma vez — não responda por ele. Um incremento cuja pergunta ficou aberta
   não conta como proposto.
6. Para cada incremento que fechou de verdade:
   \`specs project link <CH-NNN> <slug>\`, e confira com
   \`specs status --change <slug> --json\` que \`applyBlockedBy\` está vazio.
7. Rode \`specs project next --json\` de novo. Se \`proposeBatch.batch\` trouxer uma onda
   nova (os incrementos que estes acabaram de desbloquear), volte ao passo 2. Quando vier
   vazio ou com um só, pare e aponte ${commandRef('project-next')}.

**Nunca** rode ${commandRef('implement')} daqui: propor e implementar são lotes diferentes, com
critérios de segurança diferentes. Depois desta esteira, é \`implementBatch\` (o outro
campo do mesmo \`specs project next --json\`) que diz o que dá para implementar em
paralelo.

${EVIDENCE_LABELS}

${PROJECT_GUARDRAILS}`,
  };
}
