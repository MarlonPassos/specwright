# Project Planning

> **Status:** capacidade completa (Fases 1–5), opt-in. Modelo, proveniência,
> validação, grafo, três dimensões de estado, `generate`, `status`, `next`,
> `show`, dashboard (com `--watch`), os seis comandos de harness, vínculo
> (`link`/`unlink`/`adopt`/`sync`/`set-state`), mutação por bundle (`apply`),
> `impact`, `list` e o ciclo de vida do plano (`pause`/`resume`/`archive`).

O Project Planning adiciona uma camada de **plano** acima da unidade `change`:
uma forma de decompor um documento grande em incrementos ordenados, rastreáveis e
validados por código, sem tocar em nada do ciclo de change existente.

É **opt-in**. Sem `planning/<plan-id>/plan.yaml`, o Specwright se comporta
exatamente como antes — nenhum comando existente muda de nome, opção ou saída.

## Layout

```
<raiz-do-projeto>/
├── spec/                      # inalterado
└── planning/
    └── <plan-id>/
        ├── plan.yaml          # manifesto estruturado — única fonte da estrutura
        ├── plan.md            # documento humano do plano
        ├── architecture.md    # arquitetura e decisões transversais
        └── planned-changes/
            └── CH-001-<slug>.md
```

`planning/` é criado por `specs project create` e nunca participa da descoberta
de workspace (que continua procurando só `spec/config.yaml`).

## `plan.yaml`

| Campo | Tipo | Notas |
|---|---|---|
| `schema_version` | `1` | única versão suportada |
| `revision` | `int >= 0` | incrementado a cada escrita; base da detecção de conflito |
| `id` | kebab-case | igual ao nome do diretório; imutável |
| `name` | string | nome humano |
| `status` | `draft \| reviewing \| active \| paused \| completed \| archived` | declarado |
| `owner`, `summary` | string | opcionais |
| `scope.in` / `scope.out` | `string[]` | fronteira declarada |
| `created_at` / `updated_at` | `YYYY-MM-DD` | data local |
| `source_documents` | `{path, sha256}[]` | fontes, com hash do conteúdo no registro |
| `milestones` | `Milestone[]` | agrupamento ordenado |
| `changes` | `ProjectChange[]` | catálogo de incrementos |

Cada **Project Change** carrega `id` (`^CH-\d{3,}$`, imutável e nunca
reutilizado), `slug` (kebab-case), `title`, `planning_state`
(`idea | planned | on_hold | cancelled` — o **único** estado persistido),
`priority`, `depends_on` (somente IDs), `manual_blockers`, `superseded_by`,
`milestone`, `planned_change` e `link`.

A serialização é determinística: `load → save → load` é byte-idêntico. As chaves
saem em ordem fixa, `changes` na ordem de declaração e `milestones` por `order`.

## Planned Change

`planning/<plan-id>/planned-changes/<ID>-<slug>.md`: um Markdown com frontmatter
(`schema_version`, `id`, `slug`, `title`, `plan_revision`) e as seções
**Objetivo**, **Escopo** e **Critérios macro** obrigatórias (as demais são
recomendadas). Um Planned Change é planejamento macro — nunca contém cabeçalho de
delta (`## ADDED/MODIFIED/REMOVED/RENAMED Requirements`) e as regras de requisito
`SHALL`/`MUST` não se aplicam a ele.

## Proveniência

Cada Planned Change materializado registra `source_hash` (hash do conjunto de
fontes na ordem declarada) e `content_hash` (hash dos bytes gravados). Daí sai o
estado derivado `current` / `outdated` / `modified` / `missing`, que responde sem
julgamento humano: *a fonte mudou desde que este brief foi escrito?* e *alguém
editou este brief à mão?* Os hashes normalizam CRLF/CR para LF antes de calcular,
então independem de plataforma.

## Três dimensões de estado

