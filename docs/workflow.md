# O workflow

## spec-loop

Para executar um plano inteiro, invoque `$spec-loop <plan-id>` no Codex ou
`/spec-loop <plan-id>` nos demais harnesses, após atualizar os comandos com
`specs update`. Esse é um modo explícito de execução autônoma na sessão do agente.
Gerar um plano ou habilitar paralelismo não o ativa. Sem plan-id, um único plano
é selecionado; com vários, o agente solicita a escolha antes de escrever.

O agente consulta `specs project loop <plan-id> --json` e o estado completo do
grafo após cada fase. Escolhe entre todas as changes elegíveis, pode propor e
implementar incrementos independentes em paralelo quando houver subagentes e
isolamento por worktree, e usa execução sequencial nos demais casos. A decisão
considera também os arquivos e contratos envolvidos, não só as arestas do grafo.
Integrações e arquivamentos são feitos pelo coordenador, em sequência, com nova
verificação na árvore principal.

Cada change percorre **propose → implement → verify**, incluindo os artefatos
intermediários de `continue`. Falhas corrigíveis voltam à implementação sem nova
aprovação. Após verificar, o agente arquiva a change: é o archive que registra
a conclusão e libera os dependentes no grafo existente. Tarefas marcadas e
`execution: verifying` nunca substituem a verificação do comportamento.

Decisões técnicas abertas são resolvidas pelo próprio agente: ele segue sua
recomendação, registra a justificativa no design e continua, inclusive antes de
escrever `tasks.md`. Isso inclui driver SQLite, caminho padrão de armazenamento,
biblioteca TUI e estratégia de testes. Não há uma confirmação adicional para
"seguir a recomendação". Quando necessário, o agente faz um spike, testa a escolha
e adota um fallback compatível se ela falhar. Workers seguem a mesma política.
Escolhas explícitas do usuário e requisitos existentes continuam sendo respeitados.

O loop termina quando todos os incrementos não cancelados estiverem arquivados.
Se há trabalho independente disponível, um bloqueio local não encerra o loop.
Sem avanço possível, ele pausa com a causa, as tentativas e a decisão necessária:
objetivo/requisito de produto ou aceite ambíguo que uma escolha técnica não resolva,
blocker manual, recurso externo indisponível, conflito
de intenção ou falha sem correção justificada. Não há repetição indefinida do
mesmo erro sem progresso. Planos pausados/arquivados e estados `idea`/`on_hold`
são respeitados; não são alterados para forçar conclusão.

Artefatos, tarefas, vínculos e worktrees preservam o progresso. Uma nova invocação
explícita retoma a partir do disco e verifica novamente quando necessário.
Não há processo em background: limites da sessão devem ser reportados como
interrupção, nunca como conclusão. A autorização não abrange deploy, publicação,
descarte de trabalho ou mudanças nos critérios do plano.

## Ciclo tradicional

O ciclo de entrega tem cinco comandos, em ordem. Cada um tem um único trabalho e para
quando esse trabalho termina, então uma revisão pode acontecer entre quaisquer duas etapas.
O modo `/spec-explore` é opcional e pode ser usado antes de abrir uma change ou entre
quaisquer etapas para investigar, comparar opções e esclarecer requisitos. O
`/spec-revise` também fica fora do ciclo: ele reabre os artefatos que uma change já tem
quando uma decisão muda.

```
/spec-explore (opcional, antes ou entre etapas)

/spec-propose  ->  /spec-continue  ->  /spec-implement  ->  /spec-verify  ->  /spec-archive
                          ^
                    /spec-revise (opcional, sobre o que já foi escrito)
```

## /spec-explore

Entra em modo de exploração, como parceiro de pensamento. O agente pode ler arquivos,
buscar no código, investigar o repositório, comparar abordagens e usar diagramas ASCII.
Não há passos fixos nem saída obrigatória.

Exploração não implementa código. Se surgir um pedido de implementação, o agente deve
encerrar a exploração e abrir ou continuar uma change pelo fluxo normal. O agente pode
registrar decisões em artefatos de uma change, mas somente dentro de um escopo confirmado
explicitamente antes da primeira escrita.

## /spec-propose

Abre uma change e escreve o `proposal.md`.

O agente transforma o pedido num nome de change em kebab-case, lê as capacidades
existentes (`specs list --specs`) para que a proposta fale de caminhos de spec reais, roda
`specs new change` e escreve a proposta a partir do template e das instruções do schema.

A seção **Capabilities** da proposta é o contrato contra o qual as delta specs são
escritas: toda capacidade listada ali precisa de um arquivo de delta, e todo arquivo de
delta deve estar listado ali.

O comando para depois da proposta. O planejamento continua no próximo.

## /spec-continue

Escreve os artefatos de planejamento restantes até a implementação poder começar.

O agente lê `specs status --change <id> --json`, pega o que estiver `ready`, pede as
instruções dele, escreve e verifica de novo. Para quando o `applyBlockedBy` fica vazio,
então roda `specs validate <change> --strict` e corrige o que voltar.

