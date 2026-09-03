/**
 * The panel, as one self-contained page.
 *
 * Embedded in a module instead of shipped as an asset for two reasons: `tsc`
 * compiles `src/**\/*.ts` and copies nothing else, so an `.html` file would need
 * a build step and an entry in `package.json` `files`; and a page that cannot be
 * missing at runtime is one less failure mode. No framework, no bundler, no
 * network fetch — NFR-11 holds.
 *
 * Four tabs: the three the terminal panel has, plus the document catalogue that
 * only a page can offer. Reachable by click, by `1`..`4` and by Tab — the habit
 * carries over. The tab lives in the hash, so a reload keeps the reader where
 * they were. Dark is the default and mirrors the terminal
 * theme; the light palette is a token swap on `[data-theme=light]`.
 */
export const INDEX_HTML = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Specwright</title>
<style>
:root{
  --bg:#0e1a1f; --panel:#132329; --sunken:#0a1418; --line:#1e3640;
  --ink:#dbeef2; --dim:#7fa3ad;
  --cyan:#38d6e8; --green:#4ade80; --yellow:#fbbf24; --red:#f87171;
}
:root[data-theme=light]{
  --bg:#f4f7f8; --panel:#ffffff; --sunken:#e6edef; --line:#d3dfe3;
  --ink:#12262d; --dim:#5c7a84;
  --cyan:#0d8fa3; --green:#15803d; --yellow:#a16207; --red:#b91c1c;
}
*{box-sizing:border-box;min-width:0}
html,body{max-width:100%;overflow-x:hidden}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding:16px 22px 0}
h1{margin:0;font-size:19px;letter-spacing:.22em;color:var(--cyan);font-weight:700}
.sub{color:var(--dim);font-size:13px}
.hsel{display:inline-flex;align-items:center;gap:7px}
.hsel select{background:var(--sunken);border:1px solid var(--line);border-radius:6px;
  color:var(--ink);font:inherit;font-size:12px;padding:3px 7px;cursor:pointer}
.hsel select:hover,.hsel select:focus{border-color:var(--cyan);outline:none}
.hsel .src{font-size:11px;color:var(--dim)}
.right{margin-left:auto;display:flex;align-items:center;gap:14px}
#live{font-size:12px;color:var(--dim);display:flex;align-items:center;gap:7px}
#dot{width:8px;height:8px;border-radius:50%;background:var(--dim);transition:background .3s}
#dot.on{background:var(--green);box-shadow:0 0 8px var(--green)}
#theme{background:none;border:1px solid var(--line);color:var(--dim);cursor:pointer;
  border-radius:6px;padding:4px 10px;font:inherit;font-size:12px}
#theme:hover{color:var(--ink);border-color:var(--cyan)}
nav{display:flex;gap:6px;padding:12px 22px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
nav button{background:none;border:0;border-bottom:2px solid transparent;color:var(--dim);
  cursor:pointer;font:inherit;padding:8px 14px;letter-spacing:.12em;font-size:12px}
nav button:hover{color:var(--ink)}
nav button[aria-selected=true]{color:var(--cyan);border-bottom-color:var(--cyan)}
nav .k{opacity:.55;margin-right:6px}
main{padding:20px 22px;display:grid;gap:16px;max-width:1180px;margin:0 auto;width:100%}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:15px 18px}
h2{margin:0 0 12px;font-size:11px;letter-spacing:.19em;color:var(--dim);font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px}
.kpi .n{font-size:25px;font-weight:700}
.kpi .l{color:var(--dim);font-size:12px}
.bar{height:8px;background:var(--sunken);border-radius:4px;overflow:hidden;margin:8px 0 4px}
.bar>i{display:block;height:100%;background:var(--green);transition:width .4s}
.row{display:flex;gap:11px;align-items:baseline;padding:8px 0;border-top:1px solid var(--line);
  flex-wrap:wrap}
.row:first-child{border-top:0}
.id{color:var(--cyan);font-weight:700;min-width:78px}
.tag{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--dim);white-space:nowrap}
.t-green{color:var(--green);border-color:var(--green)}
.t-cyan{color:var(--cyan);border-color:var(--cyan)}
.t-yellow{color:var(--yellow);border-color:var(--yellow)}
.t-red{color:var(--red);border-color:var(--red)}
.t-dim{opacity:.6}
.grow{flex:1 1 220px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp,.dchip{display:inline-flex;align-items:center;gap:7px;max-width:100%;
  overflow-wrap:anywhere;text-align:left;background:var(--sunken);
  border:1px solid var(--line);border-radius:6px;color:var(--cyan);cursor:pointer;
  font:inherit;font-size:12px;padding:3px 9px;transition:border-color .15s,color .15s}
.cp:hover,.dchip:hover{border-color:var(--cyan)}
.dchip{cursor:pointer}
.cp svg{width:13px;height:13px;flex:none;opacity:.5;transition:opacity .15s}
.cp:hover svg{opacity:1}
.cgroup{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 0 5px 89px}
.clabel{font-size:11px;letter-spacing:.13em;color:var(--dim);min-width:82px}
.cp.done{color:var(--green);border-color:var(--green)}
.cp.done svg{opacity:1}
#toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,14px);
  background:var(--panel);border:1px solid var(--green);color:var(--green);
  border-radius:8px;padding:9px 16px;font-size:13px;opacity:0;pointer-events:none;
  transition:opacity .2s,transform .2s}
#toast.on{opacity:1;transform:translate(-50%,0)}
.muted{color:var(--dim)}
.sm{font-size:12px}
.empty{color:var(--dim);padding:5px 0}
.sub2{color:var(--dim);font-size:12px;padding:2px 0 2px 89px;overflow-wrap:anywhere}
.dots{letter-spacing:3px;min-width:78px}
.d-done{color:var(--green)} .d-ready{color:var(--cyan)} .d-blocked{opacity:.35} .d-skipped{opacity:.3}
.mile{display:flex;gap:12px;align-items:center;padding:6px 0;flex-wrap:wrap}
.mile .nm{flex:1 1 150px;min-width:0}
.mile .bar{flex:1;margin:0}
.mile.pick{cursor:pointer;border-radius:8px;padding:6px 8px;margin:0 -8px}
.mile.pick:hover{background:var(--sunken)}
.mile.pick.on{background:var(--sunken);box-shadow:inset 2px 0 0 var(--cyan)}
/* Explicação do card: um glifo discreto no título, a frase só quando pedida. */
.hint{position:relative;z-index:6;display:inline-flex;align-items:center;margin-left:8px;
  color:var(--dim);cursor:help;opacity:.6;transition:opacity .15s,color .15s}
.hint:hover,.hint:focus{z-index:7}
.hint:hover,.hint:focus{opacity:1;color:var(--cyan);outline:none}
.hint svg{width:12px;height:12px}
.hint::after{content:attr(data-hint);position:absolute;left:0;top:calc(100% + 9px);
  width:max-content;max-width:min(340px,72vw);
  background:var(--panel);border:1px solid var(--line);border-radius:8px;
  padding:9px 12px;color:var(--ink);font:inherit;font-size:12px;font-weight:400;
  line-height:1.5;letter-spacing:0;text-transform:none;white-space:normal;
  box-shadow:0 10px 26px rgba(0,0,0,.34);
  opacity:0;pointer-events:none;transition:opacity .15s}
.hint:hover::after,.hint:focus::after{opacity:1}
@media(max-width:640px){.hint::after{left:auto;right:0}}
section.toolbar{padding:11px 18px}
.hrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.hrow h2{margin:0}
.hrow .count{margin-left:auto;color:var(--dim);font-size:11px;letter-spacing:.1em}
.srch{display:inline-flex;align-items:center;gap:8px;padding:4px 11px;border-radius:99px;
  border:1px solid var(--line);background:var(--sunken);transition:border-color .15s}
.srch:focus-within{border-color:var(--cyan)}
.srch svg{width:13px;height:13px;flex:none;color:var(--dim);opacity:.8}
.srch:focus-within svg{color:var(--cyan);opacity:1}
.srch input{width:172px;max-width:46vw;background:none;border:0;outline:none;padding:0;
  color:var(--ink);font:inherit;font-size:12px;transition:width .18s}
.srch input:focus{width:248px}
.srch input::placeholder{color:var(--dim)}
.chip{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:11px;padding:3px 9px;
  border-radius:99px;border:1px solid var(--cyan);color:var(--cyan);background:none;cursor:pointer}
