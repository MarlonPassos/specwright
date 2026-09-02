/**
 * The machine-readable bundle contract.
 *
 * `specs project apply` is the only way an assistant mutates a plan, but the
 * bundle shape lived only in this repository's `docs/`. An assistant working in
 * a project that merely *installs* specwright cannot read those docs, so it was
 * reduced to probing `apply --dry-run` with deliberately broken payloads to
 * read the schema back out of the error messages — and still never discovered
 * `$ref`. This module makes the contract reachable from the CLI itself.
 */

export interface BundleField {
  name: string;
  type: string;
  required: boolean;
  note?: string;
}

export interface BundleOperationDoc {
  op: string;
  summary: string;
  fields: BundleField[];
}

const PLANNED_CHANGE_SPEC = 'PlannedChangeSpec';

const req = (name: string, type: string, note?: string): BundleField => ({
  name,
  type,
  required: true,
  ...(note ? { note } : {}),
});
const opt = (name: string, type: string, note?: string): BundleField => ({
  name,
  type,
  required: false,
  ...(note ? { note } : {}),
});

const REF = '"$nome" — letras, dígitos, "_" ou "-"';
const ID_OR_REF = '"CH-NNN" | "$nome"';

export const BUNDLE_OPERATIONS: BundleOperationDoc[] = [
  {
    op: 'addChange',
    summary: 'Cria um incremento. O ID é alocado pela CLI, nunca por você.',
    fields: [
      opt('ref', REF, 'apelido para citar este incremento nas operações seguintes do MESMO bundle'),
      req('slug', 'string', 'kebab-case, único no plano'),
      req('title', 'string'),
      opt('priority', '"critical" | "high" | "medium" | "low"', 'default: medium'),
      opt('dependsOn', `Array<${ID_OR_REF}>`),
      opt('milestone', 'string | null', 'id de um milestone declarado em setMilestones'),
      opt('plannedChange', PLANNED_CHANGE_SPEC, 'sem isto, o brief nasce como esqueleto'),
    ],
  },
  {
    op: 'updateChange',
    summary: 'Altera título ou prioridade de um incremento existente.',
    fields: [req('id', ID_OR_REF), req('set', '{ title?: string, priority?: Priority }')],
  },
  {
    op: 'setDependencies',
    summary: 'Substitui a lista de dependências (não acumula).',
    fields: [req('id', ID_OR_REF), req('dependsOn', `Array<${ID_OR_REF}>`)],
  },
  {
    op: 'setBlockers',
    summary: 'Substitui os bloqueios manuais. Um bloqueio manual impede readiness.',
    fields: [req('id', ID_OR_REF), req('manualBlockers', 'Array<string>')],
  },
  {
    op: 'renameSlug',
    summary: 'Renomeia o slug; o ID e o arquivo do brief acompanham na mesma transação.',
    fields: [req('id', ID_OR_REF), req('slug', 'string')],
  },
  {
    op: 'replacePlannedChange',
    summary: 'Reescreve o brief de um incremento a partir de campos estruturados.',
    fields: [req('id', ID_OR_REF), req('plannedChange', PLANNED_CHANGE_SPEC)],
  },
  {
    op: 'splitChange',
    summary:
      'Divide um incremento. O original vira cancelled com superseded_by e o ID nunca é reutilizado.',
    fields: [
      req('id', ID_OR_REF),
      req('into', 'Array<{ ref?, slug, title, dependsOn?, plannedChange? }>', 'mínimo 2 entradas'),
      req('rewire', `Record<"CH-NNN", Array<${ID_OR_REF}>>`, 'precisa cobrir TODOS os dependentes do id dividido'),
    ],
  },
  {
    op: 'mergeChanges',
    summary: 'Funde incrementos em um sobrevivente; os demais viram cancelled.',
    fields: [
      req('ids', 'Array<"CH-NNN">', 'mínimo 2'),
      req('survivor', '"CH-NNN"', 'precisa estar em ids'),
      opt('plannedChange', PLANNED_CHANGE_SPEC),
    ],
  },
  {
    op: 'setMilestones',
    summary: 'Substitui a lista inteira de milestones.',
    fields: [
      req('milestones', `Array<{ id: string, name: string, order: int>=1, changes: Array<${ID_OR_REF}> }>`),
    ],
  },
  {
    op: 'writeDocument',
    summary: 'Escreve plan.md ou architecture.md. target é um alvo lógico, NÃO um path.',
    fields: [req('target', '"plan" | "architecture"'), req('content', 'string')],
  },
];

export const PLANNED_CHANGE_FIELDS: BundleField[] = [
  opt('objetivo', 'string'),
  opt('motivacao', 'string'),
  opt('escopo', 'Array<string>'),
  opt('foraDoEscopo', 'Array<string>'),
  opt('criteriosMacro', 'Array<string>'),
  opt('riscos', 'Array<string>'),
  opt('notas', 'Array<string>'),
  opt('referencias', 'Array<string>'),
  opt('readiness', 'string'),
];