Uma Project Change não tem um campo único de status. Três dimensões independentes,
e nenhuma sobrescreve a outra:

| Dimensão | Origem | Valores |
|---|---|---|
| `planning_state` | **persistido** em `plan.yaml` | `idea` · `planned` · `on_hold` · `cancelled` |
| `readiness` | **derivado** do grafo e da materialização | `ready` · `blocked` · `not_applicable` |
| `execution` | **observado** no filesystem da change nativa | `unlinked` · `proposed` · `in_progress` · `verifying` · `archived` · `unknown` |

`readiness: ready` exige `planning_state: planned`, Planned Change `current`, toda
dependência com `execution: archived` e nenhum blocker manual. Um blocker manual
tem precedência sobre dependência e aparece em `manualBlockers`, com `blockedBy`
vazio. Nada derivado é gravado — `status` recalcula tudo a cada leitura.

Um incremento concluído **continua** com `readiness: ready` (§7.6, cenário D): a
conclusão vive em `execution: archived`, e nunca em `planning_state`, que não tem
valor `done`. Por isso `progress.ready` e `progress.blocked` contam só o que ainda
não foi entregue — a mesma regra de elegibilidade que `next` usa, para que
`progress.ready` não discorde de `next.parallelReady` no mesmo payload.

## Comandos

```
specs project                                     # dashboard humano
specs project --json                              # dashboard estruturado (statusPayload + dashboardSchemaVersion + generatedAt)
specs project create <plan-id> [fontes...] [--name <nome>] [--owner <nome>] [--json]
specs project validate [<plan-id>] [--strict] [--json]
specs project status   [<plan-id>] [--json]
specs project next     [<plan-id>] [--json]
specs project show     [<plan-id>] <change-id> [--json]
specs project generate [<plan-id>] [--change <id>...] [--milestone <id>]
                                   [--dry-run] [--force] [--expect-revision <n>] [--json]
specs project link     [<plan-id>] <change-id> <change-name> [--json]
specs project unlink   [<plan-id>] <change-id> [--force] [--json]
specs project adopt    [<plan-id>] <change-name|archive-dir> [--json]
specs project sync     [<plan-id>] [--check] [--json]
specs project set-state [<plan-id>] <change-id> <state> [--reason <texto>] [--json]
specs project apply    [<plan-id>] [--file <path>|-] [--dry-run] [--allow-completed]
                                   [--expect-revision <n>] [--json]
specs project impact   [<plan-id>] --change <id>... [--json]
specs project list     [--json]
specs project pause    [<plan-id>] --reason <texto> [--json]
specs project resume   [<plan-id>] [--json]
specs project archive  [<plan-id>] [--json]
specs project --watch [--interval <s>]
```

- `status` — identidade e revisão do plano, progresso geral e por milestone, cada
  Project Change com as três dimensões e códigos de razão estáveis, milestones
  derivados e diagnósticos.
- `next` — recomendação determinística (ranking de cinco níveis: prioridade,
  desbloqueios transitivos, desbloqueios diretos, `milestone.order`, índice de
  declaração), `alternatives`, `parallelReady` com ressalva, e `excluded` com o
  código que eliminou cada incremento. Sem elegíveis, `recommended` é `null`.
- `generate` — materializa os briefs dos incrementos selecionados. Idempotente
  (`current` → `skipped`), detecta fonte alterada (`outdated`) e edição humana
  (`modified`, recusa sem `--force`), projeta o bloco de roadmap em `plan.md`
  preservando o texto fora dos marcadores, e recusa grafo inválido antes de
  qualquer escrita. `--dry-run` não toca no disco.

## Vínculo, adoção e sincronização

O **vínculo** é uma referência 1:1 entre uma Project Change e uma Specwright
Change, criada só por operação explícita — nada é inferido de título, data ou
similaridade.

- `link <change-id> <change-name>` — exige o incremento existente e não
  cancelado nem concluído, `spec/changes/<change-name>/` presente e o nome livre.
