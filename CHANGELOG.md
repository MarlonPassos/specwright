# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

## [0.10.0] - 2026-09-01

### Corrigido

- **fix(project): falhas da reauditoria de 2026-09-02**
  - **Brief inválido nunca fica `ready` (R-01, FR-22):** um `content_hash` que
    confere prova que os bytes são os registrados, **não** que o documento é
    válido. `status` passa a validar a estrutura do brief e, quando ela falha,
    emite `planned_change_invalid` (ERROR) e passa `diagnosticBlocking` para a
    readiness — o incremento vira `blocked` com `diagnostic_blocking`,
    apresentação `inconsistente`, e `next` nunca o recomenda.
  - **`apply` valida a árvore proposta inteira (R-01, regra 11 de §7.11):** e não
    só os briefs que ele próprio escreve. Uma mutação que **toca** um incremento
    com brief inválido é recusada com `plan_invalid` sem escrever nada; um brief
    já inválido em outro incremento vira `WARNING` no relatório — o esqueleto que
    `generate` grava de propósito (§7.5) não trava o fluxo.
  - **Symlink não cruza mais a fronteira do workspace (R-05, I-8, NFR-08):**
    `adopt`, `link` e `readEvidence` resolvem o alvo por `safeResolve`/realpath
    antes de qualquer `stat` ou leitura. Um `spec/changes/<nome>` que aponta para
    fora do projeto era adotado e copiava um título externo para o manifesto.
  - **Path de fonte normalizado (R-06, FR-06):** `plan.sourceDocuments` é
    convertido para a forma POSIX uma vez, no aplicador do bundle; antes um
    `docs\source.md` era persistido literalmente.
  - **Commit multi-arquivo com rollback (R-07, NFR-07, AC-49):** `withStaging`
    ganha pré-checagem (um destino que é diretório é recusado antes do primeiro
    move), backup de cada destino existente e **rollback** de tudo que já foi
    movido quando qualquer rename falha. O staging só permanece no disco quando o
    próprio rollback falha, que é o caso em que §7.13 pede
    `partial_write_detected`. Antes, uma falha no meio deixava o manifesto na
    revisão nova e apagava o staging.
  - Testes: regressão para cada item em `test/unit/project-hardening.test.ts`,
    incluindo o caso de não-deadlock com o esqueleto. 337 testes.

- **fix(project): falhas residuais da reauditoria**
  - **Validação pré-escrita completa (R-01, §4.1.5, regra 11 de §7.11):** `apply`
    valida o conteúdo de **todos** os briefs da árvore proposta em memória, antes
    do primeiro byte. Um bundle com `plannedChange: {}` retornava
    `applied: true` e deixava o plano inválido no disco; agora falha com
    `plan_invalid` sem escrever nada.
  - **Barreira de path global (R-02, I-8, NFR-08):** `resolveWithinRoot` passou a
    valer para **todo** caminho persistido. `apply` recusa
    `sourceDocuments: ["../fora.md"]` com `unsafe_source_path` sem gravar (antes
    gravava e ainda incrementava a revisão), e `status`, `show`, `generate`,
    `evidence`, `sync` e `impact` leem por `safeResolve`: um `..` no manifesto
    faz a leitura falhar fechada em vez de vazar arquivo de fora da raiz.
  - **Lock exclusivo (R-03):** `withPlanLock` usa `open(..., 'wx')` como
    test-and-set atômico, com liberação de lock abandonado por idade. `savePlan`,
    `apply` e `generate` fazem o compare-and-swap **dentro** do lock. Antes,
    dois escritores concorrentes observavam a mesma revisão e ambos gravavam a
    seguinte, perdendo uma atualização.
  - **`link` exige diretório (R-04, FR-29):** um arquivo comum com o nome da
    change era aceito como alvo. `link` e `adopt` passam a usar `isDirectory`.
  - Testes: `test/unit/project-hardening.test.ts` com regressão para cada item,
    incluindo dois `savePlan` concorrentes (um vence, o outro recebe
    `plan_revision_conflict`). 332 testes.

