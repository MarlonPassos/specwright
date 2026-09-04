# Regras de validação

O `specs validate` reporta problemas em três níveis. `ERROR` sempre reprova o relatório;
`WARNING` só reprova sob `--strict`; `INFO` nunca reprova.

```bash
specs validate <change>              # uma change
specs validate <capability> --type spec
specs validate --all --strict        # todas as changes e specs, warnings incluídos
specs validate --archived            # changes arquivadas precisam ter toda tarefa marcada
```

## Changes

| Nível | Regra |
| --- | --- |
| ERROR | O `proposal.md` existe, com uma seção `## Why` e uma `## What Changes` |
| ERROR | `## Why` tem pelo menos 50 caracteres de conteúdo real |
| ERROR | `## What Changes` não está vazia |
| ERROR | A change tem pelo menos um delta, a não ser que o `.change.yaml` defina `skip_specs: true` |
| ERROR | `skip_specs` não está definido junto com arquivos de delta |
| ERROR | O `.change.yaml` faz parse como metadados de change |
| ERROR | Cada arquivo de delta tem pelo menos um cabeçalho de seção de delta |
| ERROR | Um delta MODIFIED, REMOVED ou RENAMED aponta para uma capacidade que existe |
| ERROR | Ele aponta para um requisito que a capacidade de fato declara |
| WARNING | Mais de 10 deltas numa mesma change |
| WARNING | Um requisito REMOVED sem **Reason** ou sem **Migration** |
| WARNING | Um requisito ADDED cujo nome já existe na spec |
| WARNING | Um delta de capacidade nova sem `## Purpose`, ou com menos de 50 caracteres |
| WARNING | Números de tarefa duplicados ou fora de ordem dentro do grupo |

Placeholders de template não contam como conteúdo: uma seção `## Why` contendo só um
comentário HTML está vazia.

## Requisitos

Aplicadas tanto a requisitos de spec principal quanto a deltas ADDED / MODIFIED:

| Nível | Regra |
| --- | --- |
| ERROR | O requisito tem texto |
| ERROR | O texto usa SHALL ou MUST |
| ERROR | O requisito tem pelo menos um cenário |
| ERROR | Nenhum cenário está vazio |
| WARNING | Texto de requisito acima de 500 caracteres |

Um cenário é um cabeçalho de nível 4 — `#### Scenario: <name>`. Três cerquilhas ou uma
lista com marcadores não é um cenário, e o requisito então é lido como não tendo nenhum.

## Specs

| Nível | Regra |
| --- | --- |
| ERROR | Uma seção `## Purpose` existe e não está vazia |
| ERROR | Uma seção `## Requirements` existe e declara pelo menos um requisito |
| ERROR | Nenhum cabeçalho de delta (`## ADDED Requirements` e companhia) numa spec principal |
| ERROR | Nenhum requisito declarado fora da seção `## Requirements` |
| ERROR | Não há dois requisitos com o mesmo nome |
| WARNING | `## Purpose` com menos de 50 caracteres |
| WARNING | `## Purpose` ainda é placeholder — o que o arquivamento escreve, ou um `TBD`/`TODO` |

Os três erros estruturais descrevem todos conteúdo que fica invisível em silêncio: um
cabeçalho de delta trunca a seção de requisitos parseada, um requisito fora de
`## Requirements` não é lido por nada, e nomes duplicados tornam toda busca ambígua.

## Changes arquivadas

O `specs validate --archived` aplica as regras de change a tudo que está sob
`spec/changes/archive/` e adiciona uma: toda tarefa precisa estar marcada. Serve para uma
checagem de pre-commit ou CI que pega uma change arquivada com trabalho ainda aberto.

## Project Plan

O `specs project validate` roda sobre `planning/<plan-id>/`. Fase 1 cobre as
regras que não dependem do grafo (ciclo e estado derivado chegam depois).

### Manifesto — ERROR

| Regra |
| --- |
| YAML inválido; `schema_version` ausente ou maior que o suportado |
| `id` do plano fora de kebab-case, ou diferente do nome do diretório |
| `id`/`slug` de incremento inválido ou duplicado |
| `depends_on` cita id inexistente; auto-dependência |
| `superseded_by` cita id inexistente |
| `planned_change.path` fora de `planned-changes/`, ou nome diferente de `<id>-<slug>.md` |
| Arquivo de brief referenciado pelo manifesto não existe |
| Documento-fonte com `..`, absoluto, NUL, ou fora da raiz do projeto |
| Milestone inexistente, `id` duplicado, `order` duplicado, membro repetido |
| Relação incremento ↔ milestone inconsistente em um dos sentidos |
| Dois incrementos com o mesmo `link.name`; `link.*_path` fora do lugar |

### Manifesto — WARNING (falha só sob `--strict`)

`priority` ausente (default aplicado); `missing_source`; `source_changed`;
`orphan_planned_change`; `plan.md`/`architecture.md` ausente com incrementos;
plano em `draft` com briefs já materializados.

## Planned Changes

| Nível | Regra |
| --- | --- |
| ERROR | Frontmatter ausente, inválido, ou com `id`/`slug` divergentes do manifesto |
| ERROR | Nome do arquivo diferente de `<id>-<slug>.md` |
| ERROR | Seção `Objetivo`, `Escopo` ou `Critérios macro` ausente ou vazia |
| ERROR | Cabeçalho de delta (`## ADDED/MODIFIED/REMOVED/RENAMED Requirements`) |
| WARNING | Seção recomendada (`Motivação`, `Riscos`, `Fora do escopo`, …) ausente ou vazia |
| WARNING | Conteúdo editado à mão (`modified`) ou fonte alterada (`outdated`) num incremento `planned` |

## Vínculo (Project Planning)

O `specs project sync` e o `status` reportam, como diagnóstico de leitura:

| Nível | Código | Quando |
| --- | --- | --- |
| ERROR | `dangling_link` | o vínculo aponta para um diretório que não existe ativo nem arquivado — a execução fica `unknown`, nunca `archived` |
| ERROR | `link_target_mismatch` | `active_path` é seguro, mas não aponta para `spec/changes/<link.name>` |
| ERROR | `duplicate_link` | dois incrementos usam a mesma change nativa |
| WARNING | `ambiguous_archive_match` | mais de um diretório de archive casa o slug; escolhe o de maior data e sufixo |
| WARNING | `source_changed` / `missing_source` | um documento-fonte mudou ou sumiu desde o registro |
| WARNING | `record_hash_missing` | o brief foi gravado antes da prova de identidade do incremento; rode `specs project generate` |
| WARNING | `invalid_archive_path` | o `archive_path` persistido não é um diretório de archive válido e foi ignorado |
| WARNING | `ambiguous_archive_identity` | o nome do archive pode ser um slug terminado em número ou uma colisão; use `adopt --slug` |

Uma change que fica **fora do plano** indefinidamente é válida: não há warning que
a trate como erro.