.chip:hover{background:var(--sunken)}
.dp{cursor:pointer}
.dtitle{flex:1 1 190px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpath{color:var(--dim);font-size:11px;overflow-wrap:anywhere}
.tk{display:flex;gap:10px;align-items:baseline;padding:4px 0}
.tk .bx{flex:none;color:var(--dim)}
.tk.ok .bx{color:var(--green)}
.tk.ok .txt{color:var(--dim)}
.tk .no{flex:none;min-width:32px;color:var(--dim);font-size:12px}
.tk .txt{flex:1 1 200px;overflow-wrap:anywhere}
.tks{padding:3px 0 6px 89px}
.tks .tk{padding:2px 0;font-size:12px}
.tks .tk .bx{font-size:11px}
.tks .more{margin-top:5px}
@media(max-width:640px){.tks{padding-left:0}}
details.card{background:var(--panel);border:1px solid var(--line);border-radius:10px}
details.card>summary{list-style:none;cursor:pointer;padding:15px 18px;
  font-size:11px;letter-spacing:.19em;color:var(--dim);font-weight:700;
  display:flex;align-items:center;gap:9px;user-select:none}
details.card>summary::-webkit-details-marker{display:none}
details.card>summary:hover{color:var(--ink)}
details.card>summary .caret{transition:transform .18s;flex:none;opacity:.6}
details.card[open]>summary .caret{transform:rotate(90deg)}
details.card>summary .count{margin-left:auto;font-weight:400;letter-spacing:0;opacity:.75}
details.card>.body{padding:0 18px 15px}
.openable{cursor:pointer;text-decoration:underline;text-decoration-style:dotted;
  text-underline-offset:3px;text-decoration-color:var(--line)}
.openable:hover{text-decoration-color:var(--cyan)}
/* ---- grafo de dependências ---- */
#gmodal{position:fixed;inset:26px;z-index:10;display:none;flex-direction:column;
  background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;
  box-shadow:0 24px 60px rgba(0,0,0,.45)}
#gmodal.on{display:flex}
#gmodal .head{display:flex;align-items:center;gap:12px;padding:14px 18px;flex-wrap:wrap;
  border-bottom:1px solid var(--line)}
#gmodal .head h2{margin:0}
#gmodal .head .grow{flex:1 1 40px}
#gwrap{flex:1;min-height:0;overflow:hidden;background:var(--sunken);cursor:grab}
#gwrap.drag{cursor:grabbing}
#gsvg{display:block;width:100%;height:100%;touch-action:none}
#gmodal .foot{display:flex;align-items:center;gap:16px;flex-wrap:wrap;
  padding:10px 18px;border-top:1px solid var(--line);color:var(--dim);font-size:11px}
.lg{display:inline-flex;align-items:center;gap:6px}
.lg i{width:9px;height:9px;border-radius:3px;display:inline-block}
.gwave{fill:var(--dim);font-size:10px;letter-spacing:.18em}
.gedge{fill:none;stroke:var(--line);stroke-width:1.6}
.gedge.block{stroke:var(--yellow);stroke-dasharray:5 4}
.gedge.lit{stroke:var(--cyan);stroke-width:2.2}
.gn{cursor:pointer}
.gn rect{fill:var(--panel);stroke:var(--line);stroke-width:1.5;rx:9}
.gn .id{fill:var(--cyan);font-size:12px;font-weight:700}
.gn .ti{fill:var(--ink);font-size:11px}
.gn .ms{fill:var(--dim);font-size:10px}
.gn.s-green rect{stroke:var(--green)} .gn.s-green .id{fill:var(--green)}
.gn.s-cyan rect{stroke:var(--cyan)}
.gn.s-yellow rect{stroke:var(--yellow)} .gn.s-yellow .id{fill:var(--yellow)}
.gn.s-red rect{stroke:var(--red)} .gn.s-red .id{fill:var(--red)}
.gn.s-dim rect{stroke:var(--line);opacity:.75}
.gn.run rect{stroke-width:2.6;filter:drop-shadow(0 0 7px var(--cyan))}
.gn.done rect{fill:color-mix(in srgb,var(--green) 12%,var(--panel))}
.gn.off{opacity:.22}
.gn.lit rect{stroke-width:2.6}
svg .warn{fill:var(--yellow);font-size:11px}
@media(max-width:640px){#gmodal{inset:8px}}
#scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);opacity:0;pointer-events:none;
  transition:opacity .2s;z-index:8}
#scrim.on{opacity:1;pointer-events:auto}
#drawer{position:fixed;top:0;right:0;bottom:0;width:min(720px,100%);z-index:9;
  background:var(--panel);border-left:1px solid var(--line);
  transform:translateX(100%);transition:transform .22s;display:flex;flex-direction:column}
#drawer.on{transform:translateX(0)}
#drawer .head{display:flex;align-items:center;gap:12px;padding:16px 20px;
  border-bottom:1px solid var(--line);flex-wrap:wrap}
#drawer .head .id{min-width:0}
#drawer .head button{background:none;border:1px solid var(--line);color:var(--dim);
  cursor:pointer;border-radius:6px;padding:4px 10px;font:inherit;font-size:12px;margin-left:auto}
#drawer .head button:hover{color:var(--ink);border-color:var(--cyan)}
#drawer .md{overflow:auto;padding:6px 22px 28px;line-height:1.65}
.md h1{font-size:17px;margin:22px 0 8px;color:var(--cyan);letter-spacing:.04em}
.md h2{font-size:14px;margin:20px 0 6px;color:var(--ink);letter-spacing:0}
.md h3{font-size:13px;margin:16px 0 6px;color:var(--dim);letter-spacing:.06em}
.md p{margin:8px 0}
.md ul,.md ol{margin:8px 0;padding-left:22px}
.md li{margin:3px 0}
.md code{background:var(--sunken);border:1px solid var(--line);border-radius:4px;
  padding:1px 5px;font-size:12px;color:var(--cyan)}
.md pre{background:var(--sunken);border:1px solid var(--line);border-radius:8px;
  padding:12px 14px;overflow:auto;margin:10px 0}
.md pre code{background:none;border:0;padding:0;color:var(--ink)}
.md blockquote{border-left:3px solid var(--line);margin:10px 0;padding:2px 0 2px 14px;color:var(--dim)}
.md hr{border:0;border-top:1px solid var(--line);margin:18px 0}
.md a{color:var(--cyan)}
.md strong{color:var(--ink)}
.md .meta{color:var(--dim);font-size:12px;padding:10px 0 4px;border-bottom:1px solid var(--line)}
footer{padding:12px 22px 24px;color:var(--dim);font-size:12px;text-align:center}
@media(max-width:640px){.id,.dots{min-width:0}.mile .nm{min-width:0}.sub2{padding-left:0}}
</style>
</head>
<body>
<header>
  <h1>SPECWRIGHT</h1>
  <span class="sub" id="proj">carregando...</span>
  <span class="hsel" id="hsel" hidden>
    <select id="harness" aria-label="Harness para o qual os comandos são escritos"></select>
    <span class="src" id="hsrc"></span>
  </span>
  <span class="right">
    <span id="live"><span id="dot"></span><span id="livetext">conectando</span></span>
    <button id="theme" type="button" title="Alternar tema">tema</button>
  </span>
</header>
<nav id="tabs"></nav>
<main id="screen"></main>
<footer id="foot"></footer>
<div id="toast" role="status" aria-live="polite"></div>
<div id="scrim"></div>
<div id="gmodal" role="dialog" aria-modal="true" aria-label="Grafo de dependências do plano">
  <div class="head">
    <h2>DEPENDÊNCIAS</h2>
    <span class="muted sm" id="ginfo"></span>
    <span class="grow"></span>
    <button type="button" class="chip" id="gfit">enquadrar</button>
    <button type="button" class="chip" id="gclose">fechar (Esc)</button>
  </div>
  <div id="gwrap"><svg id="gsvg" role="img"></svg></div>
  <div class="foot" id="gfoot"></div>
</div>
<aside id="drawer" aria-hidden="true">
  <div class="head">
    <span class="id" id="dw-id"></span>
    <span class="grow" id="dw-title"></span>
    <button type="button" id="dw-close">fechar (Esc)</button>
  </div>
  <div class="md" id="dw-body"></div>
</aside>
<script>
var E=function(i){return document.getElementById(i)};
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML}
function bar(done,total,color){
  var p=total>0?Math.round(done/total*100):0;
  return '<div class="bar"><i style="width:'+p+'%;background:var(--'+(color||'green')+')"></i></div>';
}
function kpi(n,l){return '<div class="kpi"><div class="n">'+esc(n)+'</div><div class="l">'+esc(l)+'</div></div>'}
var CARET='<svg class="caret" viewBox="0 0 24 24" width="12" height="12" fill="none"'
  +' stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
  +'<path d="m9 18 6-6-6-6"/></svg>';

/**
 * O primeiro card de cada tela é fixo — é o resumo, e esconder o resumo não
 * ajuda ninguém. Os demais viram acordeão, abertos por padrão: numa tela com
 * vinte incrementos, poder fechar uma seção é a diferença entre ler e rolar.
 */
var ICO_INFO='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  +' stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11.2v4.6"/>'
  +'<path d="M12 8.1v.1"/></svg>';

/**
 * O que cada bloco é, em uma frase.
 *
 * Um painel que só mostra números supõe que quem lê já conhece o vocabulário —
 * change, incremento, delta, milestone. A frase mora no título do card, atrás
 * de um glifo, então não atrapalha quem já sabe e resolve quem não sabe.
 */
