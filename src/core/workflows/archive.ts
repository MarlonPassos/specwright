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
   Toda tarefa precisa estar marcada e a validação precisa passar. Se qualquer um dos dois não
   valer, pare e diga o que está pendente. Tarefas não marcadas significam que o trabalho não
   acabou - não arquive por cima delas.

   Se a change ainda não foi verificada, rode \`${commandRef('verify')}\` antes.

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
   comando se recusa a rodar enquanto a validação falha ou há tarefas não marcadas; \`--force\`
   ignora a checagem de tarefas e é para casos excepcionais que o usuário aprovou.

4. **Confirme o resultado**

   \`\`\`bash
   specs validate --specs --strict --json
   \`\`\`
   As specs resultantes precisam continuar válidas. Se uma spec de capacidade recém-criada
   ficou com um propósito placeholder, substitua agora editando a spec do workspace direto.

5. **Feche o plano, se houver um**

   O arquivamento já vincula sozinho o incremento que planejava exatamente aquele slug e
   ainda não tinha vínculo. Quando isso acontece, a saída do \`specs archive\` traz um bloco
   \`plan\` com o incremento vinculado - reporte-o ao usuário.

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
   \`unclaimed_archive\` apontando a change que você acabou de arquivar significa que nenhum
   incremento planejava aquele slug, ou que o plano recusou a escrita - rode o \`fix\` que o
   diagnóstico traz (\`specs project adopt\` quando ninguém planejava, \`specs project link\`
   quando alguém planejava). Depois confirme que o incremento aparece com
   \`execution: "archived"\`.

   Sem isso o trabalho fica concluído no workspace e invisível no plano: o painel do projeto
   segue mostrando o incremento como pendente.

**Saída**

- onde a change foi arquivada;
- capacidades criadas, atualizadas e aposentadas;
- o incremento do plano que passou a contar como concluído, quando há plano;
- qualquer coisa que reste para fazer à mão, como um propósito placeholder a substituir.

**Guardrails**
- O arquivamento reescreve as specs do workspace. Nunca o rode numa change não implementada.
- Não edite um delta à mão para o merge dar certo; corrija a divergência de raiz.
- O diretório da change arquivada é um registro. Não o edite depois.`,
  };
}
