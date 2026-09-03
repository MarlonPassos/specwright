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

Quando um comando sugere um próximo passo, ele escreve o comando na sintaxe do harness em
que está rodando — `/spec-implement` no Claude Code, `$spec-implement` no Codex. A CLI
detecta o harness pelo ambiente; `SPECS_HARNESS=<id>` força um. Veja
[harnesses.md](harnesses.md).

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

Lista os harnesses suportados, onde cada um escreve seus arquivos de comando, como cada um
digita um comando, e os comandos gerados para todos eles. Com `--json`, cada harness
carrega um mapa `invocations` do id do comando para a forma que ele aceita.

## Changes

### `specs new change <name>`

Cria `spec/changes/<name>/` com os metadados dela. O nome precisa ser kebab-case.

| Opção | Significado |
| --- | --- |
| `--schema <name>` | Schema de workflow desta change |
| `--goal <text>` | Objetivo registrado nos metadados da change |
| `--skip-specs` | Declara que a change não altera nenhum comportamento observável |

Num projeto com [plano](project-planning.md), se algum incremento sem vínculo
planeja exatamente este slug, a saída ganha um bloco `plan` com o
`specs project link` a rodar. É só um aviso: o plano não é escrito aqui.

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

Com `--json`, o comando serve o que ele mostra: sem `--change` nem `--all`, o documento é
o do painel (`projectName`, `schema`, `harness`, `changes`, `specs`, `archive`, `totals`);
com `--change`, é o status da change; com `--all`, a lista de status. O campo `harness` diz
para qual harness o `next` de cada change foi escrito.

O wordmark do cabeçalho é desenhado com meio-blocos, que qualquer terminal com Unicode
renderiza igual. Sem cor, sem terminal ou em janela estreita, o cabeçalho vira uma linha só.

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

Num projeto com [plano](project-planning.md), o arquivamento fecha o vínculo já
previsto — o incremento sem vínculo cujo `slug` é igual ao nome da change — e o
reporta no bloco `plan`. Um plano ausente ou ilegível não muda o arquivamento em
nada.

### `specs watch [plan-id]`

Painel único, navegável por teclado. Três telas num processo só:

| Tecla | Tela | Conteúdo |
| --- | --- | --- |
| `1` | **RESUMO** | execução e plano juntos, com o vínculo `change ↔ incremento` desenhado |
| `2` | **CHANGES** | o painel de `specs status` |
| `3` | **PLANO** | o painel de `specs project` |

| Tecla | Ação |
| --- | --- |
| `Tab`, `→` | próxima aba |
| `Shift+Tab`, `←` | aba anterior |
| `1`…`9` | salta para aquela aba |
| `r` | repinta agora |
| `q`, `Esc`, `Ctrl+C` | sai |

| Opção | Significado |
| --- | --- |
| `--interval <segundos>` | Intervalo de repintura; padrão 2 |
| `--once` | Desenha um quadro e sai |
| `--json` | Publica a projeção combinada e sai |
| `--no-color` | Sem cor nem glifos Unicode |

`specs status --watch` e `specs project --watch` entram no mesmo painel, abrindo
em CHANGES e em PLANO. Nenhuma tecla escreve no projeto.

Num projeto **sem** plano legível existe uma aba só, e nada muda: sem barra de
abas, sem teclas. Sem TTY — pipe, CI, `| cat` — o painel repinta por polling como
sempre fez, sem capturar teclado.

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

## Project Planning

Opt-in. Sem `planning/<plan-id>/plan.yaml`, esses comandos são a única superfície
nova e nada mais muda. Referência do formato: [project-planning.md](project-planning.md).

### `specs project create <plan-id> [fontes...]`

Cria `planning/<plan-id>/` com `plan.yaml` (`status: draft`, `revision: 0`),
`plan.md`, `architecture.md` e `planned-changes/`.

| Opção | Significado |
| --- | --- |
| `--name <nome>` | Nome humano do plano (default: o `plan-id`) |
| `--owner <nome>` | Responsável |
| `--json` | `{ plan, path, revision, created }`; em falha `{ plan: null, error }` |