var HINTS={
  'RESUMO':'Onde o projeto está agora: changes em aberto, o que já pode ser arquivado e quanto do plano foi entregue.',
  'EM ANDAMENTO':'O trabalho em voo: a change aberta e o incremento do plano que ela realiza, na mesma linha.',
  'MILESTONES':'Marcos do plano. Cada um agrupa incrementos; clique num para ver só os dele.',
  'PRÓXIMO PASSO':'O incremento que o plano recomenda começar agora, com o comando já montado.',
  'DIAGNÓSTICOS':'O que a validação encontrou. Erro impede de seguir; aviso só alerta.',

  'PLANO':'O plano do projeto: incrementos, dependências e milestones, revisados por uma pessoa antes de virarem trabalho.',
  'INCREMENTOS':'Cada incremento planejado e o estado dele. Um incremento ainda não é uma change: ele vira uma quando o trabalho começa.',
  'EM IMPLEMENTAÇÃO':'O incremento já virou change e o trabalho está correndo.',
  'PRONTAS PARA COMEÇAR':'Dependências satisfeitas e briefing atual: dá para abrir a change agora.',
  'BLOQUEADAS':'Espera outro incremento terminar, ou um impedimento anotado à mão.',
  'CONCLUÍDAS':'Incremento cuja change já foi arquivada.',
  'FORA DO FLUXO':'Ideia, pausado ou cancelado: não entra na conta do que falta.',

  'CHANGES':'Uma change é uma alteração em andamento, com seus artefatos: proposta, specs, design e tarefas. O nome fica em inglês porque é o mesmo em spec/changes/ e nos comandos (specs new change).',
  'EM PLANEJAMENTO':'A change ainda está escrevendo artefatos; falta algo antes de implementar.',
  'IMPLEMENTANDO':'Artefatos prontos. O que resta é o checklist de tarefas.',
  'PRONTAS PARA ARQUIVAR':'Toda tarefa marcada. O arquivamento aplica os deltas nas specs e fecha a change.',
  'COM PROBLEMA':'Não foi possível ler esta change; a mensagem diz o quê.',
  'CAPACIDADES':'O comportamento que o sistema já tem, acumulado das changes arquivadas. É a verdade viva do projeto.',
  'ARQUIVO':'Changes concluídas. Os artefatos delas continuam legíveis na tela DOCUMENTOS.',

  'DOCUMENTOS':'Tudo que se lê no projeto, agrupado como ele é organizado. Clique numa linha para abrir.',
  'Projeto':'O documento que diz o que é o projeto, para quem ele é e sob que restrições.',
  'Capacidades':'Specs vivas: o comportamento atual do sistema, acumulado.',
  'Plano':'Os documentos do plano: a visão geral e a arquitetura que ele assume.',
  'Incrementos planejados':'O briefing de cada incremento, escrito antes de ele virar change.'
};

/** Grupos cujo título carrega um nome variável, casados pelo prefixo. */
var HINT_PREFIX=[
  ['Change · ','Os artefatos desta change: proposta, design, tarefas e os deltas de spec que ela escreve.'],
  ['Arquivada · ','Os artefatos de uma change já concluída, como ficaram no arquivamento.']
];

function hintFor(title){
  if(HINTS[title])return HINTS[title];
  for(var i=0;i<HINT_PREFIX.length;i++)
    if(title.indexOf(HINT_PREFIX[i][0])===0)return HINT_PREFIX[i][1];
  return '';
}

function hint(title){
  var text=hintFor(String(title));
  if(!text)return '';
  return '<span class="hint" tabindex="0" role="note" data-hint="'+esc(text)+'"'
    +' aria-label="'+esc(text)+'">'+ICO_INFO+'</span>';
}

function sec(t,b,n){return '<section><h2>'+esc(t)+hint(t)+'</h2>'+b+'</section>'}
function card(t,b,n){
  return '<details class="card" open><summary>'+CARET+esc(t)+hint(t)
    +(n!=null?'<span class="count">'+esc(n)+'</span>':'')
    +'</summary><div class="body">'+b+'</div></details>';
}
function empty(t){return '<div class="empty">'+esc(t)+'</div>'}

var ICO_COPY='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  +' stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/>'
  +'<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var ICO_OK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"'
  +' stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

/** Commands under a label, so CLI and harness never get mistaken for each other. */
function group(label,list){
  if(!list||!list.length)return '';
  return '<div class="cgroup"><span class="clabel">'+esc(label)+'</span>'
    +list.map(function(x){return cmd(x)}).join('')+'</div>';
}

/** A command the reader will paste into the harness: one click puts it on the clipboard. */
function cmd(text){
  if(!text)return '';
  return '<button type="button" class="cp" data-copy="'+esc(text)+'" title="Copiar para colar no harness">'
    +esc(text)+ICO_COPY+'</button>';
}

var PRES={'concluída':'t-green','pronta':'t-green','em implementação':'t-cyan','proposta':'t-cyan',
          'bloqueada':'t-yellow','inconsistente':'t-red','ideia':'t-dim','pausada':'t-dim','cancelada':'t-dim'};
var DOT={done:'●',ready:'◆',blocked:'○',skipped:'⊘'};
var PHASES=[['planning','EM PLANEJAMENTO'],['implementing','IMPLEMENTANDO'],
            ['ready-to-archive','PRONTAS PARA ARQUIVAR'],['broken','COM PROBLEMA']];
var STAGES=[['EM IMPLEMENTAÇÃO',['em implementação','proposta']],
            ['PRONTAS PARA COMEÇAR',['pronta']],['BLOQUEADAS',['bloqueada']],
            ['COM PROBLEMA',['inconsistente']],['CONCLUÍDAS',['concluída']],
            ['FORA DO FLUXO',['ideia','pausada','cancelada']]];

/*
 * A ordem é a do trabalho, não a da implementação: onde estamos, o que o plano
 * manda fazer, a change que faz, e os documentos que sustentam tudo.
 */
var TABS=[{id:'resumo',label:'RESUMO',route:'/api/overview'},
          {id:'plano',label:'PLANO',route:'/api/plan'},
          {id:'changes',label:'CHANGES',route:'/api/changes'},
          {id:'docs',label:'DOCUMENTOS',route:'/api/docs'}];
var cache={}, active='resumo', latest=null;

/**
 * O harness para o qual os comandos são escritos.
 *
 * O painel roda FORA do harness — o servidor sobe no terminal — então o
 * ambiente do processo raramente sabe qual está em uso, e adivinhar erra a
 * sintaxe do comando que o leitor vai colar. Aqui ele diz, e o servidor
 * remonta as projeções com esse harness. Vazio = o que o servidor decidiu.
 */
var HARNESS='';
try{HARNESS=localStorage.getItem('sw-harness')||''}catch(err){}

/** A query que carrega a escolha, para toda rota que monta comando. */
function hq(route){
  if(!HARNESS)return route;
  return route+(route.indexOf('?')>=0?'&':'?')+'harness='+encodeURIComponent(HARNESS);
}

var HSOURCE={chosen:'escolhido aqui',env:'detectado',config:'configurado',default:'padrão'};
/* Filtro por tela e milestone selecionado: o recorte é do leitor, não do dado. */
var Q={changes:'',plano:'',docs:''}, MS=null;
var KIND={project:'projeto',capability:'capacidade',proposal:'proposta',design:'design',
          tasks:'tarefas',delta:'delta',brief:'brief',plan:'plano',architecture:'arquitetura'};
var MSTAT={completed:['t-green','concluído'],in_progress:['t-cyan','em andamento'],
           not_started:['t-dim','não iniciado']};

/**
 * Busca no próprio título da seção: uma barra fina onde o nome da tela, o que
 * o filtro deixou e o campo dividem a mesma linha. O campo cresce ao receber
 * foco, então ocupa pouco enquanto ninguém o usa. Fora de um <summary> de
 * propósito: um input ali dentro abriria e fecharia o acordeão a cada clique.
 */
var ICO_FIND='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
  +' stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/></svg>';

function findBar(title,scope,ph,count,extra){
  return '<section class="toolbar"><div class="hrow"><h2>'+esc(title)+hint(title)+'</h2>'+(extra||'')
    +(count?'<span class="count">'+esc(count)+'</span>':'')
    +'<label class="srch">'+ICO_FIND+'<input type="text" data-find="'+esc(scope)+'"'
    +' value="'+esc(Q[scope])+'" placeholder="'+esc(ph)+'" aria-label="'+esc(ph)+'">'
    +'</label></div></section>';
}
function matches(scope,text){
  var q=Q[scope].trim().toLowerCase();
  return !q || String(text).toLowerCase().indexOf(q)>=0;
}
/* A tela PLANO não carrega o harness; o RESUMO carrega, então herdamos dele. */
var HARNESS_VERB={explore:'/spec-explore',propose:'/spec-propose'};

/* ---------- telas ---------- */

