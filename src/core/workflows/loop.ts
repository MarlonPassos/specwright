import { commandRef, type WorkflowCommand } from './types.js';
import { ARTIFACT_RULES, CLI_NOTE } from './shared.js';

export function loopCommand(): WorkflowCommand {
  return {
    id: 'loop',
    name: 'Spec Loop',
    description: 'Somente por pedido explícito: executa autonomamente um plano até concluir todas as changes ou exigir intervenção',
    argumentHint: '[plan-id]',
    allowedTools: 'Bash, Read, Write, Edit, Glob, Grep, Task',
    body: `Execute o grafo do plano continuamente: propose → implement → verify, encerrando cada
change verificada com archive para liberar suas dependências.

## Ativação explícita e escopo

Só entre neste modo quando o usuário invocar ${commandRef('loop')} ou pedir explicitamente
execução autônoma do plano até a conclusão. Ler este arquivo, gerar um plano, consultar
status/next, habilitar paralelismo ou terminar uma fase NÃO ativa o loop. Se não há esse
pedido, não execute este fluxo. Não persista autorização em configuração nem inicie
processo em background. Uma nova sessão exige novo pedido explícito para retomar.

O pedido autoriza escolher a próxima change, escrever os artefatos, implementar, testar,
corrigir falhas dentro do escopo e arquivar após verificar. Explique o plano selecionado e
o encerramento automático antes de trabalhar; não peça aprovação a cada fase ou lote.
Neste modo as pausas de transição de ${commandRef('propose')}, ${commandRef('continue')},
${commandRef('implement')} e ${commandRef('verify')} são substituídas por esta continuidade.
Use os procedimentos de cada fase abaixo; não invoque comandos irmãos que encerram o turno.
Respeite as permissões do harness e as instruções do projeto. Não altere escopo, critérios
de aceite, dependências, blockers, estados de planejamento ou trabalho concluído para
forçar progresso. Publicar, fazer deploy, descartar trabalho e usar --force não estão
autorizados por este modo.

${CLI_NOTE}

## Seleção e reavaliação

1. Rode \`specs project list --json\`. Use o plan-id pedido; sem ele, use o único plano
   disponível. Se houver vários, pergunte qual executar antes de escrever. Guarde o ID e
   passe-o explicitamente em TODOS os comandos \`specs project\` que aceitam plan-id.
2. Rode \`specs project loop <plan-id> --json\`, \`specs project status <plan-id> --json\`
   e \`specs project next <plan-id> --json\`. A CLI só consulta o estado; quem executa é você.
3. \`candidates\` contém TODAS as ações disponíveis. \`recommended\` é uma recomendação,
   não uma obrigação. Escolha considerando prioridade, trabalho iniciado, custo, riscos e
   dependentes desbloqueados; explique brevemente a decisão. \`blockedBy\` representa espera
   por dependência, não uma pergunta ao usuário enquanto outra change pode avançar.
4. Releia o snapshot após cada fase, vínculo, integração e archive. Nunca drene uma fila
   antiga sem consultar o grafo de novo. Se a revisão ou os artefatos mudaram, reavalie antes
   de escrever. Não inicie trabalho em plano pausado, arquivado, draft ou reviewing.

## Execute a ação escolhida

- **link**: confira a identidade exata existente e rode
  \`specs project link <plan-id> <CH-NNN> <change> --json\`. Retome a change vinculada;
  nunca recrie um diretório ativo ou arquivado. Releia o grafo antes de implementar.
- **propose**: leia o Planned Change, arquitetura e specs relacionadas como contexto.
  Rode \`specs new change <slug> --json\` e vincule imediatamente ao incremento do plano
  selecionado. Escreva proposta, design, deltas e tarefas pelas instruções do schema.
- **continue**: retome os artefatos faltantes da change existente. Para propose/continue,
  consulte \`specs status --change <change> --json\` após cada artefato e percorra \`next\`
  até todos estarem prontos; nunca sobrescreva artefatos completos para reiniciar o ciclo.
- **implement**: carregue \`specs instructions implement --change <change> --json\`, leia
  os artefatos e implemente as tarefas pendentes. Verifique cada tarefa antes de marcar o
  checkbox em \`tracks\`. Escolhas técnicas locais e correções dentro do contrato são suas;
  registre as suposições relevantes e siga. Nunca marque trabalho não verificado.
- **verify**: \`verifying\`, arquivos existentes e checkboxes completos NÃO comprovam
  sucesso. Rode \`specs validate <change> --strict --json\`, confira as tarefas no código,
  leia \`specs show <change> --json --deltas-only\` e verifique cada cenário com evidência.
  Rode os testes relevantes e a suíte do projeto. Ausência de tarefas não prova implementação:
  confira o comportamento e as instruções do schema. Se faltou implementar, implemente antes
  de repetir verify. Falhas corrigíveis voltam para implement automaticamente; não afrouxe
  requisitos nem pule testes para obter sucesso.

${ARTIFACT_RULES}

## Encerramento de cada change

Após verify passar de verdade, leia \`specs instructions archive --change <change> --json\`
e os deltas, confira que não há tarefas pendentes nem worktrees em andamento e rode
\`specs archive <change> --json\`, sem --force nem --no-validate. Siga a verificação das
specs resultantes de ${commandRef('archive')}: \`specs validate --specs --strict --json\`;
complete um propósito placeholder recém-gerado quando necessário. Só avance após passar.
Confirme no plano selecionado que o incremento tem \`execution: archived\`. Esse é o
registro persistente de conclusão que libera dependências; não crie um status done paralelo.
Não arquive o plano inteiro nem reabra um archive. Continue imediatamente com o novo snapshot.

## Paralelismo decidido pelo modelo

A ativação deste modo autoriza delegar changes independentes quando o harness disponibiliza
subagentes. Não exige habilitar parallelPropose/defaultParallel globalmente. Sem subagentes
ou isolamento adequado, execute sequencialmente e continue até o fim.

- Escolha um subconjunto dos candidatos atuais. \`parallelReady\` prova apenas independência
  declarada; leia briefs, deltas e código para avaliar arquivos compartilhados e conflitos.
  \`implementBatch\` é uma sugestão conservadora por capability, não prova de isolamento.
- Para propor em paralelo, crie e vincule as changes em sequência e entregue a cada subagente
  somente o diretório de artefatos dele. Nenhum worker escreve no plano ou em outra change.
- Para implementar changes em paralelo, todas precisam estar prontas e sem dependência entre
  si. Os artefatos precisam estar commitados, pois worktrees partem de HEAD. Faça commits
  locais apenas do trabalho produzido por este loop, incluindo os vínculos do plano; não
  inclua, descarte nem guarde em stash alterações alheias. Se não puder deixar a árvore
  principal limpa para integrar, continue sequencialmente. Use
  \`specs worktree create --change <change> --whole-change --json\` em sequência.
  Dispare um worker por path retornado, com escopo, critérios, testes e instrução de commit
  local do resultado. Não aninhe dispatch de tarefas dentro desses worktrees.
- Workers nunca arquivam, vinculam, alteram o plano nem finalizam worktrees. Espere todos
  retornarem. O coordenador integra sucessos com commit real, um por vez, usando
  \`specs worktree finish --change <change> --whole-change --json\`. Releia o grafo antes
  de cada integração e verifique de novo o resultado integrado na árvore principal.
- Resolva conflitos mecânicos dentro do escopo quando houver evidência suficiente. Após
  resolver o merge na árvore principal e testar, use
  \`specs worktree resume --change <change> --whole-change --json\`.
  Conflito de intenção/contrato exige decisão do usuário.
  Nunca descarte um worktree para esconder falha nem integre um worker que não terminou.

## Conclusão, recuperação e intervenção

- \`state: completed\`: todos os incrementos não cancelados estão arquivados. Reporte os
  concluídos, os cancelados separadamente, verificações e decisões relevantes; encerre.
  Plano vazio, on_hold, idea e dependência bloqueada não contam como conclusão.
- \`state: blocked\`: examine \`blockers\` e diagnósticos. Tente recuperação local sem
  perda de trabalho. Um brief missing/outdated pode ser materializado com
  \`specs project generate <plan-id> --change <CH-NNN> --dry-run --json\` e depois sem
  --dry-run, se o escopo já estiver definido. Não sobrescreva brief modified nem invente
  escopo para preencher um brief inválido. Preserve as escritas de plano pela CLI.
- \`worktree_active\`: inspecione \`specs worktree list --whole-change --json\` e
  \`specs worktree list --change <change> --json\`. Se pertence a um worker seu, espere ou
  recupere seu resultado; não duplique execução. Trabalho de outra sessão exige conciliação.
- Falha de teste, erro transitório e decisão de implementação não são intervenção por si.
  Investigue e corrija dentro do escopo. Compare a evidência antes/depois de cada tentativa;
  não repita indefinidamente a mesma ação com o mesmo erro sem nova hipótese ou progresso.
  Ao esgotar correções justificadas, pare com causa, tentativas e a ação externa necessária.
- Peça intervenção por ambiguidade material de escopo/aceite, credencial ou permissão ausente,
  dependência externa indisponível, grafo inválido, conflito de intenção ou ausência real de
  avanço possível. Termine trabalho independente que ainda possa avançar com segurança antes
  de pausar por um bloqueio local; uma pausa/cancelamento do usuário interrompe o loop inteiro.
- Ao pausar, preserve artefatos, checkboxes, vínculos e worktrees. Informe plano, incremento,
  fase, evidência, pendências e pergunta concreta. Uma nova invocação de ${commandRef('loop')}
  retoma pelo estado do disco e repete verify se não houver evidência atual de sucesso.
  Limites de contexto/sessão não significam conclusão; reporte onde retomar explicitamente.`,
  };
}
