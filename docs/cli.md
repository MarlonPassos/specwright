# Referência da CLI

Todo comando encontra o workspace subindo a partir do diretório de trabalho, então pode
ser rodado de qualquer lugar dentro do projeto.

Todo comando aceita `--json`. Com ele, o stdout carrega exatamente um documento JSON,
tenha o comando dado certo ou não; uma falha adiciona um objeto `error`:

```json
{
  "changes": [],
  "error": { "code": "workspace_not_found", "message": "...", "fix": "specs init" }
}
```

Códigos de saída: `0` em sucesso, `1` em falha. O `specs validate` sai com `1` quando o
relatório não está válido, o que sob `--strict` inclui warnings.

## Setup

### `specs init [path]`

Cria o workspace e escreve os arquivos de comando do harness.

| Opção | Significado |
| --- | --- |
| `--harnesses <list>` | `all` (padrão), ou uma lista separada por vírgula de `claude`, `codex`, `opencode`, `kiro` |
| `--schema <name>` | Schema de workflow para novas changes; padrão `spec-driven` |
| `--json` | Saída em JSON |

Rodar o `init` de novo é seguro: ele mantém o schema configurado, adiciona os harnesses
recém-selecionados aos existentes, regera todos os arquivos de comando e nunca sobrescreve
o `spec/project.md`.

### `specs update [path]`

Regera os arquivos de comando dos harnesses que o workspace declara. Passe
`--harnesses <list>` para adicionar harnesses; essa seleção é então persistida.

### `specs harnesses`

Lista os harnesses suportados, onde cada um escreve seus arquivos de comando, e os
comandos gerados para todos eles.

## Changes

### `specs new change <name>`

Cria `spec/changes/<name>/` com os metadados dela. O nome precisa ser kebab-case.

| Opção | Significado |
| --- | --- |
| `--schema <name>` | Schema de workflow desta change |
| `--goal <text>` | Objetivo registrado nos metadados da change |
| `--skip-specs` | Declara que a change não altera nenhum comportamento observável |

### `specs status`

Sem argumentos, desenha o painel do projeto: resumo, changes agrupadas pela fase do
workflow, capacidades e arquivo. Com `--change` ou `--all`, reporta a conclusão dos
artefatos.

| Opção | Significado |
| --- | --- |
| `--change <id>` | A change; padrão é a única ativa |
| `--all` | Reporta sobre todas as changes ativas |
| `--schema <name>` | Sobrescreve o schema |
| `--watch` | Redesenha o painel continuamente até `Ctrl+C` |
| `--interval <segundos>` | Intervalo do `--watch`; padrão `2` |
| `--no-color` | Desenha sem cor nem glifos Unicode |

O painel agrupa cada change pela fase em que ela está, derivada dos artefatos e do
checklist: **em planejamento** enquanto `applyBlockedBy` não está vazio, **implementando**
depois disso, e **pronta para arquivar** quando toda tarefa está marcada. Uma change que
não pode ser lida aparece em **com problema**, com a mensagem — uma change quebrada não
apaga o painel inteiro.

O `--watch` é somente leitura. Ele redesenha por cima do quadro anterior, sem limpar a tela
antes, então não pisca; um quadro mais alto que a janela é cortado com a contagem do que
ficou de fora. `Ctrl+C` encerra na hora, sem esperar o intervalo. Sem terminal, cada quadro
sai como um snapshot separado. Não combina com `--json`, `--change` nem `--all`.

O JSON carrega `artifacts` (cada um com `state`, `generates`, `outputs`, `requires`,
`missing`), `applyRequires`, `applyBlockedBy`, `next`, `tasks`, e os caminhos resolvidos
`workspace` e `changeRoot`.

O `state` de um artefato é um destes:

| Estado | Significado |
| --- | --- |
| `done` | A saída dele existe |
| `ready` | As dependências estão satisfeitas e ele pode ser escrito agora |
| `blocked` | Uma dependência ainda falta (`missing` lista quais) |
| `skipped` | A change abriu mão dele; não deve ser escrito |

O `state` reporta apenas a existência do arquivo. Use `applyRequires` para saber o que
ainda está devendo.

### `specs instructions [artifact]`

Imprime as instruções de um artefato, ou das fases `implement` / `archive`. Sem um
artefato, serve o próximo que estiver pronto.

O JSON carrega `instruction`, `template`, `context`, `rules`, `outputPath`,
`outputIsPattern`, `dependencies`, e — quando a change abriu mão — `skipped` e `warning`.
`context` e `rules` são restrições para quem escreve, nunca conteúdo para o arquivo.

### `specs archive [change]`

Aplica os deltas da change nas specs do workspace e a move para o arquivo.

| Opção | Significado |
| --- | --- |
| `--skip-specs` | Não aplicar os deltas |
| `--no-validate` | Arquivar sem validar antes |
| `--force` | Arquivar apesar de tarefas não marcadas |

## Inspeção

### `specs list`

Changes por padrão; `--specs` lista capacidades. `--sort name` ordena as changes por nome
em vez de por recência.

### `specs show [item]`

Uma change ou uma spec. `--type change|spec` desambigua um nome que é os dois;
`--deltas-only` imprime só os deltas de uma change.

### `specs validate [item]`

| Opção | Significado |
| --- | --- |
| `--all` | Todas as changes e todas as specs |
| `--changes` | Todas as changes ativas |
| `--specs` | Todas as specs |
| `--archived` | Changes arquivadas, exigindo que toda tarefa esteja marcada |
| `--type change\|spec` | Desambigua um nome |
| `--strict` | Trata warnings como falhas |

### `specs schemas` / `specs templates`

O `schemas` lista os schemas de workflow disponíveis e marca o ativo. O `templates` mostra
o template por trás de cada artefato de um schema.