function screenResumo(d){
  latest=d;
  var c=d.changes,i=d.increments,h='<div class="grid">'
    +kpi(c.active,'changes ativas')+kpi(c.readyToArchive,'prontas p/ arquivar')
    +kpi(c.archived,'arquivadas')+kpi(c.capabilities+' / '+c.requirements,'capacidades / requisitos')+'</div>';
  if(c.tasks&&c.tasks.total>0)
    h+='<div style="margin-top:14px"><div class="l muted sm">tarefas '+c.tasks.completed+'/'+c.tasks.total+'</div>'+bar(c.tasks.completed,c.tasks.total,'cyan')+'</div>';
  if(i)h+='<div style="margin-top:14px"><div class="l muted sm">incrementos '+i.archived+'/'+i.total+' ('+i.percent+'%)</div>'
    +bar(i.archived,i.total)+'<div class="l muted sm">pronta '+i.ready+' · bloqueada '+i.blocked+' · em impl. '+i.inProgress+'</div></div>';
  var out=sec('RESUMO',h);

  var f=d.focus||[];
  out+=card('EM ANDAMENTO', f.length? f.map(function(x){
    var ch=x.change,inc=x.increment,r='<div class="row">';
    r+= inc ? '<span class="id openable" data-brief="'+esc(inc.id)+'">'+esc(inc.id)+'</span>'
            : '<span class="id">'+esc(ch?ch.id:'—')+'</span>';
    r+= inc ? '<span class="grow openable" data-brief="'+esc(inc.id)+'" title="Ver o resumo">'+esc(inc.title)+'</span>'
            : '<span class="grow">'+esc(ch?ch.id:'')+'</span>';
    if(inc)r+='<span class="tag '+(PRES[inc.presentation]||'')+'">'+esc(inc.presentation)+'</span>';
    if(ch&&ch.tasks&&ch.tasks.total>0)r+='<span class="tag">'+ch.tasks.completed+'/'+ch.tasks.total+'</span>';
    if(ch)r+=cmd(ch.next);
    return r+'</div>';
  }).join('') : empty('Nada em andamento.'), f.length||null);

  if(d.milestones&&d.milestones.length)
    out+=card('MILESTONES', d.milestones.map(mileRow).join(''), d.milestones.length);

  var n=d.recommended;
  if(n)out+=card('PRÓXIMO PASSO','<div class="row"><span class="id openable" data-brief="'+esc(n.id)+'" title="Ver o resumo">'+esc(n.id)+'</span>'
    +'<span class="grow openable" data-brief="'+esc(n.id)+'">'+esc(n.title)+'</span></div>'
    +(n.reasons||[]).map(function(r){return '<div class="sub2">↳ '+esc(r)+'</div>'}).join('')
    +group('no harness',n.harnessCommands)+group('no terminal',n.commands));

  var g=d.diagnostics||{errors:0,warnings:0};
  out+=card('DIAGNÓSTICOS',(g.errors||g.warnings)
    ? '<div class="grid">'+kpi(g.errors,'erros')+kpi(g.warnings,'avisos')+'</div>' : empty('Sem diagnósticos.'));
  return out;
}

/**
 * Um ponto de artefato que já existe vira porta de entrada para ele: proposal,
 * design e tasks abrem o documento no mesmo drawer do brief. O artefato "specs"
 * fica de fora porque é um padrão: vira N deltas, cada um nomeado em DOCUMENTOS.
 */
var DOTDOC={proposal:'proposal',design:'design',tasks:'tasks'};

function screenChanges(d){
  var all=d.changes||[];
  var out=findBar('CHANGES','changes','filtrar changes',
    all.filter(function(c){return matches('changes',c.id)}).length+' de '+all.length+' ativas');
  PHASES.forEach(function(p){
    var m=all.filter(function(c){return c.phase===p[0] && matches('changes',c.id)});
    if(!m.length)return;
    out+=card(p[1], m.map(function(c){
      var dots=(c.artifacts||[]).map(function(a){
        var kind=DOTDOC[a.id], open=kind&&a.state==='done';
        return '<span class="d-'+a.state+(open?' dp openable':'')+'"'
          +(open?' data-doc="change:'+esc(c.id)+':'+kind+'"':'')
          +' title="'+esc(a.id)+': '+esc(a.state)+(open?' — clique para ler':'')+'">'
          +(DOT[a.state]||'·')+'</span>';
      }).join('');
      var r='<div class="row"><span class="id">'+esc(c.id)+'</span>'
        +'<span class="dots">'+dots+'</span><span class="grow">';
      r+= c.tasks&&c.tasks.total>0 ? bar(c.tasks.completed,c.tasks.total,'cyan') : '<span class="muted sm">sem tarefas</span>';
      r+='</span>';
      if(c.tasks&&c.tasks.total>0)r+='<span class="tag">'+c.tasks.completed+'/'+c.tasks.total+'</span>';
      r+='</div>';
      if(c.error)r+='<div class="sub2" style="color:var(--red)">↳ '+esc(c.error)+'</div>';
      else if(c.blockedBy&&c.blockedBy.length)r+='<div class="sub2">↳ falta '+esc(c.blockedBy.join(', '))+'</div>';
      r+=openTasks(c);
      if(c.next)r+=group('no harness',[c.next]);
      return r;
    }).join(''), m.length);
  });
  if(!all.length)out+=card('ATIVAS',empty('Nenhuma change ativa.'));
  if(d.specs&&d.specs.length)
    out+=card('CAPACIDADES', d.specs.map(function(x){
      return '<div class="row">'
        +'<span class="dtitle openable" data-doc="capability:'+esc(x.capability)+'" title="Ler a spec">'
        +esc(x.capability)+'</span>'
        +'<span class="grow muted sm">comportamento atual</span>'
        +'<span class="tag">'+x.requirements+' req.</span></div>';
    }).join(''), d.specs.length);
  if(d.archive)out+=card('ARQUIVO','<div class="grid">'
    +kpi(d.archive.count,'changes arquivadas')+kpi(d.archive.last||'—','última data')+'</div>'
    +'<div style="margin:12px 0 0">'
    +'<button type="button" class="chip" data-goto="docs">ver os documentos das arquivadas →</button></div>');
  return out;
}

/** Milestone como linha navegável: clicar recorta o PLANO para os seus incrementos. */
function mileRow(m){
  var st=MSTAT[m.derivedStatus]||['t-dim',''];
  return '<div class="mile pick'+(MS===m.id?' on':'')+'" data-ms="'+esc(m.id)+'"'
    +' title="Ver os incrementos deste milestone" role="button" tabindex="0">'
    +'<span class="nm"><span class="id" style="display:inline-block">'+esc(m.id)+'</span> '+esc(m.name)+'</span>'
    +bar(m.archived,m.total)
    +'<span class="tag '+st[0]+'">'+esc(st[1])+'</span>'
    +'<span class="muted sm">'+m.archived+'/'+m.total+'</span></div>';
}

