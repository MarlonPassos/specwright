# Specwright

Desenvolvimento orientado a especificações para harnesses de código com IA.

O Specwright mantém as **specs** de um projeto (o que o sistema faz hoje) separadas das
suas **changes** (o que um trabalho vai fazer o sistema passar a fazer). Um harness de IA
conduz uma change por cinco etapas — propor, planejar, implementar, verificar, arquivar —
e oferece `/spec-explore` para investigar ideias e problemas antes ou durante esse ciclo.
A CLI mantém os artefatos, a ordem de dependência e a validação em dia no caminho.

Harnesses suportados: **Claude Code**, **Codex**, **OpenCode** e **Kiro**. Os quatro
recebem os mesmos comandos, com os mesmos nomes e o mesmo comportamento.

## Instalação

```bash
npm install --global specwright
```

Requer Node.js 20.19 ou mais novo.

### Direto do repositório

Enquanto o pacote não está no npm, quem tem acesso ao repositório instala direto da branch
principal:

```bash
npm install --global --install-links git+ssh://git@github.com/MarlonPassos/specwright.git#main
# alternativa para ambientes sem chave SSH:
npm install --global --install-links git+https://github.com/MarlonPassos/specwright.git#main
```

O npm clona o repositório e roda o script `prepare`, que compila o TypeScript antes de
publicar o binário — por isso o `dist/` não precisa estar versionado. Troque `#main` por
`#<tag>` ou `#<commit>` para fixar uma versão.

O `--install-links` é obrigatório aqui. Sem ele, o npm instala o clone preparado como um
link simbólico para um diretório temporário do cache, que ele apaga em seguida: a
instalação termina sem erro e o comando `specs` não existe. Com a opção, o pacote é
copiado de verdade para o diretório global.

Confira a instalação com:

```bash
specs --version
```

### Remover

```bash
npm uninstall --global specwright
```

Isso remove o executável `specs` da máquina. Não remove nada que já tenha sido escrito nos
projetos: o diretório `spec/` e os arquivos de comando dos harnesses continuam onde estão.

## Primeiros passos

```bash
cd seu-projeto
specs init
```

O `init` cria o workspace e escreve os arquivos de comando para cada harness suportado:

```text
spec/
  config.yaml            schema do workflow, contexto do projeto, regras de artefato
  project.md             a descrição do projeto, legível por humanos
  specs/                 o comportamento atual do sistema, um diretório por capacidade
  changes/               trabalho em andamento
  changes/archive/       changes que já foram entregues
```

Depois, no seu harness:

| Comando | O que faz |
| --- | --- |
| `/spec-explore` | Pensa junto, sem escrever código: investiga, compara opções e desenha |
| `/spec-propose` | Abre uma change e escreve a proposta: por que a change existe e o que ela cobre |
| `/spec-plan` | Escreve os artefatos de planejamento restantes até a implementação poder começar |
| `/spec-implement` | Percorre o checklist de tarefas, marcando os itens conforme as verificações passam |
| `/spec-verify` | Confere a implementação contra as specs e o checklist |
| `/spec-archive` | Aplica os deltas da change nas specs e arquiva a change |

## O modelo

**Uma capacidade** é uma unidade de comportamento com uma spec em
`spec/specs/<caminho-da-capacidade>/spec.md`. Uma spec é um contrato: requisitos escritos
com SHALL ou MUST, cada um com pelo menos um cenário. Ela diz o que o sistema faz, nunca
como ele é construído.

**Uma change** fica em `spec/changes/<nome-da-change>/` e carrega os artefatos que o
schema do seu workflow declara. Com o schema padrão `spec-driven`:

| Artefato | Arquivo | Depende de |
| --- | --- | --- |
| `proposal` | `proposal.md` | — |
| `specs` | `specs/**/*.md` | `proposal` |
| `design` | `design.md` | `proposal` |
| `tasks` | `tasks.md` | `specs`, `design` |

Os arquivos de spec dentro de uma change são **deltas**, não specs inteiras. Eles declaram
o que a change faz com a capacidade:

```markdown
## ADDED Requirements

### Requirement: Self-service export
The system SHALL let a signed-in user export their own data as a CSV file.

#### Scenario: Export succeeds
- **WHEN** a signed-in user requests an export
- **THEN** the system returns a CSV file with that user's data
```

`## MODIFIED Requirements` carrega o texto de substituição completo, `## REMOVED Requirements`
carrega um **Reason** e uma **Migration**, e `## RENAMED Requirements` usa linhas
`FROM:`/`TO:`. O arquivamento aplica os deltas na spec principal e então move a change para
`spec/changes/archive/<data>-<nome-da-change>/`.

Uma change que não altera nenhum comportamento observável — refatoração, tooling, docs —
declara `skip_specs: true` no seu `.change.yaml` em vez de inventar um requisito.

## CLI

```text
specs init [path]                    Cria um workspace e gera os comandos do harness
specs update [path]                  Regera os arquivos de comando do harness
specs harnesses                      Lista os harnesses suportados e seus arquivos de comando

specs new change <name>              Cria um diretório de change
specs status [--watch]               Painel do projeto, ou artefatos de uma change
specs instructions [artifact]        Instruções de um artefato, ou de implement / archive
specs archive [change]               Aplica os deltas nas specs e arquiva a change

specs list [--changes|--specs]       Lista changes ou capacidades
specs show [item]                    Mostra uma change ou uma spec
specs validate [item]                Valida uma change ou uma spec
specs schemas                        Lista os schemas de workflow disponíveis
specs templates                      Mostra o template por trás de cada artefato
```

Todo comando aceita `--json` e imprime um único documento JSON no stdout, em sucesso ou
falha. Uma falha adiciona um objeto `error` com um `code` e, quando existe, um `fix`
pronto para colar. Os comandos saem com `0` em sucesso e `1` em falha; o `validate` sai
com `1` quando o relatório não está válido.

Referência completa: [docs/cli.md](docs/cli.md).

## Validação

O `specs validate` lê uma change ou uma spec e reporta problemas em três níveis: `ERROR`,
`WARNING` e `INFO`. O `--strict` também falha em warnings.

Ele pega os erros que de outra forma só apareceriam na hora de arquivar, ou nunca:
um requisito sem cenário, um cenário escrito com três cerquilhas em vez de quatro, um
delta MODIFIED que aponta para um requisito que nenhuma spec declara, uma change sem
deltas e sem `skip_specs`, um cabeçalho de delta esquecido numa spec principal, nomes de
requisito duplicados.

Veja [docs/validation.md](docs/validation.md).

## Estendendo

O próprio workflow é um schema: uma lista de artefatos, o que cada um gera, do que depende,
o template a partir do qual é escrito e as instruções que o agente recebe. Coloque um
schema em `spec/schemas/<nome>/` para sobrescrever um embutido ou adicionar o seu, e
aponte o `config.yaml` para ele. Veja [docs/schemas.md](docs/schemas.md).

## Documentação

- [Workflow](docs/workflow.md) — os comandos, passo a passo
- [Referência da CLI](docs/cli.md)
- [Harnesses](docs/harnesses.md) — onde ficam os arquivos de comando de cada um
- [Schemas de workflow](docs/schemas.md)
- [Regras de validação](docs/validation.md)

## Créditos

O Specwright é construído sobre o [OpenSpec](https://github.com/Fission-AI/OpenSpec) — o
modelo de specs, changes e deltas vem de lá. Este projeto parte dessa base e a leva
adiante: workflow declarado por schema, validação em três níveis, saída JSON em todo
comando e suporte aos quatro harnesses.

## O nome

**Specwright** combina *spec*, abreviação de *specification*, com *wright*, uma pessoa que
constrói ou cria algo. O nome sugere mais do que escrever especificações: significa
elaborá-las como base para construir e evoluir software.

Nesse sentido, Specwright pode ser entendido como **“construtor de especificações”**,
ideia alinhada ao desenvolvimento de software orientado por especificações.

## Licença

MIT