O documento de design é condicional: as instruções dele mesmas dizem quando vale a pena
escrevê-lo. Um artefato que o agente pula deliberadamente não bloqueia os artefatos que
dependem dele.

## /spec-revise

Revisa os artefatos de planejamento que a change já tem, sem criar nenhum novo.

O `/spec-continue` só escreve o que falta: um artefato `done` ele não reabre. Quando uma
decisão muda no meio do planejamento — ou depois dele — é o `/spec-revise` que aplica a
mudança e reconcilia o resto.

O agente lê `specs status --change <id> --json`, edita apenas os arquivos listados em
`outputs` (que já vêm com qualquer padrão expandido, nunca o padrão `generates`), e
confronta os artefatos entre si **nos dois sentidos**: uma edição no design pode exigir
revisar a proposta, não só o contrário. Cada revisão é mostrada e só é escrita depois que o
usuário confirma; ao final ele roda `specs validate <change> --strict`.

Ele não avança a fronteira de construção: artefato que ainda não existe é do `/spec-continue`,
e código é do `/spec-implement`. Se o pedido muda a *intenção* da change em vez de refiná-la,
o caminho é abrir outra change pelo `/spec-propose`.

## /spec-implement

Trabalha o checklist do `tasks.md`.

Para cada tarefa não marcada o agente a implementa, roda a verificação que a tarefa nomeia
e só então marca o box. O arquivo de checkbox é o registro de progresso, então as marcas
acontecem conforme o trabalho entra, não em lote no final.

As delta specs são os critérios de aceite: cada cenário é um teste que vale ter.

## /spec-verify

Confere a change contra o que ela prometeu, e reporta.

- `specs validate <change> --strict` para as regras estruturais;
- o checklist contra o código — um box marcado sem nada por trás é um achado;
- cada cenário nos deltas contra um teste, um comando ou código que se possa apontar;
- desvio nos dois sentidos: comportamento que ninguém especificou, e requisitos que
  ninguém construiu.

Ele reporta em vez de corrigir, a menos que o usuário peça outra coisa.

## /spec-archive

Aplica a change nas specs e a encerra.

O `specs archive` se recusa a rodar enquanto a validação falha ou há tarefas não marcadas.
Ele calcula todos os merges antes de escrever qualquer coisa, então um delta que não pode
ser aplicado interrompe o arquivamento com o workspace intacto. Depois:

- `ADDED` acrescenta um requisito à spec da sua capacidade, criando a spec se a capacidade
  for nova;
- `MODIFIED` substitui o bloco existente por inteiro — que é por que um delta MODIFIED
  precisa carregar o texto atualizado completo;
- `REMOVED` apaga o bloco, e uma capacidade que perde o último requisito é aposentada
  junto com o arquivo dela;
- `RENAMED` troca o cabeçalho e mantém o corpo.

O diretório da change então vai para `spec/changes/archive/<data>-<nome-da-change>/`.

## O que cada etapa deixa para trás

| Etapa | Artefatos depois dela |
| --- | --- |
| propose | `.change.yaml`, `proposal.md` |
| continue | `specs/**/spec.md`, `design.md` (quando se justifica), `tasks.md` |
| revise | os mesmos artefatos, revisados; nenhum arquivo novo |
| implement | boxes marcados no `tasks.md`, e o código |
| verify | um relatório; nenhum arquivo muda |
| archive | `spec/specs/` atualizado, a change em `spec/changes/archive/` |

## Onde o plano encosta no ciclo (opcional)

O [Project Planning](project-planning.md) fica **acima** deste ciclo. Ele decide
*quais* changes devem existir e em que ordem; o ciclo acima continua respondendo
*o que* cada change significa e *como* se verifica que foi feita.

- O Planned Change de um incremento entra como **contexto** de `/spec-explore` ou
  `/spec-propose` — nunca substitui `proposal.md`, `design.md`, os deltas ou
  `tasks.md`.
- A passagem é sempre iniciada por uma pessoa. Nenhum comando de plano cria,
  implementa, verifica ou arquiva uma change.
- Depois que a change existe, `specs project link <change-id> <change-name>`
  registra o vínculo 1:1.
- Quando a change é arquivada pelo ciclo normal, o archive tenta fechar — como
  efeito best-effort — o vínculo já previsto: o incremento não cancelado, ainda
  sem vínculo, cujo `slug` é igual ao nome da change. Quando há exatamente um
  candidato, a saída traz o bloco `plan` com o vínculo gravado. Quando não há
  candidato, há mais de um, ou o plano está ausente, ilegível ou recusa a
  escrita, o arquivamento continua bem-sucedido e o `status` seguinte reporta
  `unclaimed_archive`; no caso de ambiguidade, a saída traz `planAmbiguity` e
  os candidatos para escolha explícita.

O que o plano **não** faz: gerar código, criar artefatos de change, executar
agentes em paralelo, guardar estado fora do Git, ou alterar uma change arquivada.