function screenPlano(d){
  if(!d.plan)return sec('PLANO',empty(d.message||'Nenhum plano neste projeto.'));
  var p=d.plan,g=d.progress||{};
  var out=sec('PLANO','<div class="row"><span class="id">'+esc(p.id)+'</span><span class="grow">'+esc(p.name)+'</span>'
    +'<span class="tag t-cyan">'+esc(p.derivedStatus||p.status)+'</span><span class="tag">revisão '+esc(p.revision)+'</span></div>'
    +'<div class="l muted sm" style="margin-top:10px">incrementos '+(g.archived||0)+'/'+(g.total||0)+' ('+(g.percent||0)+'%)</div>'
    +bar(g.archived||0,g.total||0));

  // O milestone escolhido é um recorte, não outra tela: as mesmas etapas, com
  // menos incrementos. Assim a relação plano → milestone → incremento fica visível
  // sem tirar o leitor do lugar.
  var mile=(d.milestones||[]).filter(function(m){return m.id===MS})[0];
  if(d.milestones&&d.milestones.length)
    out+=card('MILESTONES', d.milestones.map(mileRow).join(''), d.milestones.length);

  var visible=(d.changes||[]).filter(function(c){
    return (!MS || c.milestone===MS) && matches('plano',c.id+' '+c.title+' '+(c.slug||''));
  });
  // O grafo é uma segunda leitura do MESMO plano, não outra tela: abre por cima
  // e fecha, então quem só quer a lista nunca esbarra nele.
  out+=findBar('INCREMENTOS','plano','filtrar incrementos',
    visible.length+' de '+(d.changes||[]).length+(MS?' neste milestone':''),
    (MS?'<button type="button" class="chip" data-ms-clear="1">'+esc(MS)
      +(mile?' · '+esc(mile.name):'')+' ✕</button>':'')
    +'<button type="button" class="chip" id="gopen" title="Ver as dependências como grafo">'
    +'⌗ ver o grafo</button>');

  var placed={};
  STAGES.forEach(function(s){
    var m=visible.filter(function(c){return s[1].indexOf(c.presentation)>=0 && !placed[c.id]});
    if(!m.length)return;
    m.forEach(function(c){placed[c.id]=1});
    out+=card(s[0], m.map(function(c){
      var open=c.plannedChange?' openable" data-brief="'+esc(c.id)+'"':'"';
      var r='<div class="row"><span class="id'+open+' title="Ver o resumo">'+esc(c.id)+'</span>'
        +'<span class="grow'+open+'>'+esc(c.title)+'</span>'
        +'<span class="tag '+(PRES[c.presentation]||'')+'">'+esc(c.presentation)+'</span>';
      if(c.plannedChange)r+='<span class="tag">brief '+esc(c.plannedChange.state)+'</span>';
      if(c.link&&c.link.tasks)r+='<span class="tag">'+c.link.tasks.completed+'/'+c.link.tasks.total+'</span>';
      if(c.milestone&&!MS)r+='<span class="tag dp" data-ms="'+esc(c.milestone)+'" title="Filtrar por este milestone">'+esc(c.milestone)+'</span>';
      r+='</div>';
      if(c.blockedBy&&c.blockedBy.length)r+='<div class="sub2">↳ falta '+esc(c.blockedBy.join(', '))+'</div>';
      (c.manualBlockers||[]).forEach(function(b){r+='<div class="sub2" style="color:var(--yellow)">↳ blocker: '+esc(b)+'</div>'});
      // Quando o incremento virou change, os artefatos dela são o próximo passo
      // da leitura: proposta → design → tarefas, do lado direito do vínculo.
      if(c.link){
        r+='<div class="sub2">↳ vínculo: '+esc(c.link.name)+'</div>';
        r+=docChips(c.link);
      }
      if(c.unlocks&&c.unlocks.length&&c.execution!=='archived')r+='<div class="sub2">↳ desbloqueia '+esc(c.unlocks.join(', '))+'</div>';
      // O caminho para começar este incremento, dos dois lados.
      if(c.presentation==='pronta'&&!c.link){
        // Montado com o incremento e o slug: quem lê não precisa lembrar de nada.
        var arg=' '+c.id+' '+c.slug;
        r+=group('no harness',[HARNESS_VERB.explore+arg,HARNESS_VERB.propose+arg]);
        r+=group('no terminal',['specs new change '+c.slug,'specs project link '+c.id+' '+c.slug]);
      } else if(c.link&&c.execution!=='archived'){
        r+=group('no terminal',['specs status --change '+c.link.name]);
      }
      return r;
    }).join(''), m.length);
  });

  var dg=d.diagnostics||[];
  out+=card('DIAGNÓSTICOS', dg.length? dg.map(function(x){
    var cl=x.level==='ERROR'?'t-red':x.level==='WARNING'?'t-yellow':'t-cyan';
    return '<div class="row"><span class="tag '+cl+'">'+esc(x.code)+'</span><span class="grow">'+esc(x.message)+'</span></div>'
      +(x.fix?group('no terminal',[x.fix]):'');
  }).join('') : empty('Sem diagnósticos.'), dg.length||null);
  return out;
}

/**
 * O catálogo: o que existe, para que serve e onde mora.
 *
 * Agrupado como o projeto é organizado — projeto, capacidades, cada change, o
 * plano, os incrementos — porque a pergunta de quem chega não é "que arquivos
 * existem" e sim "o que eu leio para entender isto".
 */
function screenDocs(d){
  var all=d.documents||[];
  var hit=all.filter(function(x){
    return matches('docs',x.title+' '+x.group+' '+x.path+' '+x.purpose+' '+(KIND[x.kind]||x.kind));
  });
  var out=findBar('DOCUMENTOS','docs','filtrar documentos',
    hit.length+' de '+all.length+' documentos');
  if(!all.length)return out+card('CATÁLOGO',empty('Nenhum documento no projeto ainda.'));
  if(!hit.length)return out+card('CATÁLOGO',empty('Nenhum documento bate com o filtro.'));

  var order=[],by={};
  hit.forEach(function(x){ if(!by[x.group]){by[x.group]=[];order.push(x.group)} by[x.group].push(x) });
  order.forEach(function(g){
    out+=card(g, by[g].map(docRow).join(''), by[g].length);
  });
  return out;
}

function docRow(x){
  return '<div class="row"><span class="tag'+(x.archived?' t-dim':'')+'">'
    +esc(KIND[x.kind]||x.kind)+'</span>'
    +'<span class="dtitle openable" data-doc="'+esc(x.id)+'" title="Abrir">'+esc(x.title)+'</span>'
    +'<span class="grow muted sm">'+esc(x.purpose)+'</span>'
    +'<span class="dpath">'+esc(x.path)+'</span></div>';
}

/**
 * O que falta fazer nesta change, na própria linha dela.
 *
 * Só as abertas, porque é isso que responde "o que está em andamento": o que já
 * foi feito o contador ao lado da barra já diz. A lista é curta de propósito —
 * o resto se lê no tasks.md, a um clique de distância — para uma tela com vinte
 * changes continuar sendo uma tela e não um relatório.
 */
function openTasks(c){
  var t=c.tasks;
  if(!t||!t.total)return '';
  var open=t.open||[];
  if(!open.length)return '';
  var rest=(t.total-t.completed)-open.length;
  return '<div class="tks">'
    +open.map(function(x){
      var depth=x.number?x.number.split('.').length-1:0;
      return '<div class="tk"'+(depth?' style="padding-left:'+(depth*16)+'px"':'')+'>'
        +'<span class="bx">○</span><span class="no">'+esc(x.number)+'</span>'
        +'<span class="txt">'+esc(x.text)+'</span></div>';
    }).join('')
    +'<div class="more"><button type="button" class="dchip" data-doc="change:'+esc(c.id)+':tasks"'
    +' title="Abrir o checklist inteiro">'
    +(rest>0?'mais '+rest+' — ver as '+t.total+' tarefas':'ver as '+t.total+' tarefas')
    +'</button></div></div>';
}

/**
 * Os artefatos da change que realiza um incremento, ao lado do vínculo.
 * Só entram os que existem: o catálogo é a fonte, não um palpite sobre o disco.
 */
function docChips(link){
  var base=link.archivePath ? 'archived:'+String(link.archivePath).split('/').pop()
                            : 'change:'+link.name;
  var have=['proposal','design','tasks'].filter(function(k){return DOCSET[base+':'+k]});
  if(!have.length)return '';
  return '<div class="cgroup"><span class="clabel">documentos</span>'
    +have.map(function(k){
      return '<button type="button" class="dchip" data-doc="'+esc(base+':'+k)+'"'
        +' title="Abrir o documento">'+esc(KIND[k])+'</button>';
    }).join('')+'</div>';
}

var RENDER={resumo:screenResumo,changes:screenChanges,plano:screenPlano,docs:screenDocs};

/** Ids do catálogo já conhecidos, para não oferecer um documento que não existe. */
var DOCSET={};
function loadCatalogue(then){
  fetch('/api/docs').then(function(r){return r.json()}).then(function(d){
    cache.docs=d; DOCSET={};
    (d.documents||[]).forEach(function(x){DOCSET[x.id]=1});
    if(then)then();
  }).catch(function(){if(then)then()});
}

/* ---------- markdown ---------- */

/**
 * O suficiente para um brief: título, ênfase, código, lista, citação e regra.
 * Escapa tudo primeiro — o arquivo é do projeto, mas nada garante que só o
 * autor escreveu nele, e HTML cru vindo de arquivo é injeção esperando acontecer.
 */
function md(src){
  var text=String(src).replace(/\r\n?/g,'\n');
  var meta='';
  // O frontmatter é metadado, não prosa: sai da leitura e vira legenda.
  var fm=/^---\n([\s\S]*?)\n---\n?/.exec(text);
  if(fm){ meta=fm[1].split('\n').filter(Boolean).join('  ·  '); text=text.slice(fm[0].length) }

  var blocks=[], code=[];
  text=text.replace(/\u0060\u0060\u0060([a-z]*)\n([\s\S]*?)\u0060\u0060\u0060/g,function(_m,lang,body){
    code.push('<pre><code>'+esc(body.replace(/\n$/,''))+'</code></pre>');
    return '\u0000CODE'+(code.length-1)+'\u0000';
  });

  function inline(t){
    return esc(t)
      .replace(/\u0060([^\u0060]+)\u0060/g,'<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g,'$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,'<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>');
  }

  var lines=text.split('\n'), i=0, out=[];
  while(i<lines.length){
    var l=lines[i];
    if(/^\u0000CODE\d+\u0000$/.test(l.trim())){ out.push(l.trim()); i++; continue }
    if(/^\s*$/.test(l)){ i++; continue }
    if(/^#{1,6}\s/.test(l)){
      var lv=l.match(/^#+/)[0].length;
      out.push('<h'+Math.min(lv,3)+'>'+inline(l.replace(/^#+\s*/,''))+'</h'+Math.min(lv,3)+'>'); i++; continue;
    }
    if(/^\s*(---|\*\*\*|___)\s*$/.test(l)){ out.push('<hr>'); i++; continue }
    if(/^\s*>/.test(l)){
      var q=[]; while(i<lines.length&&/^\s*>/.test(lines[i])){q.push(lines[i].replace(/^\s*>\s?/,''));i++}
      out.push('<blockquote>'+inline(q.join(' '))+'</blockquote>'); continue;
    }
    if(/^\s*[-*+]\s/.test(l)||/^\s*\d+[.)]\s/.test(l)){
      var ord=/^\s*\d/.test(l), items=[];
      while(i<lines.length&&(/^\s*[-*+]\s/.test(lines[i])||/^\s*\d+[.)]\s/.test(lines[i]))){
        items.push('<li>'+inline(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/,''))+'</li>'); i++;
      }
      out.push((ord?'<ol>':'<ul>')+items.join('')+(ord?'</ol>':'</ul>')); continue;
    }
    var para=[]; while(i<lines.length&&!/^\s*$/.test(lines[i])&&!/^#{1,6}\s/.test(lines[i])
      &&!/^\s*[-*+]\s/.test(lines[i])&&!/^\s*\d+[.)]\s/.test(lines[i])&&!/^\s*>/.test(lines[i])
      &&!/^\u0000CODE/.test(lines[i].trim())){ para.push(lines[i]); i++ }
    if(para.length)out.push('<p>'+inline(para.join(' '))+'</p>');
  }
  var html=out.join('').replace(/\u0000CODE(\d+)\u0000/g,function(_m,n){return code[+n]});
  return (meta?'<div class="meta">'+esc(meta)+'</div>':'')+html;
}

