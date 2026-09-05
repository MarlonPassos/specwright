/**
 * The browser-side dependency graph, embedded in the self-contained dashboard.
 *
 * It lives apart from `ui.ts` only because it is the one screen with its own
 * interaction model — viewport, expansion state, selection — and inlining that
 * next to the page's render functions buried both. The script is concatenated
 * into the same `<script>` as the rest of the page, so it shares `E`, `esc`,
 * `bar`, `cache`, `hq`, `render`, `active`, `PRES` and `openBrief`.
 */
export const GRAPH_SCRIPT = String.raw`
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
 *
 * O padrão é RELAÇÕES, não o plano inteiro: trinta incrementos enquadrados na
 * largura da tela viram caixas ilegíveis. Começa numa change e cada nó abre o
 * próximo nível — quem quiser o mapa completo pede por ele.
 */
var GW=236, GH=88, GAPX=64, GAPY=28, PADX=32, PADY=48;
var GDATA=null, GROOT=null, GSELECT=null, GMODE='focus', GDIR='both';
var GEXPANDED=new Set(), GVIEW=null, GFIT=null, GLAID=null, GDRAG=null;
var GRETURN=null, GSUPPRESS=false, GPLAN=null, GSCALE=1, PLAN_EPOCH=0, PLAN_REQUEST=null;

/**
 * Um pedido de plano compartilhado pela tela e pelo grafo.
 *
 * O stream avisa que o disco mudou, mas quem está com o grafo aberto não recarrega
 * a tela — sem isto, o modal continuaria desenhando o plano de antes. A época
 * corta a resposta velha: um evento novo invalida o pedido em voo, e a resposta
 * atrasada nunca sobrescreve a atual.
 */
function loadPlan(){
  if(PLAN_REQUEST&&PLAN_REQUEST.epoch===PLAN_EPOCH)return PLAN_REQUEST.promise;
  var entry={epoch:PLAN_EPOCH,promise:null};
  entry.promise=fetch(hq('/api/plan')).then(function(r){
    if(!r.ok)throw new Error('Falha ao carregar o plano');
    return r.json();
  }).then(function(d){
    if(entry.epoch!==PLAN_EPOCH)return loadPlan();
    if(d.error)throw new Error(d.error.message||'Plano indisponível');
    cache.plano=d;
    if(active==='plano')render('plano');
    if(E('gmodal').classList.contains('on'))updateGraph(d);
    return d;
  }).finally(function(){if(PLAN_REQUEST===entry)PLAN_REQUEST=null});
  PLAN_REQUEST=entry;
  return entry.promise;
}

/** Chamado pelo stream: só custa uma requisição quando o grafo está na frente. */
function refreshOpenGraph(){
  if(!E('gmodal').classList.contains('on'))return;
  E('gupdated').textContent='atualizando…';
  loadPlan().catch(function(){
    E('gupdated').textContent='falha ao atualizar · tente de novo';
  });
}

function graphIndex(changes){
  var by=new Map(), next=new Map();
  changes.forEach(function(c){by.set(c.id,c);next.set(c.id,[])});
  changes.forEach(function(c){(c.dependsOn||[]).forEach(function(id){
    if(next.has(id))next.get(id).push(c.id);
  })});
  return {by:by,next:next};
}

/** Os vizinhos de um nó no sentido que o leitor escolheu ver. */
function graphNeighbors(id,index){
  var c=index.by.get(id); if(!c)return [];
  var upstream=GDIR==='next'?[]:(c.dependsOn||[]);
  var downstream=GDIR==='deps'?[]:(index.next.get(id)||[]);
  return Array.from(new Set(upstream.concat(downstream))).filter(function(x){return index.by.has(x)});
}

/**
 * O que está visível: a raiz e tudo alcançável por nós expandidos.
 *
 * Um ramo recolhido para a travessia, mas um nó alcançado por OUTRO ramo aberto
 * continua na tela — isto é um DAG, não uma árvore, e esconder o encontro de dois
 * caminhos esconderia justamente a dependência compartilhada.
 */
function graphVisible(changes){
  if(GMODE==='all')return changes;
  var index=graphIndex(changes), seen=new Set(), queue=[GROOT];
  while(queue.length){
    var id=queue.shift(); if(seen.has(id)||!index.by.has(id))continue;
    seen.add(id);
    if(GEXPANDED.has(id))graphNeighbors(id,index).forEach(function(x){if(!seen.has(x))queue.push(x)});
  }
  return changes.filter(function(c){return seen.has(c.id)});
}

function graphLayers(changes){
  var by={}; changes.forEach(function(c){by[c.id]=c});
  var depth={}, busy={};
  function deep(id){
    if(depth[id]!=null)return depth[id];
    if(busy[id])return 0;            // o core recusa ciclo; isto é só um cinto
    busy[id]=1;
    var deps=(by[id].dependsOn||[]).filter(function(d){return by[d]});
    depth[id]=deps.length?1+Math.max.apply(null,deps.map(deep)):0;
    busy[id]=0; return depth[id];
  }
  changes.forEach(function(c){deep(c.id)});
  var cols=[];
  changes.forEach(function(c){var d=depth[c.id];(cols[d]=cols[d]||[]).push(c)});
  // Baricentro: cada nó desce para perto da média das suas dependências. Duas
  // passadas tiram a maior parte dos cruzamentos sem virar um solver.
  var row={}; cols.forEach(function(col){col.forEach(function(c,i){row[c.id]=i})});
  function bary(c){
    var deps=(c.dependsOn||[]).filter(function(x){return by[x]});
    return deps.length?deps.reduce(function(t,x){return t+row[x]},0)/deps.length:row[c.id];
  }
  for(var pass=0;pass<2;pass++)cols.forEach(function(col,d){
    if(d)col.sort(function(a,b){return bary(a)-bary(b)});
    col.forEach(function(c,i){row[c.id]=i});
  });
  // Colunas curtas centradas: com poucos nós por nível, alinhar tudo no topo
  // deixa a aresta subindo na diagonal e o caminho some no meio do desenho.
  var tallest=cols.reduce(function(m,col){return Math.max(m,col.length)},0), nodes=[];
  cols.forEach(function(col,d){col.forEach(function(c,i){
    nodes.push({c:c,x:PADX+d*(GW+GAPX),y:PADY+(i+(tallest-col.length)/2)*(GH+GAPY),wave:d});
  })});
  return {nodes:nodes,cols:cols};
}

function clipText(text,max){var t=String(text||'');return t.length>max?t.slice(0,max-1)+'…':t}

/** Título em até duas linhas: o nó tem altura para isso e cortar em 26 não dizia nada. */
function graphTitle(text){
  var words=String(text||'').split(/\s+/), lines=[''];
  words.forEach(function(word){
    var i=lines.length-1;
    if((lines[i]+' '+word).trim().length>30&&lines[i]&&i===0)lines.push(word);
    else lines[i]=(lines[i]+' '+word).trim();
  });
  return lines.slice(0,2).map(function(line){return clipText(line,30)});
}

function graphSvg(changes){
  var laid=graphLayers(changes), nodes=laid.nodes, at={};
  nodes.forEach(function(n){at[n.c.id]=n});
  var index=graphIndex(GDATA?GDATA.changes:changes), visible=new Set(changes.map(function(c){return c.id}));
  var edges='';
  nodes.forEach(function(n){(n.c.dependsOn||[]).forEach(function(dep){
    var from=at[dep]; if(!from)return;
    var x1=from.x+GW,y1=from.y+GH/2,x2=n.x,y2=n.y+GH/2,mid=(x1+x2)/2;
    // Uma aresta que ainda barra o destino é a informação mais útil do grafo.
    var blocking=(n.c.blockedBy||[]).indexOf(dep)>=0;
    var lit=GSELECT&&(dep===GSELECT||n.c.id===GSELECT);
    edges+='<path class="gedge'+(blocking?' block':'')+(lit?' lit':'')+'" data-from="'+esc(dep)+'" data-to="'+esc(n.c.id)+'"'
      +' d="M'+x1+' '+y1+'C'+mid+' '+y1+' '+mid+' '+y2+' '+x2+' '+y2+'" marker-end="url(#gtip'+(blocking?'b':'')+')"/>';
  })});
  var waves=laid.cols.map(function(col,d){
    return '<text class="gwave" x="'+(PADX+d*(GW+GAPX))+'" y="25">'+(GMODE==='all'?(d+1)+'ª ONDA':'NÍVEL '+(d+1))+'</text>';
  }).join('');
  var boxes=nodes.map(function(n){
    var c=n.c,tone=PRES[c.presentation]||'t-dim';
    var running=c.execution==='in_progress'||c.execution==='verifying';
    var cls='gn s-'+tone.replace('t-','')+(running?' run':'')+(c.execution==='archived'?' done':'')+(c.id===GSELECT?' lit':'');
    var neighbors=graphNeighbors(c.id,index), hidden=neighbors.filter(function(id){return !visible.has(id)}).length;
    var expanded=GEXPANDED.has(c.id), picked=c.id===GSELECT;
    // O rótulo promete exatamente o que o clique FAZ. Só o nó em foco recolhe:
    // clicar num vizinho para lê-lo não pode fechar o ramo que ele abriu.
    var label=GMODE==='all'?'focar relações'
      :!neighbors.length?'sem relações'
      :expanded?(picked?'− recolher':'')
      :hidden?'+ '+hidden+' relações':'ver relações';
    var blockers=(c.manualBlockers||[]).length;
    return '<g class="'+cls+'" data-node="'+esc(c.id)+'" tabindex="0" role="button"'
      +' aria-label="'+esc(c.id+' · '+c.title+' · '+c.presentation+' · '+(label||'selecionar'))+'" aria-expanded="'+(GMODE==='focus'&&expanded)+'">'
      +'<title>'+esc(c.id+' · '+c.title+' — '+c.presentation
        +((c.blockedBy&&c.blockedBy.length)?' (falta '+c.blockedBy.join(', ')+')':''))+'</title>'
      +'<rect x="'+n.x+'" y="'+n.y+'" width="'+GW+'" height="'+GH+'"/>'
      +'<text class="id" x="'+(n.x+13)+'" y="'+(n.y+21)+'">'+esc(c.id)+'</text>'
      +(blockers?'<text class="warn" x="'+(n.x+GW-13)+'" y="'+(n.y+21)+'" text-anchor="end">!</text>':'')
      +'<text class="ms" x="'+(n.x+GW-(blockers?24:13))+'" y="'+(n.y+21)+'" text-anchor="end">'+esc(c.milestone||'')+'</text>'
      +graphTitle(c.title).map(function(line,i){return '<text class="ti" x="'+(n.x+13)+'" y="'+(n.y+41+i*15)+'">'+esc(line)+'</text>'}).join('')
      +'<text class="gs" x="'+(n.x+13)+'" y="'+(n.y+75)+'">'+esc(clipText(c.presentation,19))+'</text>'
      +'<text class="gx" x="'+(n.x+GW-12)+'" y="'+(n.y+75)+'" text-anchor="end">'+esc(label)+'</text></g>';
  }).join('');
  var defs='<defs><marker id="gtip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">'
    +'<path d="M0 0 L8 4 L0 8 z" fill="var(--dim)"/></marker>'
    +'<marker id="gtipb" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">'
    +'<path d="M0 0 L8 4 L0 8 z" fill="var(--yellow)"/></marker></defs>';
  return {svg:defs+waves+edges+boxes,nodes:nodes,
    width:Math.max(GW+PADX*2,PADX*2+laid.cols.length*(GW+GAPX)-GAPX),
    height:Math.max(GH+PADY*2,nodes.reduce(function(m,n){return Math.max(m,n.y+GH+PADY)},0))};
}

/* ---------- o modal ---------- */

function graphSize(){
  var box=E('gwrap').getBoundingClientRect();return {w:Math.max(box.width,1),h:Math.max(box.height,1)};
}
function setView(v){
  GVIEW=v; E('gsvg').setAttribute('viewBox',v.x+' '+v.y+' '+v.w+' '+v.h);
  GSCALE=graphSize().w/v.w;
  E('gzoom').textContent=Math.round(GSCALE*100)+'%';
}

/**
 * Enquadrar tem duas leituras, e elas se contradizem.
 *
 * "Ver tudo" reduz até o desenho inteiro caber — com muitas ondas, as caixas
 * ficam ilegíveis. "Legível" não desce abaixo de 85% e centra no nó selecionado:
 * é o que o grafo faz ao abrir, porque abrir num borrão não ajuda ninguém.
 */
function fitGraph(readable){
  if(!GLAID)return;
  var size=graphSize(),scale=Math.min(size.w/GLAID.width,size.h/GLAID.height,1.25);
  if(readable)scale=Math.max(scale,.85);
  var w=size.w/scale,h=size.h/scale;
  // Só desloca para o nó selecionado quando o desenho NÃO cabe: com tudo à vista,
  // descentrar deixaria metade da tela vazia sem revelar nada.
  var node=GLAID.nodes.find(function(n){return n.c.id===GSELECT});
  var tight=readable&&node&&(GLAID.width>w||GLAID.height>h);
  var cx=tight?node.x+GW/2:GLAID.width/2,cy=tight?node.y+GH/2:GLAID.height/2;
  // Preso às bordas do desenho: centrar num nó da ponta deixaria metade da tela
  // fora do grafo. Depois disso o leitor arrasta para onde quiser, sem limite.
  setView({x:edge(cx-w/2,w,GLAID.width),y:edge(cy-h/2,h,GLAID.height),w:w,h:h});
}
function edge(at,span,total){
  return span<total?Math.max(0,Math.min(at,total-span)):(total-span)/2;
}

/**
 * Traz para dentro do enquadramento o que acabou de aparecer.
 *
 * Expandir um nó na borda direita revelaria filhos fora da tela: o leitor
 * clicaria e nada mudaria à vista. Só desloca — a escala é escolha dele.
 */
function ensureVisible(ids){
  if(!GVIEW||!GLAID)return;
  var box=null;
  GLAID.nodes.forEach(function(n){
    if(ids.indexOf(n.c.id)<0)return;
    box=box?{x0:Math.min(box.x0,n.x),y0:Math.min(box.y0,n.y),
             x1:Math.max(box.x1,n.x+GW),y1:Math.max(box.y1,n.y+GH)}
           :{x0:n.x,y0:n.y,x1:n.x+GW,y1:n.y+GH};
  });
  if(!box)return;
  var pad=26,x=GVIEW.x,y=GVIEW.y;
  // A borda inicial vem por último: se a vizinhança for maior que a tela, o nó
  // selecionado é o que fica visível, não o último filho da lista.
  if(box.x1+pad>x+GVIEW.w)x=box.x1+pad-GVIEW.w;
  if(box.x0-pad<x)x=box.x0-pad;
  if(box.y1+pad>y+GVIEW.h)y=box.y1+pad-GVIEW.h;
  if(box.y0-pad<y)y=box.y0-pad;
  if(x!==GVIEW.x||y!==GVIEW.y)setView({x:x,y:y,w:GVIEW.w,h:GVIEW.h});
}

function focusGraph(id){
  if(!GDATA||!GDATA.changes.some(function(c){return c.id===id}))return;
  GROOT=id; GSELECT=id; GMODE='focus'; GEXPANDED=new Set([id]); drawGraph(true);
}

/** Onde o leitor provavelmente quer começar: o que está correndo, ou o que o plano recomenda. */
function pickGraphRoot(d){
  return (d.changes.find(function(c){return c.execution==='in_progress'||c.execution==='verifying'})
    ||d.changes.find(function(c){return d.recommended&&c.id===d.recommended.id})
    ||d.changes.find(function(c){return c.execution!=='archived'&&c.presentation==='pronta'})
    ||d.changes[0]).id;
}

/**
 * Um plano novo chegou.
 *
 * Trocar de plano recomeça do zero; a mesma revisão redesenhada preserva raiz,
 * seleção e o que estava aberto — perder o lugar a cada gravação de arquivo
 * tornaria o grafo inútil justamente enquanto o trabalho anda.
 */
function updateGraph(d){
  var different=!GDATA||GPLAN!==(d.plan&&d.plan.id), oldRoot=GROOT;
  GDATA=d; GPLAN=d.plan&&d.plan.id;
  if(!d.plan||!(d.changes||[]).length){
    GROOT=null; GSELECT=null; GEXPANDED.clear(); GVIEW=null; GLAID=null;
    E('gsvg').innerHTML=''; E('gempty').hidden=false;
    E('gempty').textContent=d.message||'Nenhum incremento neste plano.';
    E('ginfo').textContent='0 incrementos'; E('gdetail').innerHTML='';
    E('gupdated').textContent='atualizado agora'; return;
  }
  var ids=new Set(d.changes.map(function(c){return c.id}));
  if(different||!ids.has(GROOT)){
    GROOT=pickGraphRoot(d); GSELECT=GROOT; GEXPANDED=new Set([GROOT]); GMODE='focus';
  }
  if(!ids.has(GSELECT))GSELECT=GROOT;
  Array.from(GEXPANDED).forEach(function(id){if(!ids.has(id))GEXPANDED.delete(id)});
  drawGraph(different||oldRoot!==GROOT);
  E('gupdated').textContent='atualizado '+new Date(d.generatedAt||Date.now()).toLocaleTimeString();
}

function graphRelations(ids,index){
  if(!ids.length)return '<p class="muted sm">Nenhuma.</p>';
  return ids.map(function(id){var c=index.by.get(id);if(!c)return '';
    return '<button type="button" class="grel" data-gfocus="'+esc(id)+'"><span class="id">'+esc(id)+'</span>'
      +'<span class="nm">'+esc(c.title)+'</span>'
      +'<small class="'+(PRES[c.presentation]||'t-dim')+'">'+esc(c.presentation)+'</small></button>';
  }).join('');
}

/** O painel lateral: o nó selecionado por extenso, e as duas listas navegáveis. */
function graphDetail(){
  var index=graphIndex(GDATA.changes), c=index.by.get(GSELECT);
  if(!c){E('gdetail').innerHTML='';return}
  var next=index.next.get(c.id)||[];
  E('gdetail').innerHTML='<div class="gtitle"><span class="id">'+esc(c.id)+'</span>'
    +'<span class="tag '+(PRES[c.presentation]||'t-dim')+'">'+esc(c.presentation)+'</span></div>'
    +'<h3>'+esc(c.title)+'</h3>'
    +(c.milestone?'<p class="sm muted">'+esc(c.milestone)+'</p>':'')
    +(c.link?'<p class="sm muted">vínculo<br><strong>'+esc(c.link.name)+'</strong></p>':'')
    +(c.link&&c.link.tasks?'<p class="sm">'+c.link.tasks.completed+'/'+c.link.tasks.total+' tarefas</p>'
      +bar(c.link.tasks.completed,c.link.tasks.total,'cyan'):'')
    +(c.blockedBy&&c.blockedBy.length?'<p class="gblock">falta '+esc(c.blockedBy.join(', '))+'</p>':'')
    +(c.manualBlockers||[]).map(function(b){return '<p class="gblock">blocker: '+esc(b)+'</p>'}).join('')
    +'<div class="gactions"><button class="chip" type="button" data-gfocus="'+esc(c.id)+'">focar aqui</button>'
    +(c.plannedChange?'<button class="chip" type="button" id="gbrief">abrir resumo ↗</button>':'')+'</div>'
    +'<h2>DEPENDE DE · '+(c.dependsOn||[]).length+'</h2>'+graphRelations(c.dependsOn||[],index)
    +'<h2>DESTRAVA · '+next.length+'</h2>'+graphRelations(next,index);
}

/**
 * Redesenha.
 *
 * O reframe só é verdadeiro quando o leitor mudou de assunto (outra raiz, outro
 * modo, outro plano). Expandir um nó ancora o desenho no selecionado: a escala e
 * o enquadramento que ele escolheu continuam valendo, e o que apareceu entra ao
 * redor em vez de jogar tudo para outro canto.
 */
function drawGraph(reframe){
  if(!GDATA||!GDATA.plan||!GROOT)return;
  E('gempty').hidden=true;
  var visible=graphVisible(GDATA.changes), previous=GLAID;
  if(!visible.some(function(c){return c.id===GSELECT}))GSELECT=GROOT;
  var focused=document.activeElement, focusedNode=focused&&focused.getAttribute&&focused.getAttribute('data-node');
  GLAID=graphSvg(visible); E('gsvg').innerHTML=GLAID.svg;
  GFIT={x:0,y:0,w:GLAID.width,h:GLAID.height};
  if(reframe||!GVIEW)fitGraph(true);
  else if(previous){
    var before=previous.nodes.find(function(n){return n.c.id===GSELECT});
    var after=GLAID.nodes.find(function(n){return n.c.id===GSELECT});
    if(before&&after)setView({x:GVIEW.x+after.x-before.x,y:GVIEW.y+after.y-before.y,w:GVIEW.w,h:GVIEW.h});
    ensureVisible([GSELECT].concat(graphNeighbors(GSELECT,graphIndex(GDATA.changes))));
  }
  E('ginfo').textContent=visible.length+' de '+GDATA.changes.length+' incrementos · '
    +(GMODE==='all'?'plano completo':'relações de '+GROOT);
  E('gall').setAttribute('aria-pressed',String(GMODE==='all'));
  E('gfocusmode').setAttribute('aria-pressed',String(GMODE==='focus'));
  E('gcollapse').disabled=GMODE==='all'; E('gexpand').disabled=GMODE==='all';
  graphDetail();
  // Teclado: o nó que tinha o foco continua com ele depois do innerHTML.
  if(focusedNode){
    var restore=Array.from(E('gsvg').querySelectorAll('.gn')).find(function(n){return n.dataset.node===focusedNode});
    if(restore)restore.focus();
  }
}

function openGraph(){
  GRETURN=document.activeElement;
  E('gmodal').classList.add('on'); E('scrim').classList.add('on');
  if(cache.plano)updateGraph(cache.plano);
  else {E('gempty').hidden=false;E('gempty').textContent='Carregando plano…'}
  E('gclose').focus(); refreshOpenGraph();
}
/**
 * O painel do incremento é uma gaveta, não uma coluna fixa.
 *
 * Ele custa 300px de desenho, e quem está seguindo um caminho longo prefere a
 * largura. A escolha fica gravada: reabrir o grafo devolve o painel como estava.
 */
function toggleDetail(on){
  var open=on===undefined?E('gdetail').hidden:on;
  E('gdetail').hidden=!open;
  E('gpanel').setAttribute('aria-pressed',String(open));
  E('gpanel').setAttribute('aria-expanded',String(open));
  try{localStorage.setItem('sw-gdetail',open?'1':'0')}catch(err){}
}

function closeGraph(){
  E('gmodal').classList.remove('on');GDRAG=null;
  if(!E('drawer').classList.contains('on'))E('scrim').classList.remove('on');
  var back=GRETURN&&GRETURN.isConnected?GRETURN:E('gopen');if(back)back.focus();
}

/**
 * O clique no nó.
 *
 * No plano inteiro ele foca. No modo relações: um nó que não está em foco passa
 * a estar (abrindo o nível dele, se estava fechado); o que já está em foco
 * recolhe. Assim ler um vizinho nunca fecha o ramo por onde se chegou até ele.
 */
function toggleGraphNode(id){
  if(GMODE==='all'){focusGraph(id);return}
  if(GSELECT===id&&GEXPANDED.has(id))GEXPANDED.delete(id);
  else GEXPANDED.add(id);
  GSELECT=id;
  drawGraph(false);
}

function zoomGraph(factor,fx,fy){
  if(!GVIEW)return;
  var size=graphSize(),scale=size.w/GVIEW.w;
  var next=Math.max(.12,Math.min(2.5,scale/factor)),w=size.w/next,h=size.h/next;
  setView({x:GVIEW.x+(GVIEW.w-w)*fx,y:GVIEW.y+(GVIEW.h-h)*fy,w:w,h:h});
}

E('gclose').addEventListener('click',closeGraph);
E('gpanel').addEventListener('click',function(){toggleDetail()});
try{toggleDetail(localStorage.getItem('sw-gdetail')!=='0')}catch(err){toggleDetail(true)}
E('gfit').addEventListener('click',function(){fitGraph(false)});
E('greadable').addEventListener('click',function(){fitGraph(true)});
E('gplus').addEventListener('click',function(){zoomGraph(1/1.2,.5,.5)});
E('gminus').addEventListener('click',function(){zoomGraph(1.2,.5,.5)});
E('grefresh').addEventListener('click',function(){PLAN_EPOCH++;refreshOpenGraph()});
E('gall').addEventListener('click',function(){GMODE='all';drawGraph(true)});
E('gfocusmode').addEventListener('click',function(){focusGraph(GSELECT||GROOT)});
E('gdirection').addEventListener('change',function(){
  GDIR=this.value;GEXPANDED=new Set([GROOT]);drawGraph(true);
});
/* Um nível de cada vez: abre o que já está na tela e para. */
E('gexpand').addEventListener('click',function(){
  if(!GDATA)return;
  graphVisible(GDATA.changes).forEach(function(c){GEXPANDED.add(c.id)});
  drawGraph(false);
});
E('gcollapse').addEventListener('click',function(){
  GEXPANDED=new Set([GROOT]);GSELECT=GROOT;drawGraph(true);
});

E('gsearch').addEventListener('input',function(){
  var query=this.value.trim().toLocaleLowerCase();
  var matches=!query||!GDATA?[]:(GDATA.changes||[]).filter(function(c){
    return (c.id+' '+c.title+' '+(c.slug||'')+' '+(c.link?c.link.name:'')).toLocaleLowerCase().indexOf(query)>=0;
  }).slice(0,8);
  E('gresults').hidden=!query;
  E('gresults').innerHTML=matches.length?matches.map(function(c){
    return '<button type="button" data-gfocus="'+esc(c.id)+'"><b>'+esc(c.id)+'</b> '+esc(c.title)+'</button>';
  }).join(''):'<span>Nenhum incremento encontrado.</span>';
});
E('gsearch').addEventListener('keydown',function(e){
  if(e.key==='Escape'&&!E('gresults').hidden){e.stopPropagation();E('gresults').hidden=true;return}
  if(e.key==='Enter'){var pick=E('gresults').querySelector('button');if(pick){e.preventDefault();pick.click()}}
});

E('gmodal').addEventListener('click',function(e){
  var focus=e.target.closest('[data-gfocus]');
  if(focus){focusGraph(focus.dataset.gfocus);E('gresults').hidden=true;E('gsearch').value='';return}
  if(e.target.closest('#gbrief')&&GSELECT){var id=GSELECT;closeGraph();openBrief(id)}
});
E('gsvg').addEventListener('click',function(e){
  if(GSUPPRESS){GSUPPRESS=false;return}
  var node=e.target.closest('.gn');if(node)toggleGraphNode(node.dataset.node);
});
E('gsvg').addEventListener('dblclick',function(e){
  var node=e.target.closest('.gn');if(node){var id=node.dataset.node;closeGraph();openBrief(id)}
});
E('gsvg').addEventListener('keydown',function(e){
  var node=e.target.closest?e.target.closest('.gn'):null;
  if(node&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleGraphNode(node.dataset.node)}
});

/* O modal é modal: o Tab não pode cair na página por baixo dele. */
E('gmodal').addEventListener('keydown',function(e){
  if(e.key!=='Tab')return;
  var items=Array.from(E('gmodal').querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]'))
    .filter(function(x){return x.getClientRects().length});
  if(!items.length)return;
  var first=items[0],last=items[items.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});

/* Roda dá zoom no ponteiro, arrastar move: um grafo maior que a tela precisa disso. */
E('gwrap').addEventListener('wheel',function(e){
  if(!GVIEW)return;e.preventDefault();var box=E('gwrap').getBoundingClientRect();
  zoomGraph(e.deltaY>0?1.12:1/1.12,(e.clientX-box.left)/box.width,(e.clientY-box.top)/box.height);
},{passive:false});
E('gwrap').addEventListener('pointerdown',function(e){
  if(!GVIEW||e.button!==0)return;
  GSUPPRESS=false;GDRAG={x:e.clientX,y:e.clientY,v:GVIEW,pointer:e.pointerId,moved:false};
});
/* Cinco pixels de folga: sem isso, o tremor da mão no clique viraria arrasto. */
E('gwrap').addEventListener('pointermove',function(e){
  if(!GDRAG||e.pointerId!==GDRAG.pointer)return;
  var dx=e.clientX-GDRAG.x,dy=e.clientY-GDRAG.y;
  if(!GDRAG.moved&&Math.hypot(dx,dy)<5)return;
  GDRAG.moved=true;E('gwrap').classList.add('drag');
  try{E('gwrap').setPointerCapture(e.pointerId)}catch(err){}
  var size=graphSize();
  setView({x:GDRAG.v.x-dx*GDRAG.v.w/size.w,y:GDRAG.v.y-dy*GDRAG.v.h/size.h,w:GDRAG.v.w,h:GDRAG.v.h});
});
['pointerup','pointercancel','lostpointercapture'].forEach(function(ev){
  E('gwrap').addEventListener(ev,function(){
    if(GDRAG&&GDRAG.moved)GSUPPRESS=true;
    GDRAG=null;E('gwrap').classList.remove('drag');
  });
});

/* Redimensionar — ou recolher a gaveta — mantém a escala e o centro; o que muda
 * é quanto do desenho cabe. Preservar a largura do viewBox daria zoom sozinho. */
if(typeof ResizeObserver!=='undefined')new ResizeObserver(function(){
  if(!GVIEW||!E('gmodal').classList.contains('on'))return;
  var size=graphSize(),w=size.w/GSCALE,h=size.h/GSCALE;
  setView({x:GVIEW.x+(GVIEW.w-w)/2,y:GVIEW.y+(GVIEW.h-h)/2,w:w,h:h});
}).observe(E('gwrap'));
`;