Cada fonte é registrada com `path` relativo à raiz e `sha256` do conteúdo. Um
plano existente falha com `plan_exists` e nada é modificado. Uma fonte com `..`,
absoluta ou com NUL falha com `unsafe_source_path`.

### `specs project validate [<plan-id>]`

Valida manifesto, Planned Changes, fontes e vínculos.

| Opção | Significado |
| --- | --- |
| `--strict` | Trata warnings como falhas |
| `--json` | `{ valid, strict, reports, summary }`, com `reports[].type` em `plan` ou `planned-change` |

Sem `<plan-id>`: usa o único plano, ou falha com `plan_not_found` / `ambiguous_plan`.
Sai com `1` quando inválido.

Códigos de erro: `plan_not_found`, `ambiguous_plan`, `plan_exists`, `invalid_plan`,
`plan_invalid`, `unsupported_plan_version`, `unsafe_source_path`, `unsafe_plan_path`,
`source_not_found`.

### `specs project status` / `next` / `show` / `generate`

`status` devolve as três dimensões de cada incremento, progresso, milestones
derivados e diagnósticos. `next` recomenda o próximo incremento com ranking
determinístico e justifica cada exclusão. `show <change-id>` traz o registro, o
Planned Change parseado seção por seção, dependências e dependentes resolvidos.
`generate` materializa os briefs (`--change`, `--milestone`, `--dry-run`,
`--force`, `--expect-revision`); recusa sobrescrever um brief editado à mão e
projeta o roadmap em `plan.md`.

`specs project` sem subcomando renderiza o dashboard (somente leitura); `--json`
soma `dashboardSchemaVersion` e `generatedAt` ao payload de `status`. `--json` e
`--watch` são mutuamente exclusivos (`invalid_option`).

O painel usa a mesma linguagem visual de `specs status`: wordmark, seções ruladas,
barras de progresso e marcas por glifo. Os incrementos ficam **agrupados pelo
estágio** — `EM IMPLEMENTAÇÃO`, `PRONTAS PARA COMEÇAR`, `BLOQUEADAS`, `COM
PROBLEMA`, `CONCLUÍDAS`, `FORA DO FLUXO` — em vez de uma lista única ordenada por
id, e os códigos de razão saem traduzidos. `--no-color` desenha sem cor nem
glifos Unicode, igual a `specs status`.

### `specs project link` / `unlink` / `adopt` / `sync` / `set-state`

`link <change-id> <change-name>` registra o vínculo 1:1 (o incremento não pode
estar concluído nem cancelado; a change precisa existir, **ativa ou no archive**;
o nome não pode já estar vinculado). `unlink <change-id>` remove — `--force`
quando a execução é `archived`. `adopt <change-name|archive-dir>` cria uma
Project Change a partir de uma change fora do plano, sem tocar em nada dentro
dela. `sync [--check] [--link]` reconcilia o bloco `link` com `spec/changes/` e o
archive (idempotente); `--link` vincula em lote todo incremento sem vínculo cuja
change de mesmo nome do slug exista e esteja livre — é a alternativa a repetir
`specs project link` uma vez por incremento.
`set-state <change-id> <state> [--reason]` aplica uma transição de
`planning_state` (`on_hold` e `cancelled` exigem `--reason`).

Códigos de erro: `link_target_missing`, `link_already_used`, `invalid_transition`,
`missing_reason`, `completed_change_protected`.

### `specs serve [<plan-id>]`

Sobe o painel do projeto no navegador e o abre. Leitura pura: **nenhuma rota
escreve**, e qualquer método que não seja `GET`/`HEAD` devolve `405 read_only`.

| Opção | Efeito |
|---|---|
| `--port <n>` | Porta (padrão `4477`) |
| `--host <endereço>` | Endereço de escuta (padrão `127.0.0.1`) |
| `--no-open` | Não abre o navegador |