- **fix(project): falhas encontradas em auditoria independente**
  - **Atomicidade (NFR-07, I-10, AC-21):** `generate` e `apply` validam os
    marcadores do roadmap de `plan.md` **antes** da primeira escrita. Antes, um
    marcador desbalanceado só era descoberto depois que os briefs e o
    `plan.yaml` já tinham sido gravados, deixando o plano meio aplicado.
  - **Traversal em `adopt` (I-8, NFR-08, FR-06):** `specs project adopt` aceitava
    um caminho (`../../../fora`), lia conteúdo de fora da raiz e persistia
    `slug`/`link.name` inseguros no manifesto. Agora exige um **nome** de
    diretório — slug kebab-case ou `<YYYY-MM-DD>-<slug>[-N]` — e recusa `..`,
    absoluto, NUL e separadores com `unsafe_plan_path`.
  - **`renameSlug` perdia o brief (FR-43, AC-50):** o arquivo antigo era apagado
    e o novo nunca criado, deixando o manifesto apontando para um arquivo
    inexistente. Agora o conteúdo é carregado para o novo caminho, o `slug:` do
    frontmatter é reescrito e `content_hash`/`record_hash` são refeitos na mesma
    transação.
  - **Precedência do blocker manual (FR-23, §7.7):** um blocker manual agora é a
    única razão reportada, com `blockedBy` vazio. Antes acumulava com
    `dependency_pending`.
  - **`next` recomendava incremento concluído (§7.8):** elegível passa a exigir
    `readiness: ready` **e** `execution != archived`; o concluído aparece em
    `excluded` com `archive_resolved`.
  - **Ordenação de archive (FR-32, AC-40, NFR-03):** o sufixo de colisão é
    comparado como número. Antes `-2` era escolhido no lugar de `-10`.
  - **`apply --expect-revision` (FR-39):** a opção não existia na CLI e escapava
    do contrato `--json` como texto do Commander. Registrada e propagada.
  - **`impact` e `change_dir_missing` (FR-44, §7.12):** `sharedCapabilities`
    passa a ser uma lista de entradas; uma change vinculada sem diretório
    resolvível aparece como `{ capability: null, reason: "change_dir_missing" }`
    em vez de ser omitida em silêncio. **Mudança de contrato JSON.**
  - **Regras de §7.17:** `schema_version` do frontmatter de um Planned Change é
    restrito ao valor conhecido; um incremento `planned` sem materialização
    produz `planned_change_missing`.
  - **`generate --force` (AC-14):** o relatório passa a registrar em
    `diagnostics` que um conteúdo editado à mão foi adotado.
  - **Escrita concorrente:** `savePlan` relê a revisão no disco imediatamente
    antes de gravar (compare-and-swap) e falha com `plan_revision_conflict` em
    vez de sobrescrever a atualização de outro escritor.
  - Testes: `test/unit/project-transaction.test.ts` e
    `test/integration/project-lifecycle.test.ts` (exigidos por §12) mais
    regressão para cada item acima. 326 testes.

### Adicionado

- **feat(project): Project Planning — Fases 4–5 (bundle, impacto, ciclo de vida e watch)**
  - `src/core/project/bundle.ts` — Zod do bundle e as dez operações de §7.11
    (`addChange`, `updateChange`, `setDependencies`, `setBlockers`, `renameSlug`,
    `replacePlannedChange`, `splitChange`, `mergeChanges`, `setMilestones`,
    `writeDocument`), com `ref → ID` reprodutível, proteção de histórico
    (`completed_change_protected`), split que cancela o original com
    `superseded_by` e exige `rewire` completo (`unmapped_dependents`), merge que
    recusa entrada concluída (`merge_completed_change`), e validação do estado
    proposto (`ProjectGraph.from`) antes de qualquer escrita.
  - `src/core/project/apply.ts` — `specs project apply` (stdin ou `--file`):
    pipeline `parse → aplicar em memória → validar → impacto → staging → rename
    atômico → projetar roadmap → revalidar`. `--dry-run` não toca no disco;
    `--allow-completed` libera uma operação sobre incremento concluído com
    `WARNING`.
  - `src/core/project/impact.ts` — `specs project impact --change <id>...`:
    dependentes, ancestrais, milestones, changes vinculadas com estado resolvido,
    capabilities compartilhadas, Planned Changes afetados, concluídos atingidos.
  - `project-refine` ganha o corpo completo (impacto, split/merge/rename,
    proteção de histórico).
  - `specs project list`, `pause --reason`, `resume`, `archive` (ciclo de vida do
    plano) e `specs project --watch [--interval <s>]` (reusa `watch()`).
  - `apply` valida o estado proposto (grafo + slug, `superseded_by`, consistência
    incremento↔milestone, `order` duplicado) **antes** de qualquer escrita
    (`plan_invalid`).
  - `validate` ganha `high_fanout_change`, `unlinked_active_change` e
    `partial_write_detected`.
  - Testes de desempenho (200 incrementos: `status`/`next` < 500 ms,
    `generate` < 2 s) e de confidencialidade (marcador de fonte nunca aparece em
    `planning/` nem em saída de comando).
  - **`planned_change.record_hash`** (opcional): hash de `slug` + `title` +
    `depends_on` + `milestone`. Uma mudança nesses campos torna o brief
    `outdated` mesmo com a fonte intacta (§7.5); `priority` e `manual_blockers`
    não movem o hash. `generate` e `apply` gravam; `status` compara.
  - **`ProjectChange.reason`** (opcional): o motivo do último `set-state` para
    `on_hold` ou `cancelled`, gravado para auditoria (§7.6) e limpo ao voltar
    para `planned`.
  - `validate` ganha `oversized_change` (change vinculada com mais de 10 deltas,
    reusa `MAX_DELTAS_PER_CHANGE`) e `ambiguous_archive_match`; `status` ganha o
    diagnóstico `stale_plan_status`.
  - Os dois campos novos são opcionais no Zod — planos escritos antes deles
    continuam carregando sem migração.