/* ---------- drawer de leitura ---------- */

/**
 * tasks.md lido como checklist, não como prosa: progresso, agrupamento pelos
 * cabeçalhos que o arquivo já usa e recuo por numeração: 1.2 é subtarefa de 1.
 */
function tasksView(b){
  var t=b.tasks||{}, items=t.items||[];
  if(!items.length)return md(b.markdown);

  var h='<div class="meta">'+t.completed+' de '+t.total+' tarefas concluídas</div>'
    +bar(t.completed,t.total,'cyan');
  var order=[],by={};
  items.forEach(function(x){
    var g=x.group||'TAREFAS';
    if(!by[g]){by[g]=[];order.push(g)}
    by[g].push(x);
  });
  order.forEach(function(g){
    var list=by[g], done=list.filter(function(x){return x.done}).length;
    h+='<h2>'+esc(g)+'  <span class="muted">'+done+'/'+list.length+'</span></h2>';
    h+=list.map(function(x){
      var depth=x.number?x.number.split('.').length-1:0;
      return '<div class="tk'+(x.done?' ok':'')+'"'
        +(depth?' style="padding-left:'+(depth*20)+'px"':'')+'>'
        +'<span class="bx">'+(x.done?'●':'○')+'</span>'
        +'<span class="no">'+esc(x.number)+'</span>'
        +'<span class="txt">'+esc(x.text)+'</span></div>';
    }).join('');
  });
  return h+'<hr><div class="muted sm">Marcado no próprio tasks.md, pelo harness.</div>';
}

/** Documento do catálogo no mesmo drawer do brief: uma forma de ler, não duas. */
var DW=null;
function openDoc(id){
  var d=E('drawer');
  DW=id;
  E('dw-id').textContent=''; E('dw-title').textContent='';
  E('dw-body').innerHTML='<p class="muted">carregando...</p>';
  d.classList.add('on'); E('scrim').classList.add('on'); d.setAttribute('aria-hidden','false');
  E('dw-close').focus();
  fetch('/api/doc?id='+encodeURIComponent(id)).then(function(r){return r.json()}).then(function(b){
    if(DW!==id)return;
    if(!b.found){
      E('dw-body').innerHTML='<p class="muted">Este documento ainda não existe no projeto.</p>';
      return;
    }
    E('dw-id').textContent=KIND[b.kind]||b.kind;
    E('dw-title').textContent=b.title;
    E('dw-body').innerHTML=(b.tasks?tasksView(b):md(b.markdown))
      +'<div class="meta" style="margin-top:20px;border:0">'+esc(b.path)+'</div>';
  }).catch(function(){if(DW===id)E('dw-body').innerHTML='<p class="muted">Falha ao carregar.</p>'});
}

function closeDrawer(){
  E('drawer').classList.remove('on'); E('scrim').classList.remove('on');
  E('drawer').setAttribute('aria-hidden','true');
}
function openBrief(id){
  var d=E('drawer');
  DW=null;
  E('dw-id').textContent=id; E('dw-title').textContent='';
  E('dw-body').innerHTML='<p class="muted">carregando...</p>';
  d.classList.add('on'); E('scrim').classList.add('on'); d.setAttribute('aria-hidden','false');
  E('dw-close').focus();
  fetch('/api/brief?change='+encodeURIComponent(id)).then(function(r){return r.json()}).then(function(b){
    if(E('dw-id').textContent!==id)return;
    if(!b.found){
      var why={no_plan:'Este projeto não tem plano.',change_not_found:'Incremento não encontrado.',
               not_materialized:'Este incremento ainda não tem resumo. Rode /spec-project-generate.',
               missing_on_disk:'O arquivo do resumo não está no disco.'};
      E('dw-body').innerHTML='<p class="muted">'+esc(why[b.reason]||'Não consegui abrir.')+'</p>';
      return;
    }
    E('dw-title').textContent=b.title;
    E('dw-body').innerHTML=md(b.markdown)
      +'<div class="meta" style="margin-top:20px;border:0">'+esc(b.path)+'</div>';
  }).catch(function(){E('dw-body').innerHTML='<p class="muted">Falha ao carregar.</p>'});
}
E('dw-close').addEventListener('click',closeDrawer);
E('scrim').addEventListener('click',function(){
  if(E('gmodal').classList.contains('on'))closeGraph(); else closeDrawer();
});
addEventListener('click',function(e){
  var t=e.target.closest('[data-brief]'); if(!t)return;
  e.preventDefault(); openBrief(t.dataset.brief);
});
addEventListener('click',function(e){
  var t=e.target.closest('[data-doc]'); if(!t)return;
  e.preventDefault(); openDoc(t.dataset.doc);
});
/* O glifo mora dentro do <summary>: sem isto, ler a explicação fecharia o card. */
addEventListener('click',function(e){
  if(e.target.closest('.hint')){e.preventDefault(); e.stopPropagation()}
});

/* ---------- abas ---------- */

function drawTabs(){
  E('tabs').innerHTML=TABS.map(function(t,i){
    return '<button type="button" data-tab="'+t.id+'" aria-selected="'+(t.id===active)+'">'
      +'<span class="k">'+(i+1)+'</span>'+t.label+'</button>';
  }).join('');
}

/** Repinta a tela ativa com o que já está em cache: usado pelos filtros. */
function render(id){
  if(!cache[id])return;
  E('screen').innerHTML=RENDER[id](cache[id]); stamp(cache[id]);
}

function show(id,force){
  var tab=TABS.filter(function(t){return t.id===id})[0]; if(!tab)return;
  active=id; drawTabs();
  if(location.hash.slice(1)!==id)history.replaceState(null,'','#'+id);
  if(cache[id]&&!force){render(id);return}
  fetch(hq(tab.route)).then(function(r){return r.json()}).then(function(d){
    cache[id]=d;
    if(id==='docs'){DOCSET={};(d.documents||[]).forEach(function(x){DOCSET[x.id]=1})}
    if(active===id){E('screen').innerHTML=RENDER[id](d);stamp(d)}
  }).catch(function(){if(active===id)E('screen').innerHTML=sec(tab.label,empty('Falha ao carregar.'))});
}

/* O filtro é do leitor: repinta a tela e devolve o cursor onde ele estava. */
addEventListener('input',function(e){
  var el=e.target.closest?e.target.closest('[data-find]'):null; if(!el)return;
  var scope=el.dataset.find, at=el.selectionStart;
  if(Q[scope]===undefined)return;
  Q[scope]=el.value;
  render(active);
  var back=document.querySelector('[data-find="'+scope+'"]');
  if(back){back.focus(); try{back.setSelectionRange(at,at)}catch(err){}}
});

/* Projeto → milestone → incremento: um clique, sem sair da tela do plano. */
addEventListener('click',function(e){
  var clear=e.target.closest('[data-ms-clear]');
  if(clear){e.preventDefault(); MS=null; render('plano'); return}
  var pick=e.target.closest('[data-ms]');
  if(pick){
    e.preventDefault();
    MS=(MS===pick.dataset.ms)?null:pick.dataset.ms;
    if(active==='plano')render('plano'); else show('plano');
    return;
  }
  var go=e.target.closest('[data-goto]');
  if(go){e.preventDefault(); show(go.dataset.goto); return}
  if(e.target.closest('#gopen')){e.preventDefault(); openGraph()}
});
addEventListener('keydown',function(e){
  if(e.key!=='Enter'&&e.key!==' ')return;
  var pick=e.target.closest?e.target.closest('[data-ms]'):null; if(!pick)return;
  e.preventDefault();
  MS=(MS===pick.dataset.ms)?null:pick.dataset.ms;
  if(active==='plano')render('plano'); else show('plano');
});

function stamp(d){
  var v=d.overviewSchemaVersion||d.dashboardSchemaVersion;
  E('foot').textContent=(d.generatedAt?'atualizado '+new Date(d.generatedAt).toLocaleTimeString():'')
    +(v?'  ·  schema v'+v:'')+'  ·  1 2 3 4 ou Tab trocam de tela  ·  clique num comando para copiar, num incremento ou documento para ler';
}

