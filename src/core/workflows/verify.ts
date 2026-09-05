import { commandRef, type WorkflowCommand } from './types.js';
import { CLI_NOTE, RESOLVE_CHANGE } from './shared.js';

export function verifyCommand(): WorkflowCommand {
  return {
    id: 'verify',
    name: 'Spec Verify',
    description: 'Confere uma change implementada contra as specs e as tarefas dela',
    argumentHint: '[nome-da-change]',
    body: `Confira uma change implementada contra o que ela prometeu.

${CLI_NOTE}

${RESOLVE_CHANGE}

**Passos**

1. **Rode as checagens estruturais**

   \`\`\`bash
   specs validate "<change>" --strict --json
   \`\`\`
   O relatório lista problemas com um nível (\`ERROR\`, \`WARNING\`, \`INFO\`), um local e uma
   mensagem. Sob \`--strict\` um warning também reprova o relatório.

2. **Confira o checklist**

   \`\`\`bash
   specs status --change "<change>" --json
   \`\`\`
   Compare \`tasks.completed\` com \`tasks.total\`. Para cada tarefa marcada, confirme que o
   trabalho que ela descreve existe de fato no código. Um box marcado sem nada por trás é um
   achado, não uma formalidade.

3. **Confira o comportamento contra as specs**

   \`\`\`bash
   specs show "<change>" --json --deltas-only
   \`\`\`
   Para cada requisito nos deltas, percorra os cenários e estabeleça como cada um é
   satisfeito: um teste que o cobre, um comando cuja saída o mostra, ou código que se possa
   apontar. Rode a suíte de testes do projeto. Reporte como não verificado o cenário que você
   não conseguir amarrar a nada - não presuma.

4. **Confira os critérios macro do plano, quando há um**

   Se esta change está vinculada a um incremento:

   \`\`\`bash
   specs project show "<CH-NNN>" --json
   \`\`\`
   Cada item de **Critérios macro** do brief precisa de pelo menos uma tarefa que o exerça,
   e você precisa conseguir apontar qual. Um critério sem tarefa nenhuma é um achado: era
   uma condição de pronto que o plano declarou e a change não cobriu.

   O caso real: "\`docker compose up --build\` funciona" era critério macro de uma change de
   entrega, e nenhuma das tarefas dela o verificava. A change fechou com todos os boxes
   marcados e o critério nunca foi exercido.

   Isto é conferência, não validação: critérios e tarefas são prosa em artefatos
   diferentes, e casá-los exige ler os dois. É por isso que o passo mora aqui e não numa
   regra da CLI.

5. **Procure desvios**

   - comportamento construído que nenhuma spec descreve -> as specs precisam de atualização;
   - requisitos sem implementação -> a change não está pronta;
   - requisitos REMOVED cujo comportamento ainda existe -> a remoção está incompleta.

6. **Grave o veredito**

   Escreva \`verification.md\` no diretório da change, no formato do template
   (\`specs instructions verify --change "<change>" --json\` traz o modelo):

   - \`data:\` com o momento em que você rodou;
   - **Comandos**: todo comando que você rodou e o resultado exato. Um resultado que diz
     \`skipped\`, \`no tests ran\` ou \`0 selected\` para o alvo declarado é um achado, não
     uma linha de sucesso;
   - **Requirement → prova**: um requisito por linha, com o que prova cada um. O que você
     não conseguir amarrar a nada entra como NÃO VERIFICADO - não presuma;
   - **Código sem requirement**: comportamento que existe e nenhuma spec descreve;
   - **Achados em aberto**: um por linha, ou \`nenhum\`. A seção ausente não conta como
     limpa; conta como pergunta não respondida.

   Este arquivo é o que faz a verificação deixar rastro. Sem ele, o passo mais valioso do
   fluxo é também o único que não prova ter acontecido, e \`archive\` não tem como saber.

**Saída**

Um relatório curto:
- resultado da validação, com cada erro e warning;
- conclusão das tarefas, e qualquer tarefa marcada sem nada por trás;
- por capacidade: requisitos verificados, e como;
- critérios macro do incremento sem tarefa que os exerça, quando há plano;
- cenários não verificados e desvios, cada um com o que resolveria;
- um veredito: pronta para arquivar, ou a lista do que corrigir antes;
- onde o \`verification.md\` foi gravado;
- próximo passo quando estiver pronta: "Rode \`${commandRef('archive')}\` para aplicar as specs e encerrar a change."

**Guardrails**
- Reporte o que encontrar. Não corrija código em silêncio enquanto verifica - diga o que está
  errado e deixe o usuário decidir, a menos que ele tenha pedido para corrigir no caminho.
- Nunca afrouxe um requisito para a checagem passar.
- Nunca escreva \`nenhum\` em Achados em aberto para fechar mais rápido. O valor deste
  arquivo é inteiramente a honestidade dele.
- Não arquive daqui; isso é o \`${commandRef('archive')}\`.`,
  };
}