- **feat(project): Project Planning — Fase 3 (vínculo, adoção e sincronização)**
  - `src/core/project/link.ts` — `linkChange` (vínculo 1:1 com todas as
    pré-condições: incremento não concluído nem cancelado, change nativa
    presente, nome livre), `unlinkChange` (exige `--force` quando a execução
    observada é `archived`), `adoptChange` (cria uma Project Change a partir de
    uma change fora do plano — ativa ou de archive — sem tocar em nada dentro
    dela; título derivado do `proposal.md`; id novo além de qualquer cancelado),
    `setPlanningState` (transição validada contra a máquina de §7.6; `on_hold` e
    `cancelled` exigem `--reason`).
  - `src/core/project/sync.ts` — `syncPlan [--check]`: resolve `archive_path`
    por padrão (`^\d{4}-\d{2}-\d{2}-<name>(-\d+)?$`, escolhe o de maior data e
    sufixo com `ambiguous_archive_match`), limpa `active_path` quando o
    diretório ativo some, reporta `dangling_link` (execução `unknown`, nunca
    `archived`). Nunca cria vínculo, nunca adota, nunca altera a change nativa.
    Idempotente.
  - CLI: `specs project link`, `unlink`, `adopt`, `sync`, `set-state`.

- **feat(project): Project Planning — Fase 2 (grafo, estado, materialização, dashboard e comandos)**
  - `src/core/project/graph.ts` — DAG entre Project Changes com ordem topológica
    (desempate por declaração), dependentes, ancestrais, descendentes e detecção
    de ciclo com o caminho na mensagem.
  - `evidence.ts` + `state.ts` — as três dimensões de estado: `planning_state`
    (persistido), `readiness` (derivado do grafo e da materialização) e
    `execution` (observado no filesystem da change nativa), com códigos de razão
    estáveis e apresentação derivada.
  - `status.ts` — `specs project status`: progresso geral e por milestone, cada
    incremento com as três dimensões, status derivado do plano e diagnósticos
    (`dangling_link`, `duplicate_link`, `source_changed`, `missing_source`, …).
  - `next.ts` — `specs project next`: ranking determinístico de cinco níveis,
    alternativas, `parallelReady` com ressalva e `excluded` com o código que
    eliminou cada incremento.
  - `generate.ts` + `render.ts` — `specs project generate`: materialização
    seletiva por `--change`/`--milestone`, idempotente, com detecção de fonte
    alterada e edição humana (conflito de três vias, recusa sem `--force`) e
    projeção do bloco de roadmap em `plan.md` preservando o texto fora dos
    marcadores. `--dry-run` não toca no disco.
  - `specs project show <change-id>` e o dashboard de `specs project` (somente
    leitura; `--json` e `--watch` mutuamente exclusivos).
  - Seis comandos de harness gerados para os quatro harnesses (`project-plan`,
    `-review`, `-generate`, `-status`, `-next`, `-refine`), com `allowed-tools`
    por comando no Claude Code.

