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
   Se \`applyBlockedBy\` não estiver vazio, pare e diga ao usuário para rodar \`${commandRef('plan')}\` antes.

2. **Carregue as instruções da fase**

   \`\`\`bash
   specs instructions implement --change "<change>" --json
   \`\`\`
   A resposta carrega a orientação de implementação do schema, o arquivo cujos checkboxes
   acompanham o progresso (\`tracks\`), a contagem atual de tarefas e o \`changeRoot\` resolvido.

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
