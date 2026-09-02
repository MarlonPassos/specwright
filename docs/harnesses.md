# Harnesses

Quatro harnesses são suportados. Todos recebem os mesmos comandos, gerados a partir
dos mesmos corpos de instrução, então `spec-continue` significa a mesma coisa em qualquer um
deles.

| Harness | Arquivos de comando | Invocado como |
| --- | --- | --- |
| Claude Code | `.claude/commands/spec-<id>.md` | `/spec-<id>` |
| Codex | `.agents/skills/spec-<id>/SKILL.md` | `$spec-<id>` |
| OpenCode | `.opencode/commands/spec-<id>.md` | `/spec-<id>` |
| Kiro | `.kiro/prompts/spec-<id>.prompt.md` | `/spec-<id>` |

Os sete ids são `explore`, `propose`, `continue`, `revise`, `implement`, `verify` e
`archive`.

## O que difere entre eles

Só o envelope do arquivo:

- Arquivos do **Claude Code** carregam `name`, `description`, `argument-hint` e
  `allowed-tools: Bash(specs:*)`, o que deixa um comando rodar a CLI sem um novo prompt a
  cada chamada, mantendo todo o resto sob permissão.
- Arquivos do **Codex** são skills: carregam `name` e `description`, e ficam num diretório
  por comando, com o nome fixo `SKILL.md`. O Codex só lê prompts customizados de
  `$CODEX_HOME/prompts`, um diretório por usuário fora do projeto, então um projeto não
  consegue distribuí-los; skills ele lê do repositório.
- Arquivos do **Kiro** carregam `description` e usam a extensão `.prompt.md` dele.
- Arquivos do **OpenCode** carregam `description`, e o corpo termina com um placeholder
  `$ARGUMENTS` explícito — o OpenCode passa o texto do usuário só por um.

Fora o envelope, a única diferença no corpo é a sintaxe com que ele cita os comandos
irmãos, e um teste garante que nada mais varia.

## Como um comando é citado

Um corpo de instrução nunca escreve uma invocação à mão. Ele escreve um placeholder, e o
adaptador troca pela sintaxe do harness para o qual o arquivo está sendo gerado — a
mesma resolução vale para as mensagens de próximo passo que a CLI imprime. Assim nenhuma
dica sugere um comando de outro harness: o arquivo do Codex diz `$spec-implement`, o do
Claude Code diz `/spec-implement`.

A CLI descobre sob qual harness está rodando, nesta ordem:

1. a variável `SPECS_HARNESS`, quando definida (`claude`, `codex`, `opencode`, `kiro`);
2. as variáveis que o próprio harness define no processo (`CLAUDECODE`, `CODEX_SANDBOX`,
   `OPENCODE`, `KIRO_IDE`, entre outras);
3. os harnesses configurados no `spec/config.yaml`;
4. o primeiro harness suportado.

Um id desconhecido em `SPECS_HARNESS` é rejeitado com a lista dos suportados. Use a
variável quando a detecção não tiver como acertar — um harness sem marcador próprio, ou
um terminal aberto por fora dele:

```bash
SPECS_HARNESS=codex specs status
```

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

Um adaptador de harness declara o id dele, o nome de exibição, onde os arquivos vão, como
o usuário digita um comando (`invocation`), as variáveis de ambiente que denunciam que ele
está rodando (`envMarkers`) e como formatar um arquivo. Adicionar um significa adicionar um
adaptador e registrá-lo — os corpos dos comandos, a CLI e o workflow ficam intocados.

## Catálogo de comandos

O catálogo gerado tem treze comandos, em duas listas:

**Ciclo de change** — `spec-explore`, `spec-propose`, `spec-continue`,
`spec-revise`, `spec-implement`, `spec-verify`, `spec-archive`.

**Plano de projeto** — `spec-project-plan`, `spec-project-review`,
`spec-project-generate`, `spec-project-status`, `spec-project-next`,
`spec-project-refine`.

`specs init`/`update --harnesses all` escrevem 52 arquivos (13 × 4). Os comandos
de plano são opt-in: sem `planning/<plan-id>/plan.yaml` eles não têm efeito.
