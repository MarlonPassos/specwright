import { commandRef, type WorkflowCommand } from './types.js';
import { CLI_NOTE, PLANNING_BOUNDARY, RESOLVE_CHANGE } from './shared.js';

export function reviseCommand(): WorkflowCommand {
  return {
    id: 'revise',
    name: 'Spec Revise',
    description: 'Revisa os artefatos de planejamento que uma change já tem e os mantém coerentes',
    argumentHint: '[nome-da-change] [o que mudou]',
    body: `Revise os artefatos de planejamento que uma change já tem e mantenha-os coerentes entre si.

${PLANNING_BOUNDARY}

${CLI_NOTE}

${RESOLVE_CHANGE}

O \`specs list --json\` já vem ordenado por recência; ao perguntar, apresente as mais recentes
primeiro e diga como o usuário sobrescreve a escolha.

**Este comando só revisa o que já existe.** Ele nunca cria um artefato que falta - isso é o
\`${commandRef('continue')}\`.

**Passos**

1. **Leia o estado da change**

   \`\`\`bash
   specs status --change "<change>" --json
   \`\`\`
   A resposta carrega:
   - \`artifacts\` - cada artefato com seu \`state\` (\`done\`, \`ready\`, \`blocked\`, \`skipped\`);
   - \`outputs\` - os arquivos que satisfazem o artefato, relativos a \`changeRoot\`, com qualquer
     padrão já expandido. **São esses os arquivos que você pode editar**;
   - \`generates\` - o padrão que o schema declara. Nunca escreva nesse caminho: para um artefato
     de padrão (\`specs/**/*.md\`) ele não é um arquivo real;
   - \`applyBlockedBy\`, \`tasks\`, \`workspace\` e \`changeRoot\`.

   Os ids e os caminhos dos artefatos vêm do schema ativo. Não presuma nenhum e não ramifique
   por nome de artefato: um schema customizado precisa funcionar sem mudança nenhuma.

   Só um artefato \`done\` entra nesta revisão. \`ready\` e \`blocked\` não têm arquivo para
   revisar; \`skipped\` a change abriu mão dele.

2. **Entenda o pedido**

   - Se o usuário pediu uma revisão concreta ("o design agora usa X"), essa é a edição inicial.
   - Se ele só disse "atualize" ou "deixe coerente", trate como revisão de coerência: leia os
     artefatos existentes e confronte-os entre si procurando contradição, lacuna e duplicação.

3. **Leia e reconcilie**

   Leia do disco todo artefato \`done\`, mesmo os que você já viu - o usuário pode tê-los
   editado desde então.

   Aplique a edição pedida e depois confronte todos os outros artefatos com ela, **nos dois
   sentidos**: uma edição num artefato tardio pode exigir revisar um anterior, não só o
   contrário. A ordem de construção é uma ordem de leitura útil, não uma restrição sobre o que
   pode ser revisado.

   O que procurar:
   - a proposta promete uma capacidade que nenhum delta cobre, ou um delta cobre uma capacidade
     que a proposta não lista - a seção **Capabilities** é o contrato entre os dois;
   - uma decisão de design que os deltas ou o checklist contradizem;
   - uma tarefa sem requisito por trás, ou um requisito que nenhuma tarefa constrói;
   - requisito sem cenário, e texto duplicado entre artefatos.

   Anote o que ficou inconsistente e o que passou a faltar. Se a change já está coerente, diga
   isso e não edite nada.

4. **Confirme e escreva, um artefato por vez**

   Mostre cada revisão proposta e por quê. Escreva só depois que o usuário confirmar. Se ele
   recusar uma revisão, não a escreva - aquele artefato fica como está.

   Quando a reescrita for grande, pegue as regras e o template do artefato antes de escrever:

   \`\`\`bash
   specs instructions <id-do-artefato> --change "<change>" --json
   \`\`\`
   Use \`instruction\` e \`template\` para manter a estrutura, e \`dependencies\` para saber o que
   reler. \`context\` e \`rules\` são restrições para VOCÊ - nunca copie para dentro do arquivo.
   Escreva no arquivo que o \`outputs\` do \`specs status\` nomeia, e não no \`outputPath\` das
   instruções: quando \`outputIsPattern\` é true ele é um padrão, não um arquivo.

5. **Valide o que você escreveu**

   \`\`\`bash
   specs validate "<change>" --strict --json
   \`\`\`
   Corrija o que voltar e rode de novo até passar. Nunca afrouxe um requisito para a checagem
   passar.

**Saída**

- artefatos revisados, um por linha, com o que mudou em cada um;
- revisões que você propôs e o usuário recusou;
- o que ficou faltando e que este comando não cria;
- resultado da validação;
- próximo passo - **apenas indicação, nunca aja por conta**:
  - artefatos ainda faltando -> "Rode \`${commandRef('continue')}\` para escrevê-los.";
  - change já implementada (tarefas marcadas) -> o código pode não bater mais com o plano
    revisado: "Rode \`${commandRef('implement')}\` para levar a diferença ao código.";
  - planejamento coerente e implementação em dia -> "Rode \`${commandRef('verify')}\`."

**Guardrails**
- Apenas artefatos de planejamento. Nunca edite o código do projeto: se o plano revisado
  implica mudança de código, pare e aponte o \`${commandRef('implement')}\`.
- Edite apenas arquivos que já existem em \`outputs\`. Não crie um artefato que ainda não existe
  e não invente um arquivo novo sob um artefato de padrão - anote e aponte o \`${commandRef('continue')}\`.
- Use os ids e os caminhos que o \`specs status\` reporta; nunca ramifique por nome de artefato.
- Confirme toda edição com o usuário antes de escrever.
- Se o pedido muda a *intenção* da change em vez de refiná-la, não force a revisão: peça um
  nome novo e recomende abrir outra change com o \`${commandRef('propose')}\`.`,
  };
}
