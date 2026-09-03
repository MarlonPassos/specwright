/**
 * The panel, as one self-contained page.
 *
 * Embedded in a module instead of shipped as an asset for two reasons: `tsc`
 * compiles `src/**\/*.ts` and copies nothing else, so an `.html` file would need
 * a build step and an entry in `package.json` `files`; and a page that cannot be
 * missing at runtime is one less failure mode. No framework, no bundler, no
 * network fetch — NFR-11 holds.
 *
 * Three tabs, the same the terminal panel has, reachable by click, by `1`/`2`/`3`
 * and by Tab — the habit carries over. The tab lives in the hash, so a reload
 * keeps the reader where they were. Dark is the default and mirrors the terminal
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
  --cyan:#38d6e8; --green:#4ade80; --yellow:#fbbf24; --red:#f87171; --violet:#c4b5fd;
}
:root[data-theme=light]{
  --bg:#f4f7f8; --panel:#ffffff; --sunken:#e6edef; --line:#d3dfe3;
  --ink:#12262d; --dim:#5c7a84;
  --cyan:#0d8fa3; --green:#15803d; --yellow:#a16207; --red:#b91c1c; --violet:#6d5bb8;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding:16px 22px 0}
h1{margin:0;font-size:19px;letter-spacing:.22em;color:var(--cyan);font-weight:700}
.sub{color:var(--dim);font-size:13px}
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
main{padding:20px 22px;display:grid;gap:16px;max-width:1180px;margin:0 auto}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:15px 18px}
h2{margin:0 0 12px;font-size:11px;letter-spacing:.19em;color:var(--dim);font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px}
.kpi .n{font-size:25px;font-weight:700}
.kpi .l{color:var(--dim);font-size:12px}
.bar{height:8px;background:var(--sunken);border-radius:4px;overflow:hidden;margin:8px 0 4px}
.bar>i{display:block;height:100%;background:var(--green);transition:width .4s}
.row{display:flex;gap:11px;align-items:baseline;padding:8px 0;border-top:1px solid var(--line)}
.row:first-child{border-top:0}
.id{color:var(--cyan);font-weight:700;min-width:78px}
.tag{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--dim);white-space:nowrap}
.t-green{color:var(--green);border-color:var(--green)}
.t-cyan{color:var(--cyan);border-color:var(--cyan)}
.t-yellow{color:var(--yellow);border-color:var(--yellow)}
.t-red{color:var(--red);border-color:var(--red)}
.t-dim{opacity:.6}
.grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmd{color:var(--cyan);font-size:12px}
.cp{display:inline-flex;align-items:center;gap:7px;background:var(--sunken);
  border:1px solid var(--line);border-radius:6px;color:var(--cyan);cursor:pointer;
  font:inherit;font-size:12px;padding:3px 9px;transition:border-color .15s,color .15s}
.cp:hover{border-color:var(--cyan)}
.cp svg{width:13px;height:13px;flex:none;opacity:.5;transition:opacity .15s}
.cp:hover svg{opacity:1}
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
.sub2{color:var(--dim);font-size:12px;padding:2px 0 2px 89px}
.dots{letter-spacing:3px;min-width:78px}
.d-done{color:var(--green)} .d-ready{color:var(--cyan)} .d-blocked{opacity:.35} .d-skipped{opacity:.3}
.mile{display:flex;gap:12px;align-items:center;padding:6px 0}
.mile .nm{min-width:190px}
.mile .bar{flex:1;margin:0}
footer{padding:12px 22px 24px;color:var(--dim);font-size:12px;text-align:center}
@media(max-width:640px){.id,.dots{min-width:0}.mile .nm{min-width:0}.sub2{padding-left:0}}
</style>
</head>
<body>
<header>
  <h1>SPECWRIGHT</h1>
  <span class="sub" id="proj">carregando...</span>
  <span class="right">
    <span id="live"><span id="dot"></span><span id="livetext">conectando</span></span>
    <button id="theme" type="button" title="Alternar tema">tema</button>
  </span>
</header>
<nav id="tabs"></nav>
<main id="screen"></main>
<footer id="foot"></footer>
<div id="toast" role="status" aria-live="polite"></div>
<script>
var E=function(i){return document.getElementById(i)};
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML}
function bar(done,total,color){
  var p=total>0?Math.round(done/total*100):0;
  return '<div class="bar"><i style="width:'+p+'%;background:var(--'+(color||'green')+')"></i></div>';
}
function kpi(n,l){return '<div class="kpi"><div class="n">'+esc(n)+'</div><div class="l">'+esc(l)+'</div></div>'}
function sec(t,b){return '<section><h2>'+esc(t)+'</h2>'+b+'</section>'}
function empty(t){return '<div class="empty">'+esc(t)+'</div>'}

var ICO_COPY='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  +' stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/>'
  +'<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var ICO_OK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"'
  +' stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

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

var TABS=[{id:'resumo',label:'RESUMO',route:'/api/overview'},
          {id:'changes',label:'CHANGES',route:'/api/changes'},
          {id:'plano',label:'PLANO',route:'/api/plan'}];
var cache={}, active='resumo', latest=null;

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
  out+=sec('EM ANDAMENTO', f.length? f.map(function(x){
    var ch=x.change,inc=x.increment,r='<div class="row">';
    r+='<span class="id">'+esc(inc?inc.id:(ch?ch.id:'—'))+'</span>';
    r+='<span class="grow">'+esc(inc?inc.title:(ch?ch.id:''))+'</span>';
    if(inc)r+='<span class="tag '+(PRES[inc.presentation]||'')+'">'+esc(inc.presentation)+'</span>';
    if(ch&&ch.tasks&&ch.tasks.total>0)r+='<span class="tag">'+ch.tasks.completed+'/'+ch.tasks.total+'</span>';
    if(ch)r+=cmd(ch.next);
    return r+'</div>';
  }).join('') : empty('Nada em andamento.'));

  if(d.milestones&&d.milestones.length)
    out+=sec('MILESTONES', d.milestones.map(function(x){
      return '<div class="mile"><span class="nm">'+esc(x.id)+' '+esc(x.name)+'</span>'
        +bar(x.archived,x.total)+'<span class="muted sm">'+x.archived+'/'+x.total+'</span></div>';
    }).join(''));

  var n=d.recommended;
  if(n)out+=sec('PRÓXIMO PASSO','<div class="row"><span class="id">'+esc(n.id)+'</span><span class="grow">'+esc(n.title)+'</span></div>'
    +(n.reasons||[]).map(function(r){return '<div class="sub2">↳ '+esc(r)+'</div>'}).join('')
    +(n.commands||[]).map(function(x){return '<div class="sub2">↳ '+cmd(x)+'</div>'}).join(''));

  var g=d.diagnostics||{errors:0,warnings:0};
  out+=sec('DIAGNÓSTICOS',(g.errors||g.warnings)
    ? '<div class="grid">'+kpi(g.errors,'erros')+kpi(g.warnings,'avisos')+'</div>' : empty('Sem diagnósticos.'));
  return out;
}

function screenChanges(d){
  var out='',any=false;
  PHASES.forEach(function(p){
    var m=(d.changes||[]).filter(function(c){return c.phase===p[0]});
    if(!m.length)return; any=true;
    out+=sec(p[1], m.map(function(c){
      var dots=(c.artifacts||[]).map(function(a){
        return '<span class="d-'+a.state+'" title="'+esc(a.id)+': '+esc(a.state)+'">'+(DOT[a.state]||'·')+'</span>';
      }).join('');
      var r='<div class="row"><span class="id">'+esc(c.id)+'</span>'
        +'<span class="dots">'+dots+'</span><span class="grow">';
      r+= c.tasks&&c.tasks.total>0 ? bar(c.tasks.completed,c.tasks.total,'cyan') : '<span class="muted sm">sem tarefas</span>';
      r+='</span>';
      if(c.tasks&&c.tasks.total>0)r+='<span class="tag">'+c.tasks.completed+'/'+c.tasks.total+'</span>';
      r+='</div>';
      if(c.error)r+='<div class="sub2" style="color:var(--red)">↳ '+esc(c.error)+'</div>';
      else if(c.blockedBy&&c.blockedBy.length)r+='<div class="sub2">↳ falta '+esc(c.blockedBy.join(', '))+'</div>';
      if(c.next)r+='<div class="sub2">↳ '+cmd(c.next)+'</div>';
      return r;
    }).join(''));
  });
  if(!any)out=sec('CHANGES',empty('Nenhuma change ativa.'));
  if(d.specs&&d.specs.length)
    out+=sec('CAPACIDADES', d.specs.map(function(s){
      return '<div class="row"><span class="grow">'+esc(s.capability)+'</span><span class="tag">'+s.requirements+' req.</span></div>';
    }).join(''));
  if(d.archive)out+=sec('ARQUIVO','<div class="grid">'+kpi(d.archive.count,'changes arquivadas')+kpi(d.archive.last||'—','última data')+'</div>');
  return out;
}

function screenPlano(d){
  if(!d.plan)return sec('PLANO',empty(d.message||'Nenhum plano neste projeto.'));
  var p=d.plan,g=d.progress||{};
  var out=sec('PLANO','<div class="row"><span class="id">'+esc(p.id)+'</span><span class="grow">'+esc(p.name)+'</span>'
    +'<span class="tag t-cyan">'+esc(p.derivedStatus||p.status)+'</span><span class="tag">revisão '+esc(p.revision)+'</span></div>'
    +'<div class="l muted sm" style="margin-top:10px">incrementos '+(g.archived||0)+'/'+(g.total||0)+' ('+(g.percent||0)+'%)</div>'
    +bar(g.archived||0,g.total||0));

  var placed={};
  STAGES.forEach(function(s){
    var m=(d.changes||[]).filter(function(c){return s[1].indexOf(c.presentation)>=0 && !placed[c.id]});
    if(!m.length)return;
    m.forEach(function(c){placed[c.id]=1});
    out+=sec(s[0], m.map(function(c){
      var r='<div class="row"><span class="id">'+esc(c.id)+'</span><span class="grow">'+esc(c.title)+'</span>'
        +'<span class="tag '+(PRES[c.presentation]||'')+'">'+esc(c.presentation)+'</span>';
      if(c.plannedChange)r+='<span class="tag">brief '+esc(c.plannedChange.state)+'</span>';
      if(c.link&&c.link.tasks)r+='<span class="tag">'+c.link.tasks.completed+'/'+c.link.tasks.total+'</span>';
      r+='</div>';
      if(c.blockedBy&&c.blockedBy.length)r+='<div class="sub2">↳ falta '+esc(c.blockedBy.join(', '))+'</div>';
      (c.manualBlockers||[]).forEach(function(b){r+='<div class="sub2" style="color:var(--yellow)">↳ blocker: '+esc(b)+'</div>'});
      if(c.link)r+='<div class="sub2">↳ vínculo: '+esc(c.link.name)+'</div>';
      if(c.unlocks&&c.unlocks.length&&c.execution!=='archived')r+='<div class="sub2">↳ desbloqueia '+esc(c.unlocks.join(', '))+'</div>';
      return r;
    }).join(''));
  });

  var dg=d.diagnostics||[];
  out+=sec('DIAGNÓSTICOS', dg.length? dg.map(function(x){
    var cl=x.level==='ERROR'?'t-red':x.level==='WARNING'?'t-yellow':'t-cyan';
    return '<div class="row"><span class="tag '+cl+'">'+esc(x.code)+'</span><span class="grow">'+esc(x.message)+'</span></div>'
      +(x.fix?'<div class="sub2">↳ '+cmd(x.fix)+'</div>':'');
  }).join('') : empty('Sem diagnósticos.'));
  return out;
}

var RENDER={resumo:screenResumo,changes:screenChanges,plano:screenPlano};

/* ---------- abas ---------- */

