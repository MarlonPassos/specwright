/**
 * The panel, as one self-contained page.
 *
 * Embedded in a module instead of shipped as an asset for two reasons: `tsc`
 * compiles `src/**\/*.ts` and copies nothing else, so an `.html` file would need
 * a build step and an entry in `package.json` `files`; and a page that cannot be
 * missing at runtime is one less failure mode. No framework, no bundler, no
 * network fetch — NFR-11 holds.
 */
export const INDEX_HTML = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Specwright</title>
<style>
:root{
  --bg:#0e1a1f; --panel:#132329; --line:#1e3640; --ink:#dbeef2; --dim:#7fa3ad;
  --cyan:#38d6e8; --green:#4ade80; --yellow:#fbbf24; --red:#f87171; --violet:#c4b5fd;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;
  padding:18px 22px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:20px;letter-spacing:.22em;color:var(--cyan);font-weight:700}
.sub{color:var(--dim)}
#live{margin-left:auto;font-size:12px;color:var(--dim);display:flex;align-items:center;gap:7px}
#dot{width:8px;height:8px;border-radius:50%;background:var(--dim);transition:background .3s}
#dot.on{background:var(--green);box-shadow:0 0 8px var(--green)}
main{padding:22px;display:grid;gap:18px;max-width:1180px;margin:0 auto}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
h2{margin:0 0 14px;font-size:11px;letter-spacing:.19em;color:var(--dim);font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}
.kpi .n{font-size:26px;font-weight:700}
.kpi .l{color:var(--dim);font-size:12px}
.bar{height:8px;background:#0a1418;border-radius:4px;overflow:hidden;margin:9px 0 5px}
.bar>i{display:block;height:100%;background:var(--green);transition:width .4s}
.row{display:flex;gap:12px;align-items:baseline;padding:9px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0}
.id{color:var(--cyan);font-weight:700;min-width:74px}
.tag{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--dim);white-space:nowrap}
.t-green{color:var(--green);border-color:var(--green)}
.t-cyan{color:var(--cyan);border-color:var(--cyan)}
.t-yellow{color:var(--yellow);border-color:var(--yellow)}
.t-red{color:var(--red);border-color:var(--red)}
.grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmd{color:var(--cyan);font-size:12px}
.muted{color:var(--dim)}
.empty{color:var(--dim);padding:6px 0}
.mile{display:flex;gap:12px;align-items:center;padding:7px 0}
.mile .nm{min-width:190px}
.mile .bar{flex:1;margin:0}
.diag{padding:7px 0;border-top:1px solid var(--line);font-size:13px}
.diag:first-of-type{border-top:0}
footer{padding:14px 22px;color:var(--dim);font-size:12px;text-align:center}
@media(max-width:640px){.id{min-width:0}.mile .nm{min-width:0}}
</style>
</head>
<body>
<header>
  <h1>SPECWRIGHT</h1>
  <span class="sub" id="proj">carregando...</span>
  <span id="live"><span id="dot"></span><span id="livetext">conectando</span></span>
</header>
<main>
  <section><h2>RESUMO</h2><div id="resumo"></div></section>
  <section><h2>EM ANDAMENTO</h2><div id="foco"></div></section>
  <section id="s-plano" hidden><h2>PLANO</h2><div id="plano"></div></section>
  <section id="s-mile" hidden><h2>MILESTONES</h2><div id="mile"></div></section>
  <section id="s-next" hidden><h2>PRÓXIMO PASSO</h2><div id="next"></div></section>
  <section><h2>DIAGNÓSTICOS</h2><div id="diag"></div></section>
</main>
<footer id="foot"></footer>
<script>
var E=function(id){return document.getElementById(id)};
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML}
function bar(done,total,color){
  var pct=total>0?Math.round(done/total*100):0;
  return '<div class="bar"><i style="width:'+pct+'%;background:var(--'+(color||'green')+')"></i></div>';
}
function kpi(n,l){return '<div class="kpi"><div class="n">'+esc(n)+'</div><div class="l">'+esc(l)+'</div></div>'}

var TAG={'concluída':'t-green','pronta':'t-green','em implementação':'t-cyan','proposta':'t-cyan',
         'bloqueada':'t-yellow','inconsistente':'t-red'};