- **feat(project): Project Planning — Fase 1 (modelo, proveniência e validação)**
  - Nova área de planejamento em `planning/<plan-id>/`, fora de `spec/`, com
    `plan.yaml` (manifesto estruturado), `plan.md`, `architecture.md` e
    `planned-changes/`. A presença de `planning/<plan-id>/plan.yaml` é a única
    chave de ativação — nenhuma opção nova em `spec/config.yaml`.
  - Grupo de CLI `specs project` com dois subcomandos determinísticos:
    - `specs project create <plan-id> [fontes...] [--name] [--owner] [--json]` —
      cria o plano em `status: draft`, `revision: 0`, registra `path` e `sha256`
      de cada fonte; idempotente por recusa (`plan_exists`).
    - `specs project validate [<plan-id>] [--strict] [--json]` — valida
      manifesto, Planned Changes, fontes e vínculos nos níveis
      `ERROR`/`WARNING`/`INFO`, com path do campo e `fix`.
  - Namespace de biblioteca `src/core/project/` (`model`, `paths`, `hashes`,
    `repository`, `planned-change`, `templates`, `validate`, `create`),
    exportado por `src/index.ts`.
  - Hashes de proveniência (`source_hash`, `content_hash`) normalizados para LF,
    estáveis entre plataformas e line endings.
  - `src/util/fs.ts` ganha `writeFileAtomic` e `withStaging` (escrita atômica e
    staging multi-arquivo); nada existente é alterado.

### Alterado

- **`ValidationReport['type']`** passa a incluir `'plan'` e `'planned-change'`,
  além de `'change'` e `'spec'`. `formatReports` já imprime `report.type`
  genericamente, então consumidores da saída humana não são afetados; quem lê o
  JSON de `validate` passa a ver os dois valores novos apenas para planos.
- **Catálogo de comandos gerados** passa de sete para treze. `workflowCommands()`
  continua devolvendo os sete comandos do ciclo de change; `allCommands()` expõe
  o conjunto completo (ciclo + seis comandos de plano), e é ele que `init`,
  `update`, `harnesses` e o writer de harness passam a iterar. `specs init`/
  `update --harnesses all` escrevem 52 arquivos de comando (antes 28); a escrita
  é aditiva e nenhum arquivo anterior muda de conteúdo.
- **`WorkflowCommand`** ganha o campo opcional `allowedTools`; o adapter do
  Claude Code usa `command.allowedTools ?? 'Bash(specs:*)'`, então os sete
  comandos existentes mantêm exatamente `Bash(specs:*)`.

## [0.7.2] - 2026-09-01

### Documentação

- **docs(schema): traduz marcadores WHEN/THEN e headers do design.md**
  - `**WHEN**`/`**THEN**` (padrão BDD/Gherkin) viram `**QUANDO**`/`**ENTÃO**` no template
    de spec, no exemplo do `schema.yaml` e no README - não são lidos por nenhum parser,
    então a tradução é livre
  - Headers do `design.md` traduzidos: `Context` → `Contexto`, `Goals / Non-Goals` →
    `Objetivos / Não-objetivos`, `Decisions` → `Decisões`, `Risks / Trade-offs` →
    `Riscos / Compensações`, `Migration Plan` → `Plano de Migração`, `Open Questions` →
    `Perguntas em Aberto` - seção também é texto livre, sem parsing por código
  - Mensagem de erro `REQUIREMENT_NO_SCENARIO` atualizada para citar QUANDO/ENTÃO
  - README ganhou nota explicando a origem do padrão (BDD/Gherkin) e por que
    `SHALL`/`MUST` ficam em inglês (RFC 2119, casados literalmente pelo parser)
  - Mantidos em inglês os termos hardcoded no parser: headers estruturais,
    `SHALL`/`MUST`, `Requirement:`, `Scenario:`, `Reason`/`Migration`, `FROM:`/`TO:`

## [0.7.1] - 2026-09-01

### Documentação

- **docs(schema): traduz os exemplos de instruction para português**
  - Exemplo de delta em `schemas/spec-driven/schema.yaml` (artefato `specs`) e o trecho
    espelhado no README estavam em inglês, e é esse texto que o agente imita ao gerar
    `spec.md` - por isso a saída real saía em inglês mesmo com o resto do prompt em PT
  - Traduzida a prosa do exemplo (nome do requisito, texto normativo, nome do cenário,
    condições WHEN/THEN) e os grupos do exemplo de `tasks.md` (`Setup`/`Export`)
  - Mantidos intactos os termos que o parser reconhece literalmente: os headers
    estruturais, `SHALL`/`MUST` e os marcadores `WHEN`/`THEN`

## [0.7.0] - 2026-08-31

### Funcionalidades

