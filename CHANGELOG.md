# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

## [0.4.0] - 2026-08-30

### Funcionalidades

- **feat(cli): adiciona o painel do projeto ao `specs status`**
  - Sem argumentos, `specs status` desenha o painel: wordmark, resumo com barra de
    tarefas, changes agrupadas pela fase do workflow, capacidades e arquivo
  - Cada change mostra o estado dos artefatos, o progresso do checklist, o que a bloqueia
    e o comando que a move adiante
  - Uma change que não pode ser lida vira uma linha em "com problema" em vez de derrubar
    o painel inteiro
  - `--no-color` troca cor e glifos Unicode por ASCII; sem terminal a cor já sai desligada

- **feat(cli): adiciona `specs status --watch`**
  - Redesenha o painel no intervalo de `--interval` segundos, padrão 2, até `Ctrl+C`
  - Repinta por cima do quadro anterior num único write, sem limpar a tela antes, que é
    o que evita a piscada
  - Corta um quadro mais alto que a janela e diz quantas linhas ficaram de fora
  - `Ctrl+C` encerra na hora, sem esperar o intervalo; sem terminal, cada quadro sai como
    um snapshot separado

## [0.3.1] - 2026-08-30

### Correções

- **fix(harness): gera os comandos do Codex como skills**
  - O Codex só carrega prompts customizados de `$CODEX_HOME/prompts`, um diretório por
    usuário fora do projeto, então os arquivos escritos em `.codex/prompts/` nunca
    apareciam na lista de comandos
  - Agora cada comando é uma skill em `.agents/skills/spec-<id>/SKILL.md`, com frontmatter
    `name` e `description`, que o Codex lê a partir do repositório

## [0.3.0] - 2026-08-30

### Funcionalidades

- **feat(cli): traduz para português tudo que chega ao usuário e ao agente**
  - Saída dos comandos: `init`, `update`, `harnesses`, `new change`, `status`,
    `instructions`, `archive`, `list`, `show`, `validate`, `schemas` e `templates`
  - Mensagens de erro e de correção (`Erro:` / `Correção:`), incluindo as lançadas pelo core
  - Mensagens de validação dos três níveis, e o placeholder de `## Purpose` escrito ao arquivar
  - Corpos de instrução dos cinco comandos `/spec-*` gerados para os quatro harnesses
  - Schema `spec-driven`: descrições e instruções de cada artefato e da fase de implementação
  - Templates de `proposal.md`, `design.md`, `spec.md`, `tasks.md` e o `spec/project.md` inicial

### Manutenção

- **test: ajusta as asserções que casavam com as mensagens em inglês**

## [0.2.0] - 2026-08-30

### Funcionalidades

- **feat(cli): traduz a ajuda do terminal para português**
  - Descrição do programa, de cada comando e de cada opção
  - Títulos de seção, `[opções]`, `[comando]` e o rótulo de valor padrão, que o commander
    escreve em inglês sem oferecer ponto de extensão
  - Os termos de comando são traduzidos onde são produzidos, para que a largura das
    colunas seja medida sobre o texto já traduzido

## [0.1.3] - 2026-08-30

### Documentação

- **docs: exige `--install-links` na instalação a partir do git**
  - Sem a opção, o npm instala o clone preparado como link simbólico para um diretório
    temporário do cache, apaga esse diretório logo depois e a instalação termina sem erro
    com o comando `specs` inexistente
  - Comandos de instalação atualizados e o motivo documentado

## [0.1.2] - 2026-08-30

### Correções

- **fix(build): faz a instalação a partir do git compilar o pacote**
  - `npm install --global git+...` vaza a própria configuração (`global`, `prefix`) por
    variáveis de ambiente para o install que o npm roda ao preparar o clone, então o clone
    ficava sem as devDependencies e o `prepare` falhava com `sh: tsc: command not found`
  - O `prepare` agora é o `scripts/prepare.mjs`: resolve o compilador e, quando precisa
    buscá-lo, roda o install com a configuração herdada do npm removida do ambiente

## [0.1.1] - 2026-08-30

### Manutenção

- **build: adiciona instalação direta do repositório git**
  - Script `prepare` compila o TypeScript durante a instalação, para que o `dist/` não
    precise ser versionado
  - Campos `repository`, `bugs`, `homepage` e `publishConfig` no manifesto do pacote

### Documentação

- **docs: documenta a instalação a partir do repositório**
  - Seção com os comandos via SSH e HTTPS, e como fixar uma versão com `#<tag>`
  - Seção de remoção da CLI instalada globalmente

## [0.1.0] - 2026-08-30

### Funcionalidades

- **feat: adiciona o workflow de desenvolvimento orientado a specs**
  - Separa as specs do projeto (comportamento atual) das changes (trabalho em andamento)
  - Cinco etapas: propor, planejar, implementar, verificar, arquivar
  - Deltas `ADDED` / `MODIFIED` / `REMOVED` / `RENAMED` aplicados nas specs ao arquivar

- **feat(cli): adiciona a CLI `specs`**
  - `init`, `update`, `harnesses` para preparar o workspace e gerar os comandos
  - `new change`, `status`, `instructions`, `archive` para conduzir uma change
  - `list`, `show`, `validate`, `schemas`, `templates` para inspeção
  - `--json` em todo comando, com objeto `error` contendo `code` e `fix` nas falhas

- **feat(harness): gera os comandos para Claude Code, Codex, OpenCode e Kiro**
  - Mesmos cinco comandos `/spec-*` nos quatro, a partir do mesmo corpo de instrução
  - Apenas o envelope do arquivo difere entre os adaptadores

- **feat(schema): torna o workflow declarado por schema**
  - Artefatos, dependências, templates e instruções vêm do `schema.yaml`
  - Schema embutido `spec-driven`; schemas do workspace sombreiam os embutidos
  - Ordem de construção, conjunto pronto e bloqueado derivados do grafo

- **feat(validate): adiciona validação em três níveis**
  - `ERROR`, `WARNING` e `INFO`, com `--strict` reprovando em warnings
  - Regras para changes, requisitos, specs e changes arquivadas

### Documentação

- **docs: adiciona README e documentação em português**
  - README com instalação, primeiros passos, modelo, CLI e validação
  - `docs/` com workflow, referência da CLI, harnesses, schemas e regras de validação
  - Crédito ao [OpenSpec](https://github.com/Fission-AI/OpenSpec) como base do projeto

### Manutenção

- **chore: configura build, testes e empacotamento**
  - TypeScript ESM com saída em `dist/`, Node.js 20.19 ou mais novo
  - Vitest com 102 testes entre unitários e de integração
  - Binário `specs` publicado via campo `bin` do pacote
