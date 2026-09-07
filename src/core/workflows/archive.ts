import { commandRef, type WorkflowCommand } from './types.js';
import { CLI_NOTE, RESOLVE_CHANGE } from './shared.js';

export function archiveCommand(): WorkflowCommand {
  return {
    id: 'archive',
    name: 'Spec Archive',
    description: 'Aplica uma change concluída nas specs do workspace e a arquiva',
    argumentHint: '[nome-da-change]',
    body: `Encerre uma change concluída: aplique os deltas dela nas specs do workspace e arquive-a.

${CLI_NOTE}

${RESOLVE_CHANGE}

**Passos**

1. **Confirme que a change está concluída**

   \`\`\`bash
   specs status --change "<change>" --json
   specs validate "<change>" --strict --json
   \`\`\`
   Toda tarefa precisa estar marcada: tarefa não marcada significa que o trabalho não acabou -
   não arquive por cima dela.

   Na validação, separe erro de aviso. \`--strict\` reprova por qualquer um dos dois, mas eles
   não pesam igual. Um \`ERROR\` para de verdade: o \`specs archive\` também recusa, e não há
   o que decidir. Um \`WARNING\` não bloqueia o comando - ele descreve algo que o passo 3 vai
   gravar na spec do workspace e que vai continuar aparecendo em
   \`specs validate --specs --strict\` depois do arquivamento. Reporte cada aviso ao usuário
   com essa consequência e pergunte: corrigir agora, ou arquivar assim mesmo. Não decida
   sozinho em nenhuma das duas direções.

   Se a change ainda não foi verificada, rode \`${commandRef('verify')}\` antes. O
   \`specs archive\` devolve \`verification\` sempre: ausente, com achados em aberto, ou
   limpo com a data. Ele **avisa** nos dois primeiros casos e arquiva mesmo assim - arquivar
   não falha por estado a jusante do trabalho, e um veredito descreve trabalho que já
   terminou. Um projeto que quer a regra mais dura passa \`--require-verify\`, e aí o
   comando recusa.

   Reporte o que vier em \`verification\` ao usuário, em qualquer um dos três casos.

   O mesmo vale para \`pendingFollowUps\`: cada \`FU-\` que o design declarou e ninguém
   despachou sai arquivado junto com a change. Leve a lista ao usuário e pergunte o destino
   de cada um antes de arquivar - incremento novo no plano, item de backlog, ou descarte com
   justificativa. Marcar a caixa do \`FU-\` no design é o que registra que ele teve destino.

2. **Leia o que o arquivamento vai mudar**

   \`\`\`bash
   specs instructions archive --change "<change>" --json
   specs show "<change>" --json --deltas-only
   \`\`\`
   Cada requisito ADDED é acrescentado à spec da capacidade dele, cada MODIFIED substitui o
   bloco existente por inteiro, cada REMOVED o apaga, cada RENAMED troca o cabeçalho. Um bloco
   MODIFIED com texto parcial perde o resto - confira os deltas antes de rodar o arquivamento,
   não depois.

3. **Arquive**

   \`\`\`bash
   specs archive "<change>" --json
   \`\`\`
   Acrescente \`--skip-specs\` apenas para uma change que não declara nenhum delta de spec. O
   comando se recusa enquanto a validação tem **erro** ou há tarefas não marcadas; avisos não
   o bloqueiam - o que fazer com eles já foi decidido no passo 1. \`--force\` ignora a checagem
   de tarefas e é para casos excepcionais que o usuário aprovou.

4. **Confirme o resultado**

   \`\`\`bash
   specs validate --specs --strict --json
   \`\`\`
   Mesma distinção do passo 1, agora do outro lado do merge. **Erro** aqui é grave de um jeito
   que erro nenhum antes era: o merge dos deltas produziu spec quebrada no workspace, e isso
   já está gravado - diga ao usuário exatamente o que quebrou. **Aviso** não é isso; um
   requisito longo que já vinha do delta continua longo depois do merge, e você já tratou dele
   no passo 1. Reporte os avisos e siga.

   Se uma spec de capacidade recém-criada ficou com um propósito placeholder, substitua agora
   editando a spec do workspace direto.

5. **Feche o plano, se houver um**

   O arquivamento faz duas coisas no plano, sozinho. Vincula o incremento que planejava
   exatamente aquele slug e ainda não tinha vínculo - aí a saída traz o bloco \`plan\`. E
   roda o reparo de vínculo (\`sync\`) no plano que já tinha o vínculo, movendo
   \`active_path\` para \`archive_path\` - aí a saída traz \`planSynced\` com o id do plano.
   Reporte os dois ao usuário.

   Se existe \`planning/\` na raiz e o bloco \`plan\` **não** veio, há três razões possíveis:
   nenhum incremento planejava aquele slug; o plano está ausente, ilegível ou recusou a
   escrita; ou **mais de um** incremento planejava o slug - nesse caso o \`specs archive\`
   traz um bloco \`planAmbiguity\` listando os candidatos e **não grava em plano nenhum**,
   porque escolher por conta própria trocaria o dono do trabalho. Rode o \`fix\` do candidato
   que o usuário confirmar.

   Confirme por quê:

   \`\`\`bash
   specs project status --json
   \`\`\`
   \`plan_not_found\` significa que não há plano: pare aqui, está tudo certo. Um
   \`unclaimed_archive\` apontando a change que você acabou de arquivar traz um \`fix\`, e
   qual dos dois ele traz decide se você roda ou pergunta:

   - \`specs project link <CH-NNN> <slug>\` - **rode**. Existe um incremento que planejava
     exatamente este slug e ficou sem vínculo (o plano estava ilegível ou recusou a escrita na
     hora do archive). Vincular só reivindica trabalho que alguém já tinha declarado; é o
     mesmo que o \`specs archive\` faz sozinho quando consegue.
   - \`specs project adopt <archive-dir>\` - **proponha e pergunte**. Ninguém planejava este
     slug, e adotar não é reparo: cria um incremento **novo** (próximo ID livre,
     \`planning_state: planned\`, sem milestone e sem brief) e faz o plano passar a reivindicar
     um trabalho que ele nunca planejou. Mostre o comando, o que ele vai criar, e ofereça
     manter fora do plano como resposta válida - dizendo que nesse caso o
     \`unclaimed_archive\` continua aparecendo no \`specs project status\`, porque não há como
     silenciá-lo. Só rode depois do sim.

   Depois de qualquer um dos dois, confirme que o incremento aparece com
   \`execution: "archived"\`.

   Sem vínculo nenhum, o trabalho fica concluído no workspace e invisível no plano: o painel
   do projeto segue mostrando o incremento como pendente. Isso é uma consequência legítima de
   escolher manter a change fora do plano - não é motivo para adotar por conta própria.

**Saída**

- onde a change foi arquivada;
- capacidades criadas, atualizadas e aposentadas;
- o incremento do plano que passou a contar como concluído, quando há plano;
- qualquer coisa que reste para fazer à mão, como um propósito placeholder a substituir;
- \`unversioned: true\`, quando vier: o git nunca rastreou nenhum arquivo desta change, e o
  trabalho existe só nesta árvore. Diga isso ao usuário. Não commite por conta própria -
  quando e como commitar é decisão dele.

**Guardrails**
- O arquivamento reescreve as specs do workspace. Nunca o rode numa change não implementada.
- Não edite um delta à mão para o merge dar certo; corrija a divergência de raiz.
- O diretório da change arquivada é um registro. Não o edite depois.`,
  };
}