/* Copiar é a ponte entre o painel e o harness: o comando sai daqui e é colado lá. */
var toastTimer;
function toast(t){
  var el=E('toast'); el.textContent=t; el.classList.add('on');
  clearTimeout(toastTimer); toastTimer=setTimeout(function(){el.classList.remove('on')},1600);
}
function copy(text,btn){
  var ok=function(){
    toast('copiado: '+text);
    if(!btn)return;
    btn.classList.add('done'); btn.innerHTML=esc(text)+ICO_OK;
    setTimeout(function(){btn.classList.remove('done'); btn.innerHTML=esc(text)+ICO_COPY},1400);
  };
  // A Clipboard API exige contexto seguro; localhost conta, mas um proxy pode
  // não contar — o textarea escondido cobre esse caso sem dependência.
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(text).then(ok,function(){fallback(text,ok)});
  } else fallback(text,ok);
}
function fallback(text,ok){
  var ta=document.createElement('textarea');
  ta.value=text; ta.setAttribute('readonly','');
  ta.style.cssText='position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta); ta.select();
  try{document.execCommand('copy'); ok()}catch(err){toast('não consegui copiar')}
  document.body.removeChild(ta);
}
addEventListener('click',function(e){
  var b=e.target.closest('.cp'); if(!b)return;
  e.preventDefault(); copy(b.dataset.copy,b);
});

E('tabs').addEventListener('click',function(e){
  var b=e.target.closest('button[data-tab]'); if(b)show(b.dataset.tab);
});

/* Mesmas teclas do terminal: 1/2/3 saltam, Tab e setas andam. */
addEventListener('keydown',function(e){
  if(e.key==='Escape'&&E('gmodal').classList.contains('on')){closeGraph();return}
  if(e.key==='Escape'&&E('drawer').classList.contains('on')){closeDrawer();return}
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  if(E('gmodal').classList.contains('on')||E('drawer').classList.contains('on'))return;
  var i=TABS.map(function(t){return t.id}).indexOf(active);
  if(/^[1-4]$/.test(e.key)&&TABS[+e.key-1]){e.preventDefault();show(TABS[+e.key-1].id)}
  else if(e.key==='Tab'||e.key==='ArrowRight'){e.preventDefault();show(TABS[(i+1)%TABS.length].id)}
  else if(e.key==='ArrowLeft'){e.preventDefault();show(TABS[(i+TABS.length-1)%TABS.length].id)}
  else if(e.key==='r'||e.key==='R'){e.preventDefault();show(active,true)}
});

/* ---------- tema ---------- */

function theme(v){
  document.documentElement.setAttribute('data-theme',v);
  E('theme').textContent=v==='light'?'escuro':'claro';
  try{localStorage.setItem('sw-theme',v)}catch(err){}
}
var saved='dark';
try{saved=localStorage.getItem('sw-theme')||'dark'}catch(err){}
theme(saved);
E('theme').addEventListener('click',function(){
  theme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light');
});

/* ---------- grafo de dependências ---------- */

/**
 * O plano desenhado como o DAG que ele é.
 *
 * Os dados já vêm em /api/plan (dependsOn, blockedBy, unlocks) junto com o estado
 * de cada incremento — e o core garante que o grafo é acíclico antes de gravar,
 * então aqui não há validação a refazer, só leitura. SVG à mão porque uma
 * biblioteca de grafo seria a primeira dependência de runtime do projeto.
 *
 * A camada de um nó é o caminho MAIS LONGO até ele. Com o mais curto, um
 * incremento apareceria antes de algo de que ele depende; com o mais longo,
 * toda aresta anda da esquerda para a direita e a coluna vira o que ela é de
 * fato: a ordem de execução, uma onda por vez.
 */
var GW=196, GH=52, GAPX=76, GAPY=20, PADX=34, PADY=44;

function graphLayers(changes){
  var by={}; changes.forEach(function(c){by[c.id]=c});
  var depth={}, busy={};
  function deep(id){
    if(depth[id]!=null)return depth[id];
    if(busy[id])return 0;            // o core recusa ciclo; isto é só um cinto
    busy[id]=1;
    var deps=(by[id].dependsOn||[]).filter(function(d){return by[d]});
    depth[id]=deps.length?1+Math.max.apply(null,deps.map(deep)):0;
    busy[id]=0;
    return depth[id];
  }
  changes.forEach(function(c){deep(c.id)});

  var cols=[];
  changes.forEach(function(c){
    var d=depth[c.id];
    (cols[d]=cols[d]||[]).push(c);
  });

  // Baricentro: cada nó desce para perto da média das suas dependências. Duas
  // passadas tiram a maior parte dos cruzamentos sem virar um solver.
  var row={};
  cols.forEach(function(col){col.forEach(function(c,i){row[c.id]=i})});
  for(var pass=0;pass<2;pass++){
    cols.forEach(function(col,d){
      if(!d)return;
      col.sort(function(a,b){return bary(a)-bary(b)});
      col.forEach(function(c,i){row[c.id]=i});
    });
  }
  function bary(c){
    var deps=(c.dependsOn||[]).filter(function(x){return by[x]});
    if(!deps.length)return row[c.id];
    var sum=deps.reduce(function(t,x){return t+row[x]},0);
    return sum/deps.length;
  }

  var nodes=[];
  cols.forEach(function(col,d){
    col.forEach(function(c,i){
      nodes.push({
        c: c,
        x: PADX + d*(GW+GAPX),
        y: PADY + i*(GH+GAPY),
        wave: d
      });
    });
  });
  return { nodes: nodes, cols: cols };
}

function graphSvg(changes){
  var laid=graphLayers(changes), nodes=laid.nodes;
  var at={}; nodes.forEach(function(n){at[n.c.id]=n});
  var width=PADX*2+laid.cols.length*(GW+GAPX)-GAPX;
  var tallest=laid.cols.reduce(function(m,col){return Math.max(m,col.length)},0);
  var height=PADY*2+tallest*(GH+GAPY)-GAPY;

  var edges='';
  nodes.forEach(function(n){
    (n.c.dependsOn||[]).forEach(function(dep){
      var from=at[dep]; if(!from)return;
      var x1=from.x+GW, y1=from.y+GH/2, x2=n.x, y2=n.y+GH/2, mid=(x1+x2)/2;
      // Uma aresta que ainda barra o destino é a informação mais útil do grafo.
      var blocking=(n.c.blockedBy||[]).indexOf(dep)>=0;
      edges+='<path class="gedge'+(blocking?' block':'')+'" data-from="'+esc(dep)+'"'
        +' data-to="'+esc(n.c.id)+'" d="M'+x1+' '+y1+'C'+mid+' '+y1+' '+mid+' '+y2+' '+x2+' '+y2+'"'
        +' marker-end="url(#gtip'+(blocking?'b':'')+')"/>';
    });
  });

  var waves=laid.cols.map(function(col,d){
    if(!col.length)return '';
    return '<text class="gwave" x="'+(PADX+d*(GW+GAPX))+'" y="24">'+(d+1)+'ª ONDA</text>';
  }).join('');

  var boxes=nodes.map(function(n){
    var c=n.c, tone=PRES[c.presentation]||'t-dim';
    var running=c.execution==='in_progress'||c.execution==='verifying';
    var cls='gn s-'+tone.replace('t-','')
      +(running?' run':'')+(c.execution==='archived'?' done':'');
    var title=clipText(c.title,26);
    var badge=(c.manualBlockers&&c.manualBlockers.length)?'<text class="warn" x="'+(n.x+GW-14)+'" y="'+(n.y+19)+'">!</text>':'';
    return '<g class="'+cls+'" data-node="'+esc(c.id)+'" tabindex="0" role="button">'
      +'<title>'+esc(c.id+' · '+c.title+' — '+c.presentation
        +((c.blockedBy&&c.blockedBy.length)?' (falta '+c.blockedBy.join(', ')+')':''))+'</title>'
      +'<rect x="'+n.x+'" y="'+n.y+'" width="'+GW+'" height="'+GH+'"/>'
      +'<text class="id" x="'+(n.x+13)+'" y="'+(n.y+20)+'">'+esc(c.id)+'</text>'
      +(c.milestone?'<text class="ms" x="'+(n.x+GW-13)+'" y="'+(n.y+20)+'" text-anchor="end">'+esc(c.milestone)+'</text>':'')
      +'<text class="ti" x="'+(n.x+13)+'" y="'+(n.y+38)+'">'+esc(title)+'</text>'
      +badge+'</g>';
  }).join('');

  var defs='<defs>'
    +'<marker id="gtip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7"'
    +' orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--line)"/></marker>'
    +'<marker id="gtipb" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7"'
    +' orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--yellow)"/></marker>'
    +'</defs>';

  return { svg: defs+waves+edges+boxes, width: width, height: height };
}

function clipText(text,max){
  var t=String(text||'');
  return t.length>max?t.slice(0,max-1)+'…':t;
}