- **feat(harness): adiciona o comando `/spec-revise`**
  - Sétimo comando de workflow, fora do ciclo: revisa os artefatos de planejamento que uma
    change já tem e os mantém coerentes entre si
  - Fecha o buraco entre o `/spec-continue`, que só escreve o que falta e nunca reabre um
    artefato `done`, e o `/spec-implement`, que já é código
  - Reconcilia nos dois sentidos: uma edição num artefato tardio pode exigir revisar um
    anterior, e a ordem de construção é uma ordem de leitura, não uma restrição
  - Edita apenas os arquivos que o `specs status` lista em `outputs` — já expandidos —
    e nunca o padrão `generates`; ids e caminhos vêm do schema ativo, sem ramificar por
    nome de artefato, então um schema customizado funciona sem mudança
  - Não avança a fronteira de construção: artefato que falta é do `/spec-continue`, código é do
    `/spec-implement`, e um pedido que muda a *intenção* da change vira outra change pelo
    `/spec-propose`
  - Toda edição é mostrada e confirmada antes de ser escrita; ao final roda
    `specs validate <change> --strict`
  - Gerado para Claude Code, Codex, OpenCode e Kiro, como os demais
  - Adaptado do `update` do OpenSpec para o vocabulário deste projeto; o nome difere de
    propósito, já que `specs update` na CLI é outra coisa: regerar arquivos de comando

### Documentação

- **docs: descreve o `/spec-revise` no README e no guia do workflow**

## [0.6.0] - 2026-08-31

### Correções

- **fix(harness): as dicas citavam comandos de outro harness**
  - Os corpos de instrução escreviam `/spec-<id>` à mão, então o arquivo gerado para o
    Codex — onde os comandos são skills chamadas com `$` — mandava o usuário rodar uma
    barra que aquele harness não aceita
  - Um corpo agora escreve um placeholder (`commandRef`) e o adaptador do harness o
    resolve na hora de gerar o arquivo; o adaptador passa a declarar como o usuário digita
    um comando (`invocation`)
  - Vale para toda mensagem que cita um comando: próximo passo do `continue`, do `propose`,
    do `implement` e do `verify`, os guardrails que apontam para um comando irmão, os
    exemplos do `explore`, o `next` do painel, a linha de painel vazio e os próximos
    passos do `specs init`
  - Uma referência a um comando que não existe passa a falhar na geração, em vez de
    entregar o placeholder cru dentro do arquivo

### Melhorias

- **feat(cli): a CLI detecta o harness em que está rodando**
  - As dicas que ela imprime saem na sintaxe desse harness
  - Ordem: `SPECS_HARNESS`, as variáveis que o próprio harness define, os harnesses do
    `spec/config.yaml`, e por fim o primeiro suportado
  - `specs status --json` ganha o campo `harness`; `specs harnesses --json` ganha um mapa
    `invocations` por harness, e `commands[].invocation` vira `commands[].name`

## [0.5.1] - 2026-08-31

### Correções

- **fix(cli): `specs status --json` servia o painel desenhado em vez de JSON**
  - O desvio para o painel testava só `--change` e `--all`, então sem argumento o
    comando imprimia o desenho mesmo com `--json`
  - Sem `--change` nem `--all`, o documento agora é o do painel (`projectName`,
    `schema`, `changes`, `specs`, `archive`, `totals`); com `--change` e com `--all`
    o formato segue o de antes

### Melhorias

- **style(cli): redesenha o wordmark do painel**
  - De 49 para 41 colunas, com cada traço ocupando uma célula inteira
  - O `W` passa a ter cinco colunas: com três ele saía idêntico ao `H`

### Documentação

- **docs(cli): descreve o que `specs status --json` serve em cada forma**

## [0.5.0] - 2026-08-31

### Funcionalidades

- **feat(harness): adiciona o modo `/spec-explore`**
  - Sexto comando de workflow, fora do ciclo: pode rodar antes ou durante qualquer etapa
  - Gerado para Claude Code, Codex, OpenCode e Kiro, como os demais
  - Postura de investigação, não workflow: sem passos fixos e sem artefato obrigatório
  - Somente leitura por padrão; escrever um artefato exige escopo nomeado e confirmação
    explícita do usuário numa mensagem separada
  - Adaptado do `explore` do OpenSpec para o vocabulário deste projeto: deltas de spec,
    capacidades e os comandos da CLI `specs`

### Correções

- **fix(cli): traduz a mensagem de `specs instructions` sem artefato**
  - Numa change com todos os artefatos escritos, o comando respondia em inglês; a
    mensagem estava no CLI, longe das outras que já tinham sido traduzidas

### Documentação

- **docs: corrige a formatação do README**
  - Alinha a coluna de descrição da linha do `specs status` no bloco da CLI
  - Reflui os dois parágrafos que passavam da largura das demais linhas do corpo
  - Marca como `text` as duas cercas de código que estavam sem linguagem

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