function render(d){
  E('proj').textContent=d.projectName+'  ·  '+d.schema+'  ·  '+d.harness;
  document.title='Specwright — '+d.projectName;

  var c=d.changes, i=d.increments, h='';
  h+='<div class="grid">';
  h+=kpi(c.active,'changes ativas');
  h+=kpi(c.readyToArchive,'prontas p/ arquivar');
  h+=kpi(c.archived,'arquivadas');
  h+=kpi(c.capabilities+' / '+c.requirements,'capacidades / requisitos');
  h+='</div>';
  if(c.tasks && c.tasks.total>0){
    h+='<div style="margin-top:15px"><div class="l muted">tarefas '+c.tasks.completed+'/'+c.tasks.total+'</div>'
      +bar(c.tasks.completed,c.tasks.total,'cyan')+'</div>';
  }
  if(i){
    h+='<div style="margin-top:15px"><div class="l muted">incrementos '+i.archived+'/'+i.total+' ('+i.percent+'%)</div>'
      +bar(i.archived,i.total)
      +'<div class="l muted">pronta '+i.ready+' · bloqueada '+i.blocked+' · em impl. '+i.inProgress+'</div></div>';
  }
  E('resumo').innerHTML=h;

  var f=d.focus||[];
  E('foco').innerHTML = f.length? f.map(function(x){
    var ch=x.change, inc=x.increment, r='<div class="row">';
    r+='<span class="id">'+esc(inc?inc.id:(ch?ch.id:'—'))+'</span>';
    r+='<span class="grow">'+esc(inc?inc.title:(ch?ch.id:''))+'</span>';
    if(inc)r+='<span class="tag '+(TAG[inc.presentation]||'')+'">'+esc(inc.presentation)+'</span>';
    if(ch&&ch.tasks&&ch.tasks.total>0)r+='<span class="tag">'+ch.tasks.completed+'/'+ch.tasks.total+'</span>';
    if(ch)r+='<span class="cmd">'+esc(ch.next)+'</span>';
    return r+'</div>';
  }).join('') : '<div class="empty">Nada em andamento.</div>';

  var p=d.plan;
  if(p){
    E('s-plano').hidden=false;
    E('plano').innerHTML='<div class="row"><span class="id">'+esc(p.id)+'</span>'
      +'<span class="grow">'+esc(p.name)+'</span>'
      +'<span class="tag t-cyan">'+esc(p.derivedStatus)+'</span>'
      +'<span class="tag">revisão '+esc(p.revision)+'</span></div>';
  } else E('s-plano').hidden=true;

  var m=d.milestones||[];
  E('s-mile').hidden=!m.length;
  E('mile').innerHTML=m.map(function(x){
    return '<div class="mile"><span class="nm">'+esc(x.id)+' '+esc(x.name)+'</span>'
      +bar(x.archived,x.total)
      +'<span class="muted">'+x.archived+'/'+x.total+'</span></div>';
  }).join('');

  var n=d.recommended;
  E('s-next').hidden=!n;
  if(n){
    E('next').innerHTML='<div class="row"><span class="id">'+esc(n.id)+'</span>'
      +'<span class="grow">'+esc(n.title)+'</span></div>'
      +(n.reasons||[]).map(function(r){return '<div class="diag muted">↳ '+esc(r)+'</div>'}).join('')
      +(n.commands||[]).map(function(x){return '<div class="diag cmd">↳ '+esc(x)+'</div>'}).join('');
  }

  var g=d.diagnostics||{errors:0,warnings:0};
  E('diag').innerHTML = (g.errors||g.warnings)
    ? '<div class="grid">'+kpi(g.errors,'erros')+kpi(g.warnings,'avisos')+'</div>'
    : '<div class="empty">Sem diagnósticos.</div>';

  E('foot').textContent='atualizado '+new Date(d.generatedAt).toLocaleTimeString()
    +'  ·  schema v'+d.overviewSchemaVersion;
}

function setLive(on,txt){E('dot').className=on?'on':'';E('livetext').textContent=txt}

fetch('/api/overview').then(function(r){return r.json()}).then(render)
  .catch(function(){E('proj').textContent='falha ao carregar'});

var es=new EventSource('/api/events');
es.onopen=function(){setLive(true,'ao vivo')};
es.onerror=function(){setLive(false,'reconectando')};
es.addEventListener('overview',function(ev){render(JSON.parse(ev.data))});
</script>
</body>
</html>
`;