function drawTabs(){
  E('tabs').innerHTML=TABS.map(function(t,i){
    return '<button type="button" data-tab="'+t.id+'" aria-selected="'+(t.id===active)+'">'
      +'<span class="k">'+(i+1)+'</span>'+t.label+'</button>';
  }).join('');
}

function show(id,force){
  var tab=TABS.filter(function(t){return t.id===id})[0]; if(!tab)return;
  active=id; drawTabs();
  if(location.hash.slice(1)!==id)history.replaceState(null,'','#'+id);
  if(cache[id]&&!force){E('screen').innerHTML=RENDER[id](cache[id]);stamp(cache[id]);return}
  fetch(tab.route).then(function(r){return r.json()}).then(function(d){
    cache[id]=d;
    if(active===id){E('screen').innerHTML=RENDER[id](d);stamp(d)}
  }).catch(function(){if(active===id)E('screen').innerHTML=sec(tab.label,empty('Falha ao carregar.'))});
}

function stamp(d){
  var v=d.overviewSchemaVersion||d.dashboardSchemaVersion;
  E('foot').textContent=(d.generatedAt?'atualizado '+new Date(d.generatedAt).toLocaleTimeString():'')
    +(v?'  ·  schema v'+v:'')+'  ·  1 2 3 ou Tab trocam de tela  ·  clique num comando para copiar';
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
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  var i=TABS.map(function(t){return t.id}).indexOf(active);
  if(/^[1-3]$/.test(e.key)){e.preventDefault();show(TABS[+e.key-1].id)}
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

/* ---------- ao vivo ---------- */

function setLive(on,t){E('dot').className=on?'on':'';E('livetext').textContent=t}

var es=new EventSource('/api/events');
es.onopen=function(){setLive(true,'ao vivo')};
es.onerror=function(){setLive(false,'reconectando')};
es.addEventListener('overview',function(ev){
  var d=JSON.parse(ev.data);
  cache.resumo=d;
  E('proj').textContent=d.projectName+'  ·  '+d.schema+'  ·  '+d.harness;
  document.title='Specwright — '+d.projectName;
  // O stream só carrega o RESUMO; as outras telas recarregam sob demanda.
  delete cache.changes; delete cache.plano;
  show(active,active!=='resumo');
});

show(['resumo','changes','plano'].indexOf(location.hash.slice(1))>=0?location.hash.slice(1):'resumo');
</script>
</body>
</html>
`;
