import { commandRef, type WorkflowCommand } from './types.js';
import { ARTIFACT_RULES, CLI_NOTE, PLANNING_BOUNDARY } from './shared.js';

export function proposeCommand(): WorkflowCommand {
  return {
    id: 'propose',
    name: 'Spec Propose',
    description: 'Abre uma change nova e escreve a proposta dela',
    argumentHint: '<o que você quer construir ou corrigir>',
    body: `Abra uma change nova e escreva a proposta que diz por que ela existe.

${PLANNING_BOUNDARY}

${CLI_NOTE}

**Entrada**: um nome de change em kebab-case, ou uma descrição do que o usuário quer.

**Passos**

1. **Entenda o pedido**

   Se nada de aproveitável foi passado, pergunte - aberto, sem opções prontas:
   > "Em que change você quer trabalhar? Descreva o que quer construir ou corrigir."

   Derive um nome em kebab-case da descrição ("adicionar autenticação de usuário" ->
   \`add-user-auth\`). Não siga adiante sem entender o que está sendo pedido.

   Se uma ambiguidade mudaria materialmente o escopo, o comportamento observável, a
   compatibilidade ou os critérios de aceite, pergunte antes de criar a change. Registre
   suposições menores na proposta em vez de perguntar.

2. **Leia o terreno em que você está pisando**

   \`\`\`bash
   specs list --specs --json
   \`\`\`
   As capacidades existentes dizem quais specs esta change modificaria e quais ela
   introduziria. Leia as specs que parecem relacionadas antes de escrever a proposta.

3. **Crie a change**

   \`\`\`bash
   specs new change "<nome>" --json
   \`\`\`
   Acrescente \`--schema "<schema>"\` só quando o usuário pediu um schema de workflow
   específico; \`specs schemas --json\` lista os disponíveis. Acrescente \`--skip-specs\` só
   quando a change comprovadamente não altera nenhum comportamento observável (refatoração,
   tooling, docs) - nunca para escapar da validação. Ele exige
   \`--skip-specs-reason "<uma frase>"\`: sem requisito, a definição de pronto da change vira
   a lista de tarefas dela, e a justificativa é o único rastro dessa decisão.

   Se a saída trouxer a chave \`plan\`, o projeto tem um plano e um incremento dele planeja
   exatamente este slug. Rode o \`plan.fix\` que veio junto:

   \`\`\`bash
   specs project link "<CH-NNN>" "<nome>"
   \`\`\`
   Sem esse vínculo o plano não enxerga esta change: nem enquanto ela anda, nem depois de
   arquivada. Diga ao usuário qual incremento você vinculou. Sem a chave \`plan\`, siga em
   frente - o projeto não tem plano, ou nenhum incremento reivindica este nome.

3b. **Leia o Planned Change do incremento** (só quando o passo 3 vinculou um)

   \`\`\`bash
   specs project show "<CH-NNN>" --json
   \`\`\`
   \`plannedChange.sections\` traz Objetivo, Escopo, Critérios macro e Referências da fonte;
   \`sourceRefs\` traz os mesmos ponteiros já estruturados.

   **Este passo não é opcional.** O incremento é o que alguém decidiu que esta change
   entrega, e as Referências da fonte são o único caminho de volta ao documento que
   originou o pedido. Uma proposta escrita sem ler isso reinventa o escopo do zero: o
   plano continua dizendo uma coisa, a change faz outra, e nada acusa a diferença até
   alguém auditar o código muito depois.

   Se \`plannedChange\` vier \`null\` ou com Escopo e Critérios macro vazios, o brief é o
   esqueleto vazio (§7.5) - não há de onde partir. Diga isso ao usuário e pergunte se ele
   quer preencher o brief antes, em vez de escrever a proposta no escuro.

4. **Escreva a proposta**

${ARTIFACT_RULES.split('\n').map((line) => (line ? `   ${line}` : '')).join('\n')}

   A seção Capabilities da proposta é o contrato contra o qual os deltas de spec são
   escritos, então nomeie cada capacidade com precisão e use os caminhos de capacidade
   existentes tal como são.

   Quando o passo 3b leu um incremento, preencha \`## Origem\` com o id dele e as
   Referências da fonte, copiadas como estão, e escreva What Changes a partir do Escopo
   do brief - não de uma releitura sua do pedido. Um item do Escopo que você deixar de
   fora é uma decisão de escopo: leve ao usuário em vez de decidir sozinho. Sem plano,
   apague a seção \`## Origem\`.

5. **Reporte**

   \`\`\`bash
   specs status --change "<nome>"
   \`\`\`

**Saída**

- o nome da change e onde ela fica;
- o incremento do plano que a originou, quando há um, e o que você leu do brief dele;
- um resumo de duas linhas do problema e do escopo proposto;
- as capacidades que a change vai adicionar ou modificar;
- próximo passo: "Rode \`${commandRef('continue')}\` quando a proposta estiver boa."

**Guardrails**
- Pare depois da proposta. Os artefatos restantes pertencem ao \`${commandRef('continue')}\`.
- Não edite o código do projeto.
- Se já existir uma change com esse nome, pergunte se deve continuá-la ou escolher outro nome.`,
  };
}
