/** Thresholds every validation message is derived from. */
export const MIN_WHY_LENGTH = 50;
export const MAX_WHY_LENGTH = 1000;
export const MIN_PURPOSE_LENGTH = 50;
export const MAX_REQUIREMENT_TEXT_LENGTH = 500;
export const MAX_DELTAS_PER_CHANGE = 10;

/**
 * The Purpose written into a main spec that archiving had to create without one.
 * Composed from these halves at both the write site and the check, so the
 * detector cannot drift away from the text it is looking for.
 */
export const PURPOSE_PLACEHOLDER_PREFIX = 'TBD - escrito ao arquivar a change ';
export const PURPOSE_PLACEHOLDER_SUFFIX = '. Substitua pelo propósito real.';

export function purposePlaceholder(changeId: string): string {
  return `${PURPOSE_PLACEHOLDER_PREFIX}${changeId}${PURPOSE_PLACEHOLDER_SUFFIX}`;
}

/** True when a Purpose is still a placeholder rather than something someone wrote. */
export function isPurposePlaceholder(purpose: string): boolean {
  const text = purpose.trim();
  if (!text) return false;
  if (text.startsWith(PURPOSE_PLACEHOLDER_PREFIX)) return true;
  return /^(TBD|TODO)\b/i.test(text);
}

export const MESSAGES = {
  PROPOSAL_MISSING: 'proposal.md não existe',
  WHY_MISSING: 'Falta a seção "## Why"',
  WHY_TOO_SHORT: `A seção "## Why" precisa ter pelo menos ${MIN_WHY_LENGTH} caracteres`,
  WHY_TOO_LONG: `A seção "## Why" deveria ficar abaixo de ${MAX_WHY_LENGTH} caracteres`,
  WHAT_MISSING: 'Falta a seção "## What Changes"',
  WHAT_EMPTY: 'A seção "## What Changes" está vazia',
  NO_DELTAS:
    'Nenhum delta de spec encontrado. Adicione arquivos specs/<caminho-da-capacidade>/spec.md ' +
    'com cabeçalhos de delta (## ADDED/MODIFIED/REMOVED/RENAMED Requirements), cada requisito ' +
    'com pelo menos um bloco "#### Scenario:". Se esta change não altera nenhum comportamento ' +
    'observável, defina "skip_specs: true" no .change.yaml dela.',
  SKIP_SPECS_CONFLICT:
    'skip_specs está definido mas existem arquivos de delta em specs/. Remova o marcador ou apague os deltas',
  SKIP_SPECS_MALFORMED:
    'skip_specs parece definido mas o .change.yaml não é um metadado de change válido, então o marcador é ignorado',
  TOO_MANY_DELTAS: `Mais de ${MAX_DELTAS_PER_CHANGE} deltas - considere dividir esta change`,
  DELTA_NO_SECTIONS:
    'Nenhuma seção de delta encontrada. Uma delta spec precisa de pelo menos uma entre ' +
    '"## ADDED Requirements", "## MODIFIED Requirements", "## REMOVED Requirements" ou ' +
    '"## RENAMED Requirements"',
  REQUIREMENT_EMPTY: 'O texto do requisito está vazio',
  REQUIREMENT_NO_KEYWORD: 'O texto do requisito precisa usar SHALL ou MUST',
  REQUIREMENT_NO_SCENARIO:
    'O requisito não tem cenário. Adicione um bloco "#### Scenario:" com marcadores WHEN/THEN ' +
    '(exatamente quatro cerquilhas - três cerquilhas ou uma lista não são interpretadas)',
  REQUIREMENT_TOO_LONG: `O texto do requisito está muito longo (acima de ${MAX_REQUIREMENT_TEXT_LENGTH} caracteres) - considere dividi-lo`,
  SCENARIO_EMPTY: 'O cenário não tem conteúdo',
  REMOVED_NO_REASON: 'Um requisito REMOVED precisa carregar uma linha "**Reason**:"',
  REMOVED_NO_MIGRATION: 'Um requisito REMOVED precisa carregar uma linha "**Migration**:"',
  SPEC_PURPOSE_MISSING: 'Falta a seção "## Purpose"',
  SPEC_PURPOSE_EMPTY: 'A seção "## Purpose" está vazia',
  SPEC_PURPOSE_TOO_BRIEF: `A seção "## Purpose" tem menos de ${MIN_PURPOSE_LENGTH} caracteres`,
  SPEC_PURPOSE_PLACEHOLDER:
    'A seção "## Purpose" ainda é um placeholder. Substitua pelo que esta capacidade faz, ' +
    'editando a spec principal - um "## Purpose" num delta só é lido quando a capacidade é criada',
  SPEC_NO_REQUIREMENTS: 'Falta a seção "## Requirements", ou ela não declara nenhum requisito',
  SPEC_DELTA_HEADER:
    'Cabeçalhos de delta pertencem ao delta de uma change, não a uma spec principal, e cortam a ' +
    'seção "## Requirements" que é interpretada',
  SPEC_REQUIREMENT_OUTSIDE:
    'Requisito declarado fora da seção "## Requirements", então nada o lê',
  SPEC_DUPLICATE_REQUIREMENT: 'Nome de requisito duplicado - os nomes precisam ser únicos dentro de uma spec',
  DELTA_UNKNOWN_CAPABILITY:
    'O delta aponta para uma capacidade que não existe nas specs do workspace. Use ADDED para uma ' +
    'capacidade nova, ou corrija o caminho da capacidade',
  DELTA_MISSING_REQUIREMENT:
    'O delta aponta para um requisito que a spec do workspace não declara. O texto do cabeçalho precisa bater exatamente',
  DELTA_ADDED_EXISTS:
    'O requisito ADDED já existe na spec do workspace - use MODIFIED para alterá-lo',
  TASK_NUMBER_OUT_OF_ORDER: 'Os números das tarefas estão fora de ordem dentro do grupo',
  TASK_NUMBER_DUPLICATE: 'Número de tarefa duplicado',
  TASKS_INCOMPLETE: 'A change tem tarefas não marcadas',
} as const;
