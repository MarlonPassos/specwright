import { commandRef, type WorkflowCommand } from '../types.js';
import { CLI_NOTE, EVIDENCE_LABELS, PROJECT_BOUNDARY, PROJECT_GUARDRAILS } from '../shared.js';

const READ_TOOLS = 'Bash(specs:*), Read, Glob, Grep';

export function projectVerifyCommand(): WorkflowCommand {
  return {
    id: 'project-verify',
    name: 'Spec Project Verify',
    description: 'Confere o que foi entregue, em escopo de projeto, contra o documento-fonte',
    argumentHint: '[um milestone, ou nada]',
    allowedTools: READ_TOOLS,
    body: `Confira o RESULTADO de um conjunto de changes contra o que o projeto prometeu.
Nenhuma escrita.

${CLI_NOTE}

${PROJECT_BOUNDARY}

## Onde este comando fica

${commandRef('verify')} confere UMA change contra os deltas dela.
${commandRef('project-review')} critica o PLANO, antes de materializar.
Este confere o que já foi ENTREGUE, no conjunto — e é o único dos três que enxerga o que
some entre uma change e outra: requisito da fonte que nunca virou requirement, capacidade
especificada e nunca exposta, spec de uma change contradizendo a de outra, valor que existe
no código sem requisito nenhum.

Rode ao fechar um milestone, ou quando alguém perguntar "entregamos mesmo o que foi
pedido?".

## Passos

1. **Cálculo — o que a CLI devolve**

   \`\`\`bash
   specs project status --json
   specs project validate --strict --json
   specs list --specs --json
   \`\`\`
   Rotule tudo daqui como **cálculo**: progresso, diagnósticos, achados estruturais.

2. **Cobertura fonte → requisito**

   Para cada incremento concluído, \`specs project show <CH-NNN> --json\` traz \`sourceRefs\`.
   Junte todos e compare com os documentos em \`source_documents\`: quais trechos da fonte
   nenhum incremento reivindica?

   Um trecho sem \`source_refs\` apontando para ele é **cálculo** — a CLI sabe responder.
   Se aquele trecho pedia comportamento que ninguém construiu é **recomendação** sua, e
   precisa ser lida como tal.

   Uma referência com \`supersedes: true\` é uma divergência **declarada**: o incremento
   sabe que se afasta da fonte ali. Confira que o design correspondente traz a subseção de
   divergência com "o que se perde". Uma divergência que o código comete e nenhuma
   referência declara é o achado do passo 4.

3. **Requisito → prova**

   Leia o \`verification.md\` de cada change arquivada do escopo. Requisito sem prova
   registrada, e achado que ficou em aberto, entram no relatório. Uma change sem
   \`verification.md\` é ela própria um achado: nada prova que ela foi conferida.

4. **Desvios entre specs, no conjunto** (recomendação, sempre rotulada)

   - **capacidade inalcançável**: uma spec exige uma transição, um estado ou uma operação, e
     nenhuma outra spec diz como alguém chega até ela;
   - **valor órfão**: um enum, um estado ou uma constraint que existe no código e nenhum
     requisito justifica;
   - **contrato dividido**: duas changes definindo a mesma coisa de formas diferentes —
     paginação, envelope de erro, formato de id;
   - **exemplo impossível**: um exemplo dentro de um requisito que a própria regra dele
     torna inalcançável;
   - **divergência não declarada**: o design contraria a fonte sem a subseção de divergência;
   - **invariante sem guarda**: uma invariante de \`architecture.md\` que não virou requisito
     de nenhuma capability, e portanto não tem teste que a defenda.

5. **Documentação de entrega**

   O que está shipado fala no presente e no todo? Sobrou "esta change", "próxima change" ou
   um \`CH-0xx\` fora de \`spec/\` e \`planning/\`? Um checklist entregue está preenchido? O
   README diz como rodar os testes que a suíte padrão pula?

**Saída**

Um relatório em duas metades, rotuladas e separadas:

- **Cálculo**: diagnósticos, cobertura de \`source_refs\`, vereditos de verificação
  presentes e ausentes, changes sem \`verification.md\`.
- **Recomendação**: os desvios do passo 4 e 5, cada um com o que resolveria — uma change
  corretiva, um requisito novo, uma correção de documentação.

Feche com o que fazer: ${commandRef('project-refine')} para agir no plano, ou
${commandRef('propose')} para abrir a change corretiva.

${EVIDENCE_LABELS}

${PROJECT_GUARDRAILS}
9. Nunca apresente sua leitura semântica como achado estrutural. A CLI sabe dizer o que
   não tem \`source_refs\`; ela não sabe dizer se aquilo importa. Essa parte é sua, e
   precisa vir rotulada como sua.`,
  };
}
