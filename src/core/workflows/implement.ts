import { commandRef, type WorkflowCommand } from './types.js';
import { CLI_NOTE, RESOLVE_CHANGE } from './shared.js';

export function implementCommand(): WorkflowCommand {
  return {
    id: 'implement',
    name: 'Spec Implement',
    description: 'Implementa uma change já planejada, percorrendo o checklist de tarefas dela',
    argumentHint: '[nome-da-change]',
    body: `Implemente uma change que já foi planejada.

${CLI_NOTE}

${RESOLVE_CHANGE}

**Passos**

1. **Confirme que a change está pronta**

   \`\`\`bash
   specs status --change "<change>" --json
   \`\`\`
   Se \`applyBlockedBy\` não estiver vazio, pare e diga ao usuário para rodar \`${commandRef('continue')}\` antes.

2. **Carregue as instruções da fase**

   \`\`\`bash
   specs instructions implement --change "<change>" --json
   \`\`\`
   A resposta carrega a orientação de implementação do schema, o arquivo cujos checkboxes
   acompanham o progresso (\`tracks\`), a contagem atual de tarefas, o \`changeRoot\` resolvido, e
   \`parallelDispatch.supported\`.

2b. **Se \`parallelDispatch.supported\` for \`true\`**, siga em lotes isolados por worktree em vez
    de tarefa por tarefa:

    a. \`specs tasks ready --change "<change>" --json\` — pega o próximo lote de tarefas prontas.
    b. Para cada tarefa do lote: \`specs worktree create --change "<change>" --task "<numero>" --json\`
       — anote o \`path\` devolvido.
    c. Dispare um subagente por tarefa do lote **na mesma mensagem** (chamadas independentes de
       uma vez, nunca uma esperando a outra). Cada subagente recebe: o \`path\` do worktree dele,
       o texto da tarefa, a delta spec relevante como critério de aceite, e a instrução de
       trabalhar **dentro daquele diretório** — implementar, rodar a verificação da tarefa, e
       \`git commit\` o resultado ali. Nenhum subagente toca em \`tasks.md\`, roda
       \`specs tasks complete\` ou \`specs worktree finish\` — isso é sempre você, no passo (e).
    d. Espere todos os subagentes do lote retornarem. Para cada um, classifique o desfecho:
       - **Sucesso com commit real**: a verificação passou e o subagente reporta ter commitado.
         Vai para (e).
       - **Falha explícita**: o subagente reporta que não conseguiu, ou a verificação falhou.
         Não chame \`finish\`. O worktree fica \`active\`. Reporte ao usuário qual tarefa falhou e o
         \`path\` do worktree, e pergunte se quer tentar de novo ou abandonar
         (\`specs worktree cleanup --change "<change>" --task "<numero>" --force\`, só com
         confirmação explícita do usuário — nunca chame \`--force\` sozinho).
       - **Sucesso reportado sem commit real**: trate como falha explícita. Nunca chame \`finish\`
         sobre um branch sem mudança de verdade.
    e. Para cada tarefa classificada como sucesso, **em sequência, uma de cada vez**:
       \`specs worktree finish --change "<change>" --task "<numero>" --json\`.
       - \`merged: true\` → segue para a próxima tarefa do lote.
       - \`conflict: true\` → **pare**. Reporte o \`path\` e o \`branch\` devolvidos. A resolução é
         manual, na árvore principal (não no worktree): o usuário roda
         \`git merge --no-ff <branch>\`, resolve o conflito à mão, \`git add\`, \`git commit\`. Só
         então rode \`specs worktree resume --change "<change>" --task "<numero>" --json\`. Nunca
         tente resolver o conflito sozinho.
    f. Volte para (a). Quando \`specs tasks ready\` devolver um lote vazio, siga para o passo 6
       (Reporte).

    Se \`parallelDispatch.supported\` for \`false\` ou o campo estiver ausente, ignore este passo e
    siga o passo 4 normalmente.

3. **Leia o plano**

   Leia os artefatos da change do disco: a proposta para a intenção, as delta specs para o
   contrato de comportamento, o design para a abordagem, o checklist para a ordem.
   As delta specs são os critérios de aceite - cada cenário é um teste que vale ter.

4. **Trabalhe o checklist**

   Para cada tarefa não marcada, em ordem:
   - implemente;
   - rode a verificação que a tarefa nomeia (um teste, um comando, um resultado observável);
   - só quando passar, marque o checkbox dela no arquivo acompanhado;
   - siga em frente.

   Não marque um box para trabalho que não foi verificado. Não deixe as marcações para o fim -
   o checklist é o registro de progresso, e uma queda no meio do caminho não deve perdê-lo.

5. **Pare e pergunte** quando bater num impedimento, numa decisão que o plano não tomou, ou
   em trabalho que passaria do escopo declarado da change. Ampliar o escopo em silêncio é pior
   do que pausar.

6. **Reporte**

   \`\`\`bash
   specs status --change "<change>"
   \`\`\`

**Saída**

- tarefas concluídas nesta sessão, e o que resta;
- desvios do plano, com o motivo;
- qualquer coisa que apareceu e pertence a uma change separada;
- próximo passo: "Rode \`${commandRef('verify')}\` para conferir a change contra as specs dela."

**Guardrails**
- Construa o que as specs descrevem. Se a realidade contradiz uma spec, pare e atualize a spec
  junto com o usuário, em vez de construir algo que as specs não descrevem.
- Se uma tarefa se mostrar errada, corrija o checklist como parte do trabalho e diga isso.
- Nunca arquive daqui; isso é o \`${commandRef('archive')}\`.`,
  };
}
