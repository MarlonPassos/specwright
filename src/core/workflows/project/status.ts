import { commandRef, type WorkflowCommand } from '../types.js';
import { CLI_NOTE, EVIDENCE_LABELS, PROJECT_BOUNDARY, PROJECT_GUARDRAILS } from '../shared.js';

export function projectStatusCommand(): WorkflowCommand {
  return {
    id: 'project-status',
    name: 'Spec Project Status',
    description: 'Explica progresso, bloqueios e diagnósticos do plano em linguagem humana',
    argumentHint: '',
    body: `Traduza o estado do plano para linguagem humana. Nenhuma escrita.

${CLI_NOTE}

${PROJECT_BOUNDARY}

## Passos

1. \`specs project status --json\`.
2. Explique, com os códigos de razão que a CLI devolveu:
   - o que está **pronto** agora;
   - o que bloqueia o quê (\`blockedBy\`), e o que é blocker manual;
   - o estado de materialização de cada Planned Change;
   - cada diagnóstico e qual comando o resolve (o \`fix\` vem no payload).
3. Se o usuário quer saber o que fazer a seguir, aponte ${commandRef('project-next')}.

${EVIDENCE_LABELS}

${PROJECT_GUARDRAILS}`,
  };
}
