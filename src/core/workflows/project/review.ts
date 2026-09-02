import { commandRef, type WorkflowCommand } from '../types.js';
import { CLI_NOTE, EVIDENCE_LABELS, PROJECT_BOUNDARY, PROJECT_GUARDRAILS } from '../shared.js';

const READ_TOOLS = 'Bash(specs:*), Read, Glob, Grep';

export function projectReviewCommand(): WorkflowCommand {
  return {
    id: 'project-review',
    name: 'Spec Project Review',
    description: 'Valida o plano e o critica em granularidade, dependências e lacunas',
    argumentHint: '',
    allowedTools: READ_TOOLS,
    body: `Revise o plano inteiro. Nenhuma escrita.

${CLI_NOTE}

${PROJECT_BOUNDARY}

## Passos

1. \`specs project validate --strict --json\`. Estes são os **achados estruturais**
   (cálculo do core): rotule-os como tal.
2. Some a eles sua **crítica semântica** (recomendação), rotulada separadamente:
   - incremento grande demais ou com domínios misturados;
   - dependência que é só ordenação sugerida, ou dependência bidirecional;
   - lacuna de infraestrutura, migração, segurança, observabilidade ou testes;
   - milestone inviável;
   - Planned Change sem critérios macro;
   - vínculo quebrado, ou change ativa com proposta e sem vínculo;
   - duplicação entre \`plan.md\`, \`architecture.md\` e os Planned Changes.
3. \`specs project status --json\`. Para cada diagnóstico \`unclaimed_archive\`
   existe trabalho concluído que o plano não está contando. Rode
   \`specs project sync --link --check\`: ele lista os incrementos que seriam
   vinculados a uma change de MESMO nome do slug, ativa ou arquivada. Mostre a
   lista, pergunte, e depois do sim rode \`specs project sync --link\`.
   Isso é escrita — vale o protocolo de confirmação.
4. Sobrou \`unclaimed_archive\` depois disso? A change existe mas nenhum
   incremento tem aquele slug: sugira \`specs project adopt <change-name>\`,
   que cria um incremento novo já vinculado.
5. Um diagnóstico \`ambiguous_execution\` significa que um slug tem diretório
   ativo E archive. O incremento é apresentado como concluído pelo archive, e o
   trabalho ativo fica invisível. Aponte isso; não escolha por conta própria.
6. Feche apontando ${commandRef('project-refine')} para agir sobre os achados, ou
   ${commandRef('project-generate')} se o plano já está pronto para materializar.

${EVIDENCE_LABELS}

${PROJECT_GUARDRAILS}`,
  };
}
