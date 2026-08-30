# Schemas de workflow

Um schema declara os artefatos de que uma change é feita: o que cada um gera, do que
depende, o template a partir do qual é escrito e as instruções que o agente recebe. A CLI
deriva a ordem de construção, o conjunto pronto e o conjunto bloqueado desse grafo —
nenhuma etapa do workflow é hardcoded.

## O schema embutido

O `spec-driven` é o padrão:

| Artefato | Gera | Requer |
| --- | --- | --- |
| `proposal` | `proposal.md` | — |
| `specs` | `specs/**/*.md` | `proposal` |
| `design` | `design.md` | `proposal` |
| `tasks` | `tasks.md` | `specs`, `design` |

A fase de apply dele requer `tasks` e acompanha o progresso no `tasks.md`.

## Formato

```yaml
name: spec-driven
version: 1
description: Default workflow - proposal -> specs -> design -> tasks
artifacts:
  - id: proposal
    generates: proposal.md          # um caminho, ou um padrão como specs/**/*.md
    description: States the problem and the scope
    template: proposal.md           # relativo ao diretório templates/ do schema
    requires: []
    instruction: |
      Orientação que o agente recebe para este artefato.
apply:
  requires: [tasks]                 # artefatos de que a implementação depende
  tracks: tasks.md                  # arquivo cujos checkboxes acompanham o progresso, ou null
  instruction: |
    Orientação para a fase de implementação.
```

Regras que o loader impõe:

- ids de artefato são kebab-case e únicos;
- `requires` e `apply.requires` só podem nomear artefatos declarados;
- o grafo de dependências precisa ser acíclico — um ciclo é reportado com o caminho dele;
- `generates` e `template` precisam ser caminhos relativos que fiquem dentro do próprio
  diretório.

Empates no grafo são desfeitos pela ordem de declaração, então `specs` vem antes de
`design` porque o schema o lista primeiro, não por causa do nome.

## Um schema customizado

Coloque no workspace:

```
spec/schemas/<name>/schema.yaml
spec/schemas/<name>/templates/<template>.md
```

Depois aponte o workspace para ele, ou uma única change:

```yaml
# spec/config.yaml
schema: <name>
```

```bash
specs new change add-thing --schema <name>
```

Um schema do workspace sombreia um embutido de mesmo nome, que é como o schema
`spec-driven` distribuído pode ser adaptado sem forkar a ferramenta. Uma change registra
no `.change.yaml` dela o schema com que foi criada, então mudar o padrão do workspace
nunca remodela retroativamente trabalho já em andamento.

Confira o que foi resolvido:

```bash
specs schemas --json      # o que está disponível, e qual está ativo
specs templates --json    # o template por trás de cada artefato
```

## Contexto e regras do projeto

O `spec/config.yaml` também carrega as restrições que todo artefato herda:

```yaml
schema: spec-driven
context: |
  Node.js, TypeScript, ESM. Runs on macOS, Linux and Windows.
rules:
  specs:
    - Requirements involving file paths must state cross-platform behavior
  tasks:
    - Include a verification step for anything touching the filesystem
```

`context` e `rules` chegam ao agente através do `specs instructions` como restrições sobre o
que ele escreve — nunca como conteúdo para copiar dentro do artefato.