| Rota | Projeção |
|---|---|
| `GET /` | a página, embutida no pacote — sem CDN, sem build |
| `GET /api/overview` | `buildOverview()`, o mesmo payload de `specs watch --json` |
| — aceita `?harness=<id>` | refaz a projeção com aquele harness (também em `/api/changes` e `/api/events`) |
| `GET /api/changes` | `buildDashboard()` |
| `GET /api/plan` | `statusPayload()` + a recomendação |
| `GET /api/brief?change=CH-NNN` | o Planned Change do incremento, em Markdown |
| `GET /api/docs` | o catálogo: todo documento do projeto, com finalidade e caminho |
| `GET /api/doc?id=<id>` | um documento do catálogo, em Markdown |
| `GET /api/events` | SSE: um evento `overview` ao conectar e um a cada mudança |

A página tem as **três telas do terminal** — RESUMO, PLANO e CHANGES — mais
DOCUMENTOS, que só uma página consegue oferecer; trocadas por clique, por
`1`..`4`, por `Tab` e pelas setas; `r` repinta. A ordem é a do trabalho: onde
estamos, o que o plano manda fazer, a change que faz, e os documentos que
sustentam tudo.

Cada card principal traz um glifo `ⓘ` no título com **uma frase dizendo o que
aquilo é** — change, incremento, delta, milestone e capacidade em uma linha cada,
para quem ainda não tem o vocabulário. `CHANGES` fica em inglês de propósito: é o
mesmo termo de `spec/changes/` e de `specs new change`, e traduzir só na tela
obrigaria a traduzir de volta na hora de digitar. A aba
vive no hash (`#changes`), então recarregar não perde o lugar. Dois temas, escuro
por padrão como o terminal, com a escolha lembrada no navegador.

Todo comando exibido é um **chip clicável que copia para a área de transferência**,
agrupado sob **no harness** ou **no terminal**, para os dois nunca serem
confundidos. Onde os dois caminhos existem, os dois aparecem: o próximo
incremento mostra `/spec-explore` e `/spec-propose` ao lado de
`specs new change` e `specs project link`; quando a change já está vinculada, o
harness mostra o comando dela em vez de propor outra.

Comando de harness vem **montado**: `/spec-propose CH-003 terminal-ux`, não
`/spec-propose` solto — em todo incremento pronto para começar, não só no
recomendado. O verbo vem do payload, então o Codex recebe `$spec-*`.

Clicar num incremento abre o **Planned Change renderizado** num painel lateral,
com Markdown formatado e `Esc` para fechar. O caminho do arquivo vem do
manifesto, nunca da query: `?change=` seleciona um registro, e o registro diz
onde seu resumo mora — um id fora de `CH-NNN` é recusado antes de qualquer
leitura de disco.

O primeiro card de cada tela é fixo; os demais são **acordeões abertos por
padrão**, com a contagem no cabeçalho — numa tela com vinte incrementos, fechar
uma seção é a diferença entre ler e rolar.

Na tela CHANGES, cada change mostra **as tarefas ainda abertas** embaixo da sua
linha — só as abertas, porque o que já foi feito o contador ao lado da barra já
diz. A lista é curta por contrato (`OPEN_TASKS_SHOWN`, cinco): uma tela com vinte
changes tem de continuar sendo uma tela, e o botão ao pé abre o checklist
inteiro. Os itens vêm do mesmo parse que conta o progresso, então mostrá-los não
lê `tasks.md` uma segunda vez.

#### A tela DOCUMENTOS

O catálogo de tudo que se lê no projeto, agrupado como o projeto é organizado:
`spec/project.md`, cada capacidade viva de `spec/specs/`, os artefatos de cada
change (`proposal.md`, `design.md`, `tasks.md` e cada delta de spec), o mesmo
para cada change arquivada, e `plan.md`, `architecture.md` e os Planned Changes
do plano. Cada entrada mostra **o que é, para que serve e onde mora**.

Metadado de máquina fica de fora — `config.yaml`, `.change.yaml` e `plan.yaml`
são estado, não leitura, e já chegam ao painel pelas projeções.

