import type { WorkflowCommand } from './types.js';
import { ARTIFACT_RULES, CLI_NOTE, PLANNING_BOUNDARY, RESOLVE_CHANGE } from './shared.js';

export function planCommand(): WorkflowCommand {
  return {
    id: 'plan',
    name: 'Spec Plan',
    description: 'Completa os artefatos de planejamento de uma change até ela poder ser implementada',
    argumentHint: '[nome-da-change]',
    body: `Complete os artefatos de planejamento de uma change até a implementação poder começar.

${PLANNING_BOUNDARY}

${CLI_NOTE}

${RESOLVE_CHANGE}

**Passos**

1. **Leia o estado atual**

   \`\`\`bash
   specs status --change "<change>" --json
   \`\`\`
   A resposta carrega:
   - \`artifacts\` - cada artefato com seu \`state\` (\`done\`, \`ready\`, \`blocked\`,
     \`skipped\`), o que ele \`generates\`, os arquivos que o satisfazem e suas arestas \`requires\`;
   - \`applyRequires\` - os artefatos de que a implementação depende, transitivamente;
   - \`applyBlockedBy\` - os que ainda faltam;
   - \`next\` - os artefatos que podem ser escritos agora;
   - \`workspace\` e \`changeRoot\` - caminhos resolvidos. Use-os; não presuma nenhum caminho.

2. **Escreva os artefatos que faltam**

   Acompanhe com uma lista de tarefas. Em loop:

   a. Pegue um artefato de \`next\`.

${ARTIFACT_RULES.split('\n').map((line) => (line ? `      ${line}` : '')).join('\n')}

   b. Rode \`specs status --change "<change>" --json\` de novo depois de cada artefato:
      terminar um desbloqueia outros.

   c. Pare quando \`applyBlockedBy\` estiver vazio.

   Use \`applyRequires\`, e não os estados sozinhos, para decidir o que ainda está devendo:
   \`state\` só reporta se um arquivo existe, então escrever \`tasks.md\` cedo marca \`tasks\`
   como done enquanto as dependências dele nunca foram escritas.

   Um artefato com \`skipped\` está satisfeito - a change abriu mão dele. Nunca o crie.

   Pule um artefato apenas quando a \`instruction\` dele o marca como condicional (o documento
   de design é o caso usual). Diga qual você pulou e por quê. Um artefato condicional que você
   pulou não bloqueia os que dependem dele: escreva esses mesmo assim.

3. **Valide antes de entregar**

   \`\`\`bash
   specs validate "<change>" --strict --json
   \`\`\`
   Corrija o que for reportado e rode de novo até passar. Se um requisito estiver sem cenário
   ou um delta apontar para um requisito que não existe, corrija o artefato - nunca afrouxe o
   requisito para a checagem passar.

**Saída**

- artefatos escritos, uma linha cada, mais qualquer artefato condicional que você pulou e por quê;
- as capacidades que os deltas adicionam ou modificam;
- resultado da validação;
- próximo passo: "Rode \`/spec-implement\` quando estiver pronto para construir."

**Guardrails**
- Apenas planejamento. Não edite o código do projeto e não comece a implementar.
- Releia os arquivos de dependência do disco antes de escrever um artefato que dependa deles.
- Pergunte sobre ambiguidades que mudariam escopo, comportamento observável ou critérios de
  aceite; registre suposições menores nos artefatos.`,
  };
}
