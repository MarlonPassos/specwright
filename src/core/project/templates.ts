import { localDateStamp } from '../../util/date.js';
import { PLAN_SCHEMA_VERSION, type PlanManifest, type SourceDocument } from './model.js';

export const ROADMAP_BEGIN = '<!-- specs:roadmap:begin -->';
export const ROADMAP_END = '<!-- specs:roadmap:end -->';

export interface BlankManifestInput {
  id: string;
  name: string;
  owner?: string;
  sources?: SourceDocument[];
  now?: Date;
}

/** A fresh manifest: `draft`, `revision: 0`, no increments. */
export function blankManifest(input: BlankManifestInput): PlanManifest {
  const stamp = localDateStamp(input.now ?? new Date());
  return {
    schema_version: PLAN_SCHEMA_VERSION,
    revision: 0,
    id: input.id,
    name: input.name,
    status: 'draft',
    ...(input.owner ? { owner: input.owner } : {}),
    created_at: stamp,
    updated_at: stamp,
    source_documents: input.sources ?? [],
    milestones: [],
    changes: [],
  };
}

/** The empty projected roadmap block, ready for `render.ts` to fill in Phase 2. */
export function emptyRoadmapBlock(): string {
  return [
    ROADMAP_BEGIN,
    '## Roadmap',
    '',
    'Ainda não há incrementos no plano.',
    '',
    'Projetado de plan.yaml. Não edite dentro dos marcadores.',
    ROADMAP_END,
  ].join('\n');
}

export function planDocTemplate(name: string): string {
  return `# ${name}

## Visão

Descreva aqui, em prosa, o que esta iniciativa entrega e para quem. Este texto é
seu; nada fora dos marcadores do roadmap é sobrescrito.

## Problema

O que não funciona hoje e por que um plano é necessário.

## Objetivos

- ...

## Escopo

Dentro e fora do escopo desta iniciativa.

## Princípios

Decisões estruturantes que orientam a decomposição.

${emptyRoadmapBlock()}
`;
}

export function architectureTemplate(name: string): string {
  return `# Arquitetura — ${name}

## Componentes

Os blocos principais do sistema e a responsabilidade de cada um.

## Integrações

Sistemas externos, contratos e limites.

## Restrições não funcionais

Desempenho, segurança, disponibilidade, custo.

## Decisões

Decisões transversais que afetam mais de um incremento, com a razão de cada uma.
`;
}
