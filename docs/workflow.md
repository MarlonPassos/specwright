# O workflow

Cinco comandos, em ordem. Cada um tem um único trabalho e para quando esse trabalho
termina, então uma revisão pode acontecer entre quaisquer duas etapas.

```
/spec-propose  ->  /spec-plan  ->  /spec-implement  ->  /spec-verify  ->  /spec-archive
```

## /spec-propose

Abre uma change e escreve o `proposal.md`.

O agente transforma o pedido num nome de change em kebab-case, lê as capacidades
existentes (`specs list --specs`) para que a proposta fale de caminhos de spec reais, roda
`specs new change` e escreve a proposta a partir do template e das instruções do schema.

A seção **Capabilities** da proposta é o contrato contra o qual as delta specs são
escritas: toda capacidade listada ali precisa de um arquivo de delta, e todo arquivo de
delta deve estar listado ali.

O comando para depois da proposta. O planejamento continua no próximo.

## /spec-plan

Escreve os artefatos de planejamento restantes até a implementação poder começar.

O agente lê `specs status --change <id> --json`, pega o que estiver `ready`, pede as
instruções dele, escreve e verifica de novo. Para quando o `applyBlockedBy` fica vazio,
então roda `specs validate <change> --strict` e corrige o que voltar.

O documento de design é condicional: as instruções dele mesmas dizem quando vale a pena
escrevê-lo. Um artefato que o agente pula deliberadamente não bloqueia os artefatos que
dependem dele.

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
| plan | `specs/**/spec.md`, `design.md` (quando se justifica), `tasks.md` |
| implement | boxes marcados no `tasks.md`, e o código |
| verify | um relatório; nenhum arquivo muda |
| archive | `spec/specs/` atualizado, a change em `spec/changes/archive/` |