- `unlink <change-id>` — remove o vínculo; exige `--force` quando a execução
  observada já é `archived`.
- `adopt <change-name|archive-dir>` — cria uma Project Change (`planning_state:
  planned`, id novo, brief `missing`) a partir de uma change fora do plano, já
  vinculada. Não escreve nada dentro da change nativa.
- `sync [--check]` — reconcilia só o bloco `link`: preenche `archive_path`
  quando um archive resolve, limpa `active_path` quando o diretório ativo some,
  reporta `dangling_link`. Nunca cria vínculo, nunca adota, nunca toca a change
  nativa. Idempotente. `--check` não escreve.
- `set-state <change-id> <state> [--reason]` — aplica uma transição de
  `planning_state` validada contra a máquina de §7.6
  (`idea→planned|cancelled`, `planned→on_hold|cancelled`,
  `on_hold→planned|cancelled`, sem volta de `cancelled`). `on_hold` e
  `cancelled` exigem `--reason`.

O `archive_path` persistido é um **atalho de leitura**: `status` resolve o
archive por padrão a cada execução, então a conclusão nunca depende de `sync`.
`specs archive` não conhece o plano — não há hook nem campo novo no seu JSON.

## Mutação por bundle (`apply`)

Toda mudança estrutural além dos comandos próprios — `addChange`, `updateChange`,
`setDependencies`, `setBlockers`, `renameSlug`, `replacePlannedChange`,
`splitChange`, `mergeChanges`, `setMilestones`, `writeDocument` — passa por um
**bundle JSON** aplicado por `specs project apply` (stdin ou `--file`).

O contrato completo é publicado pela própria CLI, então um assistente trabalhando
num projeto que apenas *instala* o specwright não precisa deste arquivo:

```bash
specs project bundle-schema --json
```

Ele devolve raiz, operações com campos obrigatórios e opcionais,
`PlannedChangeSpec`, as regras e um exemplo que aplica. Um teste garante que o
catálogo publicado não diverge da união zod que o parser usa de verdade.

```json
{
  "bundleVersion": 1,
  "expectRevision": 7,
  "plan": { "name": "...", "status": "active", "sourceDocuments": ["docs/x.md"] },
  "operations": [
    { "op": "addChange", "ref": "$a", "slug": "foundation", "title": "Fundação",
      "priority": "critical", "dependsOn": [],
      "plannedChange": { "objetivo": "...", "escopo": ["..."], "criteriosMacro": ["..."] } },
    { "op": "splitChange", "id": "CH-008",
      "into": [ { "ref": "$s1", "slug": "cart", "title": "Carrinho" },
                { "ref": "$s2", "slug": "pay", "title": "Pagamento", "dependsOn": ["$s1"] } ],
      "rewire": { "CH-009": ["$s1"], "CH-010": ["$s1", "$s2"] } }
  ]
}
```

- `expectRevision` precisa casar a revisão no disco (`plan_revision_conflict`).
- `$ref` só em `addChange` e `splitChange.into`; `dependsOn`/`rewire`/milestones
  aceitam ID real ou `ref` do mesmo bundle. Um ref é `$` seguido de letras,
  dígitos, `_` ou `-` — espelhar o slug (`$bug-fixes`) é a convenção mais simples.
- Nenhuma operação atinge um incremento `archived` sem `--allow-completed` (e aí
  o relatório traz um `WARNING`).
- **Split** marca o original `cancelled` com `superseded_by: [novos IDs]` e exige
  `rewire` cobrindo todos os dependentes. O ID original nunca é reutilizado.
- **Merge** escolhe um `survivor ∈ ids`, marca os demais `cancelled`, e é
  recusado se qualquer entrada estiver concluída.