O `id` de um documento é uma **chave de catálogo, não um caminho**: `/api/doc`
reconstrói o catálogo e procura o id nele, então o leitor só alcança arquivo que
o próprio catálogo publicou. Nada que venha da query é concatenado a diretório
(I-8); um id desconhecido é `404`.

`tasks.md` volta **parseado**: o painel mostra progresso, os grupos que o próprio
arquivo declara e o recuo por numeração (`1.2` é subtarefa de `1`), com o
Markdown logo abaixo. Os pontos de artefato da tela CHANGES abrem o documento
correspondente, e um incremento com change vinculada mostra os artefatos dela ao
lado do vínculo.

#### O harness dos comandos

O painel roda **fora** do harness: o `specs serve` sobe no terminal, então o
ambiente do processo raramente diz qual está em uso. Por isso o cabeçalho traz um
**seletor** e, ao lado dele, de onde veio a escolha:

| Procedência | Significa |
|---|---|
| `detectado` | havia marcador de ambiente (`CLAUDECODE`, `CODEX_HOME`, …) |
| `escolhido aqui` | o leitor pediu no seletor, ou `SPECS_HARNESS` foi definido |
| `configurado` | veio de `harnesses` no `spec/config.yaml` — o caso comum |
| `padrão` | não havia nada; é o primeiro suportado |

Trocar o seletor refaz as projeções com `?harness=<id>`: **todo comando é montado
no servidor**, então o que muda é o payload, não um texto reescrito na página. A
escolha fica lembrada no navegador, e cada aba pode pedir um harness diferente —
o stream entrega a cada leitor o quadro do harness dele. Um id não suportado é
recusado com `400 unknown_harness` em vez de ignorado: ignorar devolveria a
sintaxe de outro harness sem dizer nada.

O **modelo** em uso não aparece porque nenhum harness o publica: o ambiente do
Claude Code traz produto e versão (`AI_AGENT=claude-code_2-1-259_agent`) e o
esforço (`CLAUDE_EFFORT`), nunca o modelo — e Codex, opencode e kiro expõem só
sandbox e caminhos.

#### Milestones e busca

Na tela PLANO os **milestones são navegáveis**: clicar num deles recorta a lista
de incrementos para os seus — mesmas etapas, menos linhas — com um chip dizendo
qual recorte está ativo. Os milestones do RESUMO levam para o mesmo recorte.

CHANGES, PLANO e DOCUMENTOS têm **busca na barra de título da seção**: o campo
cresce ao receber foco e filtra enquanto se digita, sem perder o cursor.

O stream observa `spec/` e `planning/` com `fs.watch`, e agrupa a rajada de uma
escrita atômica num aviso só — `writeFileAtomic` grava em temporário e renomeia,
o que emite de 3 a 6 eventos por mutação, incluindo o instante em que o arquivo
não existe. Escuta em loopback por padrão: o painel expõe conteúdo do projeto.

### `specs project bundle-schema`

Imprime o contrato do bundle aceito por `apply`: raiz, catálogo de operações,
`PlannedChangeSpec`, regras e um exemplo aplicável. `--json` devolve a mesma
coisa em forma estruturada.

É o comando que um assistente roda **antes** do primeiro bundle da sessão — sem
ele o formato só era descobrível por tentativa e erro contra `apply`, e o
mecanismo `$ref` (a única forma de citar um incremento que o próprio bundle
cria) não aparecia em nenhuma mensagem de erro.

### `specs project apply` / `impact` / `list` / `pause` / `resume` / `archive` / `--watch`

`apply` lê um bundle JSON (stdin ou `--file`), valida o estado proposto e grava;
`--dry-run` imprime `idMap`, diff e impacto sem escrever, e reporta a **mesma**
revisão futura e a **mesma** contagem de validação que o `apply` real produz. `impact --change <id>...`
dá o impacto estrutural determinístico. `list` indexa os planos. `pause --reason`,
`resume` e `archive` movem o `status` declarado do plano. `specs project --watch
[--interval <s>]` repinta o dashboard por polling até Ctrl+C (`--watch` + `--json`
→ `invalid_option`).

Formato do bundle e regras: [project-planning.md](project-planning.md).
