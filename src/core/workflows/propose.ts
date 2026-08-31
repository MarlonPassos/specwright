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
   tooling, docs) - nunca para escapar da validação.

4. **Escreva a proposta**

${ARTIFACT_RULES.split('\n').map((line) => (line ? `   ${line}` : '')).join('\n')}

   A seção Capabilities da proposta é o contrato contra o qual os deltas de spec são
   escritos, então nomeie cada capacidade com precisão e use os caminhos de capacidade
   existentes tal como são.

5. **Reporte**

   \`\`\`bash
   specs status --change "<nome>"
   \`\`\`

**Saída**

- o nome da change e onde ela fica;
- um resumo de duas linhas do problema e do escopo proposto;
- as capacidades que a change vai adicionar ou modificar;
- próximo passo: "Rode \`${commandRef('plan')}\` quando a proposta estiver boa."

**Guardrails**
- Pare depois da proposta. Os artefatos restantes pertencem ao \`${commandRef('plan')}\`.
- Não edite o código do projeto.
- Se já existir uma change com esse nome, pergunte se deve continuá-la ou escolher outro nome.`,
  };
}