- O estado proposto passa por `ProjectGraph.from` (ciclo → `plan_invalid`) antes
  de qualquer escrita. `--dry-run` imprime `idMap`, diff e impacto sem tocar no
  disco. A escrita é por staging: falha no meio deixa um estado detectável, não
  um manifesto inválido.

`specs project impact --change <id>...` calcula dependentes, ancestrais,
milestones atingidos, changes vinculadas com o estado resolvido, capabilities
compartilhadas, Planned Changes afetados e incrementos concluídos atingidos.

`sharedCapabilities` é uma lista de entradas, não de strings: uma change
vinculada cujo diretório não existe mais aparece como
`{ "capability": null, "change": "CH-00N", "reason": "change_dir_missing" }` —
nunca omitida em silêncio.

## Ciclo de vida do plano

`specs project list` indexa os planos (`id`, status declarado e derivado,
progresso). `pause --reason` / `resume` / `archive` movem o `status` declarado —
o derivado continua sendo confrontado a cada `status`. `specs project --watch`
repinta o dashboard por polling reusando o mesmo loop de `specs status --watch`
(`--interval <s>`, Ctrl+C sai na hora, `--json` e `--watch` são exclusivos).

## Comandos de harness

Seis comandos gerados para os quatro harnesses (`/spec-project-plan`,
`-review`, `-generate`, `-status`, `-next`, `-refine`). Cada corpo instrui: não
implementar código, não criar artefatos de change, consultar estado por `--json`,
mostrar preview e pedir confirmação em mensagem separada antes da primeira
escrita, e rotular fato, cálculo e recomendação. O catálogo gerado passa de sete
para treze comandos; `specs init`/`update --harnesses all` escrevem 52 arquivos.

- `create` é idempotente por recusa: um plano existente falha com `plan_exists` e
  nenhum arquivo é modificado. Uma fonte fora da raiz do projeto (`..`, absoluto,
  NUL) falha com `unsafe_source_path`.
- `validate` reutiliza o envelope de `specs validate`: `{ valid, strict, reports,
  summary }`, com `reports[].type` em `plan` ou `planned-change`. Sai com `1`
  quando inválido.

### Regras de validação (subconjunto independente de grafo)

**ERROR** — falham `validate` e bloqueiam qualquer escrita: YAML inválido;
`schema_version` ausente ou maior que o suportado; `id` do plano diferente do
diretório; `id`/`slug` de incremento inválido ou duplicado; `depends_on` com id
inexistente ou auto-dependência; `superseded_by` com id inexistente;
`planned_change.path` fora de `planned-changes/` ou com nome errado; arquivo de
brief ausente; frontmatter ausente/inválido ou divergente do manifesto; seção
obrigatória vazia; cabeçalho de delta no brief; path inseguro; fonte fora da
raiz; milestone inexistente, duplicado ou com `order` repetido; relação
incremento ↔ milestone inconsistente; dois incrementos com o mesmo `link.name`;
`link.active_path` / `link.archive_path` fora do lugar.

**WARNING** — falham só sob `--strict`: `priority` ausente (default aplicado);
seção recomendada vazia no brief; `missing_source`; `source_changed`;
`orphan_planned_change`; `plan.md`/`architecture.md` ausente; plano em `draft`
com briefs já materializados.

A detecção de **ciclo** (`dependency_cycle`, com o caminho na mensagem) falha
antes de qualquer escrita. Os diagnósticos derivados que aparecem em
`specs project status` — `dangling_link`, `duplicate_link`, `source_changed`,
`missing_source`, `ambiguous_archive_match` — usam código estável e trazem `fix`
quando há recuperação óbvia.

## Limites

- O core não faz análise semântica de documentos. Decompor, propor dependências e
  redigir prosa é trabalho do agente; o core valida a estrutura do resultado.
- Nenhum comando de plano cria, implementa, verifica ou arquiva uma change.
- Nenhum conteúdo de documento-fonte é copiado para o manifesto, um Planned
  Change, um relatório ou um log — só o `path` e o `sha256`.