export const BUNDLE_ROOT_FIELDS: BundleField[] = [
  req('bundleVersion', '1'),
  req('expectRevision', 'int >= 0', 'o plan.revision que você leu em `specs project status --json`'),
  opt('plan', '{ name?, status?, summary?, scope?: { in: [], out: [] }, sourceDocuments?: [] }'),
  req('operations', 'Array<Operation>', 'pode ser vazio'),
];

export const BUNDLE_RULES: string[] = [
  'Você NUNCA escolhe um ID. `addChange` e `splitChange.into` alocam CH-NNN; use `ref` para citá-los no mesmo bundle e leia os IDs reais em `idMap` na resposta.',
  '`ref` é declarado só em `addChange` e `splitChange.into`. `dependsOn`, `rewire` e `milestones[].changes` aceitam um ID real OU um `ref` declarado ANTES, no mesmo bundle.',
  'Um ref é `$` seguido de letras, dígitos, `_` ou `-`: `$bug-fixes` vale, e espelhar o slug é a convenção mais simples.',
  'Todo objeto é estrito: um campo desconhecido derruba o bundle inteiro com `invalid_bundle`.',
  '`expectRevision` precisa casar a revisão no disco, senão `plan_revision_conflict`.',
  'Nenhuma operação atinge um incremento concluído sem `--allow-completed`.',
  'O estado proposto é validado inteiro antes da primeira escrita: ciclo de dependência ou brief inválido aborta sem tocar no disco.',
  'Rode sempre `--dry-run --json` antes: ele devolve o `idMap`, a revisão futura, os arquivos que mudariam e a validação real.',
];

/** A worked example. Kept parseable by `parseBundle` — a test asserts it. */
export const BUNDLE_EXAMPLE = {
  bundleVersion: 1,
  expectRevision: 0,
  plan: {
    name: 'Melhorias do produto',
    status: 'active' as const,
    sourceDocuments: ['docs/PLANO-DE-MELHORIAS.md'],
  },
  operations: [
    {
      op: 'addChange' as const,
      ref: '$fundacao',
      slug: 'fundacao-cli',
      title: 'Fundação do CLI',
      priority: 'critical' as const,
      plannedChange: {
        objetivo: 'Estabelecer a base de comandos.',
        escopo: ['parser de argumentos', 'códigos de saída'],
        criteriosMacro: ['build verde', 'ajuda documentada'],
      },
    },
    {
      op: 'addChange' as const,
      ref: '$ux',
      slug: 'ux-terminal',
      title: 'UX de terminal',
      dependsOn: ['$fundacao'],
    },
    {
      op: 'setMilestones' as const,
      milestones: [
        { id: 'M1', name: 'Base', order: 1, changes: ['$fundacao'] },
        { id: 'M2', name: 'Experiência', order: 2, changes: ['$ux'] },
      ],
    },
  ],
};

export interface BundleContract {
  bundleVersion: number;
  command: string;
  root: BundleField[];
  operations: BundleOperationDoc[];
  plannedChangeSpec: BundleField[];
  rules: string[];
  example: typeof BUNDLE_EXAMPLE;
}

export function bundleContract(bundleVersion: number): BundleContract {
  return {
    bundleVersion,
    command: 'specs project apply [plan-id] [--file <path>] [--dry-run] [--json]',
    root: BUNDLE_ROOT_FIELDS,
    operations: BUNDLE_OPERATIONS,
    plannedChangeSpec: PLANNED_CHANGE_FIELDS,
    rules: BUNDLE_RULES,
    example: BUNDLE_EXAMPLE,
  };
}

function renderFields(fields: BundleField[], indent: string): string[] {
  return fields.map((field) => {
    const mark = field.required ? '' : '?';
    const note = field.note ? `  — ${field.note}` : '';
    return `${indent}${field.name}${mark}: ${field.type}${note}`;
  });
}

/** Human-readable rendering for the non-`--json` path. */
export function renderBundleContract(contract: BundleContract): string[] {
  const lines: string[] = [
    `Bundle de mutação do plano (bundleVersion ${contract.bundleVersion})`,
    '',
    `Entrada por stdin ou --file: ${contract.command}`,
    '',
    'Raiz',
    ...renderFields(contract.root, '  '),
    '',
    'Operações',
  ];
  for (const operation of contract.operations) {
    lines.push('', `  ${operation.op} — ${operation.summary}`, ...renderFields(operation.fields, '    '));
  }
  lines.push(
    '',
    'PlannedChangeSpec (usado em addChange, splitChange.into, replacePlannedChange, mergeChanges)',
    ...renderFields(contract.plannedChangeSpec, '  '),
    '',
    'Regras'
  );
  contract.rules.forEach((rule, index) => lines.push(`  ${index + 1}. ${rule}`));
  lines.push('', 'Exemplo', ...JSON.stringify(contract.example, null, 2).split('\n').map((l) => `  ${l}`));
  return lines;
}
