# Harnesses

Quatro harnesses são suportados. Todos recebem os mesmos cinco comandos, gerados a partir
dos mesmos corpos de instrução, então `/spec-plan` significa a mesma coisa onde quer que
seja digitado.

| Harness | Arquivos de comando | Invocado como |
| --- | --- | --- |
| Claude Code | `.claude/commands/spec-<id>.md` | `/spec-<id>` |
| Codex | `.codex/prompts/spec-<id>.md` | `/spec-<id>` |
| OpenCode | `.opencode/commands/spec-<id>.md` | `/spec-<id>` |
| Kiro | `.kiro/prompts/spec-<id>.prompt.md` | `/spec-<id>` |

Os cinco ids são `propose`, `plan`, `implement`, `verify` e `archive`.

## O que difere entre eles

Só o envelope do arquivo:

- Arquivos do **Claude Code** carregam `name`, `description`, `argument-hint` e
  `allowed-tools: Bash(specs:*)`, o que deixa um comando rodar a CLI sem um novo prompt a
  cada chamada, mantendo todo o resto sob permissão.
- Arquivos do **Codex** carregam `description` e `argument-hint`.
- Arquivos do **Kiro** carregam `description` e usam a extensão `.prompt.md` dele.
- Arquivos do **OpenCode** carregam `description`, e o corpo termina com um placeholder
  `$ARGUMENTS` explícito — o OpenCode passa o texto do usuário só por um.

O corpo da instrução é, fora isso, idêntico byte a byte nos quatro, e um teste garante
isso.

## Selecionando harnesses

```bash
specs init --harnesses claude,codex     # só esses dois
specs init --harnesses all              # todos os harnesses suportados (padrão)
specs update --harnesses kiro           # adiciona um a um workspace existente
```

A seleção fica guardada no `spec/config.yaml` sob `harnesses:`, e o `specs update` a usa
quando nenhuma lista é dada. Um id desconhecido é rejeitado em vez de pulado: um harness
descartado em silêncio é um harness sem comandos e sem explicação.

## Depois de um upgrade

Os arquivos de comando são gerados, não mantidos à mão. Rode `specs update` depois de
atualizar a CLI para que as instruções em disco batam com a CLI que vai executá-las.

## Adicionando um harness

Um adaptador de harness declara o id dele, o nome de exibição, onde os arquivos vão e como
formatar um. Adicionar um significa adicionar um adaptador e registrá-lo — os corpos dos
comandos, a CLI e o workflow ficam intocados.
