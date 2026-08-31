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

4. **Procure desvios**

   - comportamento construído que nenhuma spec descreve -> as specs precisam de atualização;
   - requisitos sem implementação -> a change não está pronta;
   - requisitos REMOVED cujo comportamento ainda existe -> a remoção está incompleta.

**Saída**

Um relatório curto:
- resultado da validação, com cada erro e warning;
- conclusão das tarefas, e qualquer tarefa marcada sem nada por trás;
- por capacidade: requisitos verificados, e como;
- cenários não verificados e desvios, cada um com o que resolveria;
- um veredito: pronta para arquivar, ou a lista do que corrigir antes;
- próximo passo quando estiver pronta: "Rode \`${commandRef('archive')}\` para aplicar as specs e encerrar a change."

**Guardrails**
- Reporte o que encontrar. Não corrija código em silêncio enquanto verifica - diga o que está
  errado e deixe o usuário decidir, a menos que ele tenha pedido para corrigir no caminho.
- Nunca afrouxe um requisito para a checagem passar.
- Não arquive daqui; isso é o \`${commandRef('archive')}\`.`,
  };
}