/* ---------- o modal ---------- */

var GVIEW=null;
function setView(v){
  GVIEW=v;
  E('gsvg').setAttribute('viewBox',v.x+' '+v.y+' '+v.w+' '+v.h);
}

function openGraph(){
  var d=cache.plano;
  if(!d||!d.plan||!(d.changes||[]).length){toast('nenhum plano para desenhar');return}
  var drawn=graphSvg(d.changes);
  E('gsvg').innerHTML=drawn.svg;
  E('gsvg').setAttribute('preserveAspectRatio','xMidYMid meet');
  setView({x:0,y:0,w:drawn.width,h:drawn.height});
  GFIT={x:0,y:0,w:drawn.width,h:drawn.height};

  var blocked=d.changes.filter(function(c){return (c.blockedBy||[]).length}).length;
  E('ginfo').textContent=d.changes.length+' incrementos  ·  '
    +graphLayers(d.changes).cols.length+' ondas'
    +(blocked?'  ·  '+blocked+' bloqueado(s)':'');
  E('gfoot').innerHTML=[
    ['green','concluída'],['cyan','em implementação'],['green','pronta'],
    ['yellow','bloqueada'],['red','inconsistente'],['dim','fora do fluxo']
  ].map(function(l){
    return '<span class="lg"><i style="background:var(--'+l[0]+')"></i>'+esc(l[1])+'</span>';
  }).join('')
    +'<span class="lg"><i style="background:var(--yellow)"></i>seta tracejada = dependência que ainda barra</span>'
    +'<span class="lg">clique num nó para acender a linhagem  ·  duplo clique abre o resumo</span>';

  E('gmodal').classList.add('on'); E('scrim').classList.add('on');
  E('gclose').focus();
}

var GFIT=null;
function closeGraph(){
  E('gmodal').classList.remove('on');
  if(!E('drawer').classList.contains('on'))E('scrim').classList.remove('on');
}

/** Acende o nó, tudo de que ele depende e tudo que depende dele. */
function litLineage(id){
  var d=cache.plano||{}, by={};
  (d.changes||[]).forEach(function(c){by[c.id]=c});
  var keep={}, seen={};
  (function up(x){ if(!by[x]||seen['u'+x])return; seen['u'+x]=1; keep[x]=1;
    (by[x].dependsOn||[]).forEach(up); })(id);
  (function down(x){ if(!by[x]||seen['d'+x])return; seen['d'+x]=1; keep[x]=1;
    (by[x].unlocks||[]).forEach(down); })(id);

  [].forEach.call(document.querySelectorAll('#gsvg .gn'),function(g){
    var on=keep[g.dataset.node];
    g.classList.toggle('off',!on);
    g.classList.toggle('lit',g.dataset.node===id);
  });
  [].forEach.call(document.querySelectorAll('#gsvg .gedge'),function(e){
    var on=keep[e.dataset.from]&&keep[e.dataset.to];
    e.classList.toggle('lit',!!on);
    e.style.opacity=on?'1':'.18';
  });
}

function clearLineage(){
  [].forEach.call(document.querySelectorAll('#gsvg .gn'),function(g){
    g.classList.remove('off','lit');
  });
  [].forEach.call(document.querySelectorAll('#gsvg .gedge'),function(e){
    e.classList.remove('lit'); e.style.opacity='';
  });
}

E('gclose').addEventListener('click',closeGraph);
E('gfit').addEventListener('click',function(){if(GFIT)setView(GFIT); clearLineage()});

E('gsvg').addEventListener('click',function(e){
  var g=e.target.closest('.gn');
  if(!g){clearLineage();return}
  litLineage(g.dataset.node);
});
E('gsvg').addEventListener('dblclick',function(e){
  var g=e.target.closest('.gn'); if(!g)return;
  closeGraph(); openBrief(g.dataset.node);
});
E('gsvg').addEventListener('keydown',function(e){
  var g=e.target.closest?e.target.closest('.gn'):null; if(!g)return;
  if(e.key==='Enter'||e.key===' '){e.preventDefault(); litLineage(g.dataset.node)}
});

/* Roda dá zoom no ponteiro, arrastar move: um grafo maior que a tela precisa disso. */
E('gwrap').addEventListener('wheel',function(e){
  if(!GVIEW)return;
  e.preventDefault();
  var box=E('gsvg').getBoundingClientRect();
  var fx=(e.clientX-box.left)/box.width, fy=(e.clientY-box.top)/box.height;
  var k=e.deltaY>0?1.12:1/1.12;
  var w=Math.min(Math.max(GVIEW.w*k,240),GVIEW.w*40), h=GVIEW.h*(w/GVIEW.w);
  setView({x:GVIEW.x+(GVIEW.w-w)*fx, y:GVIEW.y+(GVIEW.h-h)*fy, w:w, h:h});
},{passive:false});

var GDRAG=null;
E('gwrap').addEventListener('pointerdown',function(e){
  if(!GVIEW)return;
  GDRAG={x:e.clientX,y:e.clientY,v:GVIEW};
  E('gwrap').classList.add('drag');
  E('gwrap').setPointerCapture(e.pointerId);
});
E('gwrap').addEventListener('pointermove',function(e){
  if(!GDRAG)return;
  var box=E('gsvg').getBoundingClientRect();
  setView({
    x:GDRAG.v.x-(e.clientX-GDRAG.x)*(GDRAG.v.w/box.width),
    y:GDRAG.v.y-(e.clientY-GDRAG.y)*(GDRAG.v.h/box.height),
    w:GDRAG.v.w, h:GDRAG.v.h
  });
});
['pointerup','pointercancel'].forEach(function(ev){
  E('gwrap').addEventListener(ev,function(){GDRAG=null;E('gwrap').classList.remove('drag')});
});

/* ---------- harness ---------- */

/**
 * O seletor, preenchido pelo que o servidor suporta.
 *
 * O rótulo ao lado diz de onde veio a escolha — detectado, configurado, padrão
 * ou escolhido aqui — porque "claude" sem procedência lê como fato observado, e
 * na maior parte das vezes é só o primeiro harness que o workspace configurou.
 */
function drawHarness(d){
  var list=d.harnesses||[]; if(!list.length)return;
  var sel=E('harness');
  if(sel.options.length!==list.length){
    sel.innerHTML=list.map(function(id){
      return '<option value="'+esc(id)+'">'+esc(id)+'</option>';
    }).join('');
  }
  sel.value=d.harness;
  E('hsrc').textContent=HSOURCE[d.harnessSource]||'';
  E('hsel').hidden=false;
}

E('harness').addEventListener('change',function(){
  HARNESS=this.value;
  try{localStorage.setItem('sw-harness',HARNESS)}catch(err){}
  // Todo comando na tela foi montado pelo servidor: nada é reescrito aqui,
  // as projeções são refeitas com o harness pedido.
  cache={}; DOCSET={};
  reconnect();
  loadCatalogue(function(){ show(active,true) });
  toast('comandos escritos para ' + HARNESS);
});

/* ---------- ao vivo ---------- */

function setLive(on,t){E('dot').className=on?'on':'';E('livetext').textContent=t}

var es;
function reconnect(){
  if(es)es.close();
  es=new EventSource(hq('/api/events'));
  es.onopen=function(){setLive(true,'ao vivo')};
  es.onerror=function(){setLive(false,'reconectando')};
  es.addEventListener('overview',onOverview);
}

function onOverview(ev){
  var d=JSON.parse(ev.data);
  cache.resumo=d;
  E('proj').textContent=d.projectName+'  ·  '+d.schema;
  drawHarness(d);
  document.title='Specwright — '+d.projectName;
  // A sintaxe muda por harness ($spec-* no Codex): tiramos o verbo do que veio.
  (d.recommended&&d.recommended.harnessCommands||[]).forEach(function(c){
    var verb=c.split(' ')[0];
    if(/explore$/.test(verb))HARNESS_VERB.explore=verb;
    if(/propose$/.test(verb))HARNESS_VERB.propose=verb;
  });
  // O stream só carrega o RESUMO; as outras telas recarregam sob demanda.
  delete cache.changes; delete cache.plano; delete cache.docs;
  // O catálogo muda quando um artefato nasce, e os chips do PLANO dependem dele:
  // recarrega primeiro, repinta depois, para a tela não mostrar um catálogo velho.
  loadCatalogue(function(){ show(active, active!=='resumo'&&active!=='docs') });
}

reconnect();

/* Voltar e avançar do navegador acompanham a aba, já que ela vive no hash. */
addEventListener('hashchange',function(){
  var id=location.hash.slice(1);
  if(id&&id!==active&&TABS.map(function(t){return t.id}).indexOf(id)>=0)show(id);
});

show(TABS.map(function(t){return t.id}).indexOf(location.hash.slice(1))>=0?location.hash.slice(1):'resumo');
// A primeira pintura não espera o catálogo; quem depende dele se repinta ao chegar.
loadCatalogue(function(){ if(active==='plano')render('plano') });
</script>
</body>
</html>
`;
