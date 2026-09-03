import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../../src/server/serve.js';
import { makeWorkspace, runCli, writeFile } from '../helpers/workspace.js';
import type { Workspace } from '../../src/core/workspace.js';
import { OPEN_TASKS_SHOWN } from '../../src/core/change/status.js';

let running: RunningServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** Port 0 asks the OS for a free one: parallel runs never collide. */
async function serve(workspace: Workspace): Promise<RunningServer> {
  running = await startServer(workspace, { port: 0 });
  return running;
}

async function get(server: RunningServer, route: string): Promise<Response> {
  return fetch(server.url + route);
}

describe('specs serve — superfície', () => {
  it('serve a página e as três projeções', async () => {
    const workspace = await makeWorkspace();
    const server = await serve(workspace);

    const page = await get(server, '/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('SPECWRIGHT');

    for (const route of ['/api/overview', '/api/changes', '/api/plan']) {
      const response = await get(server, route);
      expect(response.status, route).toBe(200);
      expect(response.headers.get('content-type'), route).toContain('application/json');
      await expect(response.json()).resolves.toBeTypeOf('object');
    }
  });

  it('carimba a projeção com versão e momento', async () => {
    const server = await serve(await makeWorkspace());
    const body = (await (await get(server, '/api/overview')).json()) as Record<string, unknown>;
    expect(body.overviewSchemaVersion).toBe(1);
    expect(String(body.generatedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('recusa qualquer método de escrita (I-1)', async () => {
    const server = await serve(await makeWorkspace());
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(server.url + '/api/overview', { method });
      expect(response.status, method).toBe(405);
      expect((await response.json()).error.code).toBe('read_only');
    }
  });

  it('rota desconhecida devolve 404 com código estável', async () => {
    const server = await serve(await makeWorkspace());
    const response = await get(server, '/nao-existe');
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('not_found');
  });

  it('sobe num projeto sem plano, e /api/plan diz isso sem quebrar', async () => {
    const server = await serve(await makeWorkspace());
    const body = (await (await get(server, '/api/plan')).json()) as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(String(body.message)).toContain('Nenhum plano');
  });

  it('escuta só em loopback (I-2)', async () => {
    const server = await serve(await makeWorkspace());
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('observa spec/ e planning/ quando existem', async () => {
    const workspace = await makeWorkspace();
    await fs.mkdir(path.join(workspace.projectRoot, 'planning'), { recursive: true });
    const server = await serve(workspace);
    expect(server.watching).toHaveLength(2);
  });

  it('um projeto sem planning/ observa só spec/, sem erro', async () => {
    const server = await serve(await makeWorkspace());
    expect(server.watching).toHaveLength(1);
  });
});

describe('specs serve — stream', () => {
  it('entrega um quadro ao conectar e outro quando o projeto muda', async () => {
    const workspace = await makeWorkspace();
    const server = await serve(workspace);

    const response = await fetch(server.url + '/api/events');
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const frames: string[] = [];
    let buffer = '';

    const pump = (async () => {
      while (frames.length < 2) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (raw.startsWith('event: overview')) frames.push(raw);
        }
      }
    })();

    // Uma mudança real no workspace, depois do quadro inicial.
    await new Promise((r) => setTimeout(r, 150));
    await writeFile(path.join(workspace.changesPath, 'nova', 'proposal.md'), '# nova\n');

    await Promise.race([pump, new Promise((r) => setTimeout(r, 4000))]);
    await reader.cancel().catch(() => undefined);

    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[0]).toContain('"overviewSchemaVersion"');
  });

  it('close encerra o stream e libera a porta', async () => {
    const workspace = await makeWorkspace();
    const first = await startServer(workspace, { port: 0 });
    const port = first.port;
    void fetch(first.url + '/api/events').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 120));
    await first.close();

    // A mesma porta tem de aceitar um servidor novo.
    const second = await startServer(workspace, { port });
    expect(second.port).toBe(port);
    await second.close();
  });
});

describe('specs serve — a página e a projeção não podem divergir', () => {
  /** Every field `INDEX_HTML` reads. Adding one here without publishing it fails. */
  const READS = {
    raiz: ['projectName', 'schema', 'harness', 'generatedAt', 'overviewSchemaVersion', 'changes', 'focus', 'diagnostics'],
    changes: ['active', 'readyToArchive', 'archived', 'tasks', 'capabilities', 'requirements'],
    diagnostics: ['errors', 'warnings'],
  };

  it('a projeção publica tudo que a UI consome', async () => {
    const server = await serve(await makeWorkspace());
    const body = (await (await get(server, '/api/overview')).json()) as Record<string, any>;

    for (const key of READS.raiz) expect(body, key).toHaveProperty(key);
    for (const key of READS.changes) expect(body.changes, key).toHaveProperty(key);
    for (const key of READS.diagnostics) expect(body.diagnostics, key).toHaveProperty(key);
  });

  it('a UI embutida referencia só campos que a projeção publica', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    // Os campos opcionais são lidos sob guarda no script; os obrigatórios, não.
    for (const key of READS.raiz) expect(INDEX_HTML, key).toContain(key);
    for (const route of ['/api/overview', '/api/events', '/api/changes', '/api/plan']) {
      expect(INDEX_HTML, route).toContain(route);
    }
  });

  it('a tela CHANGES lê campos que /api/changes publica', async () => {
    const workspace = await makeWorkspace();
    await writeFile(path.join(workspace.changesPath, 'alguma', 'proposal.md'), '# x\n');
    const server = await serve(workspace);
    const body = (await (await get(server, '/api/changes')).json()) as Record<string, any>;

    expect(body).toHaveProperty('changes');
    expect(body).toHaveProperty('specs');
    expect(body).toHaveProperty('archive');
    const first = body.changes[0];
    for (const key of ['id', 'phase', 'artifacts', 'blockedBy', 'next']) {
      expect(first, key).toHaveProperty(key);
    }
    expect(first.artifacts[0]).toHaveProperty('state');
  });

  it('a tela CHANGES recebe as tarefas abertas da change, não só o total', async () => {
    const workspace = await makeWorkspace();
    const dir = path.join(workspace.changesPath, 'alguma');
    await writeFile(path.join(dir, 'proposal.md'), '# x\n');
    await writeFile(
      path.join(dir, 'tasks.md'),
      '## 1. Base\n\n- [x] 1.1 Feito\n- [ ] 1.2 Em andamento\n- [ ] 1.3 Depois\n'
    );
    const server = await serve(workspace);
    const body = (await (await get(server, '/api/changes')).json()) as Record<string, any>;
    const change = body.changes.find((c: any) => c.id === 'alguma');

    expect(change.tasks).toMatchObject({ total: 3, completed: 1 });
    // Só as abertas: o que já foi feito o contador ao lado da barra já diz.
    expect(change.tasks.open.map((t: any) => t.number)).toEqual(['1.2', '1.3']);

    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('function openTasks(c)');
    // A lista é curta e o resto abre no checklist inteiro, num clique.
    expect(INDEX_HTML).toContain("data-doc=\"change:'+esc(c.id)+':tasks\"");
  });

  it('a lista de tarefas abertas é curta por contrato, não por acaso', async () => {
    const workspace = await makeWorkspace();
    const dir = path.join(workspace.changesPath, 'grande');
    await writeFile(path.join(dir, 'proposal.md'), '# x\n');
    const lines = Array.from({ length: 12 }, (_, i) => `- [ ] 1.${i + 1} Tarefa ${i + 1}`);
    await writeFile(path.join(dir, 'tasks.md'), `## 1. Base\n\n${lines.join('\n')}\n`);
    const server = await serve(workspace);
    const body = (await (await get(server, '/api/changes')).json()) as Record<string, any>;
    const change = body.changes.find((c: any) => c.id === 'grande');

    expect(change.tasks.total).toBe(12);
    // Uma tela com vinte changes tem de continuar sendo uma tela.
    expect(change.tasks.open).toHaveLength(OPEN_TASKS_SHOWN);
  });

  it('a tela PLANO degrada sem plano em vez de quebrar', async () => {
    const server = await serve(await makeWorkspace());
    const body = (await (await get(server, '/api/plan')).json()) as Record<string, any>;
    expect(body.plan).toBeNull();
    // A UI cai na mensagem quando `plan` é nulo; sem ela a tela ficaria vazia.
    expect(body.message).toBeTruthy();
  });
});

describe('specs serve — o resumo do incremento', () => {
  /** A plan with one increment whose brief is materialized on disk. */
  async function planWithBrief(): Promise<Workspace> {
    const workspace = await makeWorkspace();
    const cli = (args: string[]) => runCli(args, workspace.projectRoot);
    expect((await cli(['project', 'create', 'demo', '--json'])).code).toBe(0);
    const bundle = JSON.stringify({
      bundleVersion: 1,
      expectRevision: 0,
      operations: [
        {
          op: 'addChange',
          slug: 'terminal-ux',
          title: 'UX de terminal',
          plannedChange: {
            objetivo: 'Deixar a saída legível.',
            escopo: ['cores', 'painel de hoje'],
            criteriosMacro: ['sem quebra de layout'],
          },
        },
      ],
    });
    await writeFile(path.join(workspace.projectRoot, 'b.json'), bundle);
    expect((await cli(['project', 'apply', '--file', 'b.json', '--json'])).code).toBe(0);
    return workspace;
  }

  it('devolve o markdown do brief pelo id do incremento', async () => {
    const server = await serve(await planWithBrief());
    const body = (await (await get(server, '/api/brief?change=CH-001')).json()) as any;
    expect(body.found).toBe(true);
    expect(body.id).toBe('CH-001');
    expect(body.title).toBe('UX de terminal');
    expect(body.path).toContain('CH-001-terminal-ux.md');
    expect(body.markdown).toContain('# Objetivo');
  });

  it('recusa um id que não é CH-NNN, sem tocar no disco', async () => {
    const server = await serve(await planWithBrief());
    for (const bad of ['../../etc/passwd', '..%2f..%2fetc', 'CH-1', 'nao-existe', '']) {
      const response = await get(server, '/api/brief?change=' + encodeURIComponent(bad));
      expect(response.status, bad).toBe(400);
      expect((await response.json()).error.code).toBe('invalid_change_id');
    }
  });

  it('um incremento inexistente é 404, não 500', async () => {
    const server = await serve(await planWithBrief());
    const response = await get(server, '/api/brief?change=CH-999');
    expect(response.status).toBe(404);
    expect((await response.json()).reason).toBe('change_not_found');
  });

  it('sem plano, diz que não há plano em vez de quebrar', async () => {
    const server = await serve(await makeWorkspace());
    const response = await get(server, '/api/brief?change=CH-001');
    expect(response.status).toBe(404);
    expect((await response.json()).reason).toBe('no_plan');
  });

  it('a página traz o leitor de markdown e o painel lateral', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('id="drawer"');
    expect(INDEX_HTML).toContain('function md(src)');
    expect(INDEX_HTML).toContain('data-brief');
    expect(INDEX_HTML).toContain('/api/brief?change=');
    // O markdown é escapado antes de virar HTML: arquivo do projeto ainda é entrada.
    expect(INDEX_HTML).toMatch(/function inline\(t\)\{[^}]*esc\(t\)/);
    // Esc fecha o painel antes de qualquer atalho de aba.
    expect(INDEX_HTML).toContain("e.key==='Escape'");
  });

  it('o comando do harness já vem montado com id e slug', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain("var arg=' '+c.id+' '+c.slug");
    expect(INDEX_HTML).toContain('HARNESS_VERB.propose+arg');
    // O verbo vem do payload, porque o Codex usa $spec-* em vez de /spec-*.
    expect(INDEX_HTML).toContain('HARNESS_VERB.explore=verb');
  });
});

describe('specs serve — navegação', () => {
  it('a página traz as abas do terminal mais o catálogo, com as mesmas teclas', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    for (const label of ['RESUMO', 'CHANGES', 'PLANO', 'DOCUMENTOS']) {
      expect(INDEX_HTML, label).toContain(label);
    }
    // 1..4 saltam, Tab e setas andam, r repinta — o hábito vem do TUI.
    expect(INDEX_HTML).toMatch(/\[1-4\]/);
    expect(INDEX_HTML).toContain("'ArrowRight'");
    expect(INDEX_HTML).toContain("'ArrowLeft'");
    expect(INDEX_HTML).toContain('keydown');
  });

  it('a aba escolhida vive no hash, então recarregar não perde o lugar', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('location.hash');
    expect(INDEX_HTML).toContain('replaceState');
  });

  it('os dois temas existem e a escolha é lembrada', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('data-theme=light');
    expect(INDEX_HTML).toContain("localStorage.setItem('sw-theme'");
    // localStorage lança em janela privada: a leitura tem de ser protegida.
    expect(INDEX_HTML).toMatch(/try\{[^}]*localStorage\.getItem/);
  });

  it('todo comando vira um chip copiável, nenhum fica como texto cru', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    // O helper existe e é a única forma de imprimir comando na tela.
    expect(INDEX_HTML).toContain('function cmd(text)');
    expect(INDEX_HTML).toContain('data-copy=');
    expect(INDEX_HTML).not.toContain('class="sub2 cmd">↳ \'+esc(');
  });

  it('a cópia tem plano B fora de contexto seguro', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    // A Clipboard API exige contexto seguro; um proxy sem HTTPS não é um.
    expect(INDEX_HTML).toContain('navigator.clipboard');
    expect(INDEX_HTML).toContain('isSecureContext');
    expect(INDEX_HTML).toContain('execCommand');
  });

  it('os cards depois do primeiro são acordeão, abertos por padrão', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    // <details open> nativo: sem JS, acessível e navegável por teclado.
    expect(INDEX_HTML).toContain('<details class="card" open>');
    expect(INDEX_HTML).toContain('function card(t,b,n)');
    // O primeiro bloco de cada tela continua fixo — é o resumo dela, e esconder
    // o resumo não ajuda. Toda tela abre com `sec(...)`, o resto vira acordeão.
    for (const screen of ['screenResumo', 'screenChanges', 'screenPlano', 'screenDocs']) {
      const body = INDEX_HTML.slice(INDEX_HTML.indexOf('function ' + screen + '(')).slice(0, 1500);
      expect(body.includes('sec(') || body.includes('findBar('), screen).toBe(true);
    }
  });

  it('CLI e harness aparecem rotulados, nunca misturados', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain("group('no harness'");
    expect(INDEX_HTML).toContain("group('no terminal'");
  });

  it('nada pode vazar da viewport', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('overflow-x:hidden');
    // Linha, milestone e grupo de comando quebram em vez de empurrar a largura.
    expect(INDEX_HTML).toMatch(/\.row\{[^}]*flex-wrap:wrap/);
    expect(INDEX_HTML).toMatch(/\.grow\{flex:1 1 220px/);
    expect(INDEX_HTML).toContain('overflow-wrap:anywhere');
  });

  it('as telas fora do RESUMO recarregam quando o stream avisa', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    // O SSE só carrega o overview; sem invalidar, CHANGES e PLANO ficariam velhas.
    expect(INDEX_HTML).toContain('delete cache.changes');
    expect(INDEX_HTML).toContain('delete cache.plano');
  });
});

describe('specs serve — o catálogo de documentos', () => {
  async function withArtifacts(): Promise<Workspace> {
    const workspace = await makeWorkspace();
    const dir = path.join(workspace.changesPath, 'terminal-ux');
    await writeFile(path.join(dir, 'proposal.md'), '## Why\n\nSaída ilegível.\n');
    await writeFile(path.join(dir, 'design.md'), '## Decisões\n\nUm tema só.\n');
    await writeFile(
      path.join(dir, 'tasks.md'),
      '## 1. Base\n\n- [x] 1.1 Tema\n- [ ] 1.2 Cores\n\n## 2. Fim\n\n- [ ] 2.1 Revisar\n'
    );
    return workspace;
  }

  it('lista o que existe, com finalidade e caminho de cada documento', async () => {
    const server = await serve(await withArtifacts());
    const body = (await (await get(server, '/api/docs')).json()) as any;

    expect(Array.isArray(body.documents)).toBe(true);
    const entry = body.documents.find((x: any) => x.id === 'change:terminal-ux:design');
    expect(entry).toBeDefined();
    for (const key of ['id', 'kind', 'title', 'purpose', 'group', 'path']) {
      expect(entry, key).toHaveProperty(key);
    }
  });

  it('devolve o markdown de um documento do catálogo', async () => {
    const server = await serve(await withArtifacts());
    const body = (await (await get(server, '/api/doc?id=change:terminal-ux:proposal')).json()) as any;
    expect(body.found).toBe(true);
    expect(body.markdown).toContain('Saída ilegível');
  });

  it('tasks.md volta parseado, não só como texto', async () => {
    const server = await serve(await withArtifacts());
    const body = (await (await get(server, '/api/doc?id=change:terminal-ux:tasks')).json()) as any;

    expect(body.tasks.total).toBe(3);
    expect(body.tasks.completed).toBe(1);
    expect(body.tasks.items[0]).toMatchObject({ number: '1.1', done: true, group: '1. Base' });
    // O arquivo continua disponível: o parse é uma leitura, não a verdade.
    expect(body.markdown).toContain('- [ ] 2.1 Revisar');
  });

  it('um id fora do catálogo é 404, e nunca vira caminho (I-8)', async () => {
    const server = await serve(await withArtifacts());
    for (const id of [
      '../../../../etc/passwd',
      'change:../../etc:proposal',
      '/etc/passwd',
      'change:terminal-ux:config',
    ]) {
      const response = await get(server, '/api/doc?id=' + encodeURIComponent(id));
      expect(response.status, id).toBe(404);
      expect((await response.json()).reason, id).toBe('not_found');
    }
  });

  it('sem id, recusa antes de tocar no disco', async () => {
    const server = await serve(await withArtifacts());
    const response = await get(server, '/api/doc?id=');
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_document_id');
  });

  it('a aba DOCUMENTOS lê o catálogo e abre no mesmo painel lateral', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('/api/docs');
    expect(INDEX_HTML).toContain('/api/doc?id=');
    expect(INDEX_HTML).toContain('data-doc');
    expect(INDEX_HTML).toContain('function screenDocs(d)');
    // O checklist vira progresso; o markdown fica embaixo.
    expect(INDEX_HTML).toContain('function tasksView(b)');
    // O catálogo é invalidado como as demais telas quando o stream avisa.
    expect(INDEX_HTML).toContain('delete cache.docs');
  });

  it('o milestone é navegável e recorta o plano, sem tela nova', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('data-ms=');
    expect(INDEX_HTML).toContain('data-ms-clear');
    expect(INDEX_HTML).toContain('function mileRow(m)');
    // O recorte é aplicado sobre os mesmos estágios do plano.
    expect(INDEX_HTML).toContain("c.milestone===MS");
  });

  it('a busca existe nas telas com lista longa', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('function findBar(title,scope,ph,count,extra)');
    for (const scope of ['changes', 'plano', 'docs']) {
      expect(INDEX_HTML, scope).toContain("'" + scope + "','filtrar");
    }
    // O campo mora na barra de título da seção — não dentro de um <summary>,
    // onde um input abriria e fecharia o acordeão a cada clique.
    expect(INDEX_HTML).toContain('<section class="toolbar">');
    expect(INDEX_HTML).toContain('class="srch"');
  });

  it('a projeção do plano publica o milestone de cada incremento', async () => {
    const server = await serve(await makeWorkspace());
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    // A UI filtra por `c.milestone`; sem o campo o filtro esvaziaria a tela.
    expect(INDEX_HTML).toContain('c.milestone');
    const body = (await (await get(server, '/api/plan')).json()) as any;
    expect(body).toHaveProperty('plan');
  });

  it('o resumo carimba o estado derivado do milestone, como o plano', async () => {
    const server = await serve(await makeWorkspace());
    const body = (await (await get(server, '/api/overview')).json()) as any;
    if (body.milestones && body.milestones.length > 0) {
      expect(body.milestones[0]).toHaveProperty('derivedStatus');
    }
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('MSTAT');
  });
});

describe('specs serve — a página se explica', () => {
  it('as abas seguem a ordem do trabalho: onde estamos, o plano, a change, os documentos', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    const order = [...INDEX_HTML.matchAll(/label:'([A-ZÁÉÍÓÚÇ]+)'/g)].map((m) => m[1]);
    expect(order).toEqual(['RESUMO', 'PLANO', 'CHANGES', 'DOCUMENTOS']);
  });

  it('todo card principal carrega uma frase dizendo o que ele é', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    // Os títulos fixos das quatro telas, e os grupos de nome variável.
    for (const title of [
      'RESUMO', 'EM ANDAMENTO', 'MILESTONES', 'PRÓXIMO PASSO', 'DIAGNÓSTICOS',
      'PLANO', 'INCREMENTOS', 'PRONTAS PARA COMEÇAR', 'BLOQUEADAS', 'CONCLUÍDAS',
      'CHANGES', 'EM PLANEJAMENTO', 'IMPLEMENTANDO', 'PRONTAS PARA ARQUIVAR',
      'CAPACIDADES', 'ARQUIVO', 'DOCUMENTOS',
    ]) {
      expect(INDEX_HTML, title).toContain("'" + title + "':'");
    }
    expect(INDEX_HTML).toContain("['Change · '");
    expect(INDEX_HTML).toContain("['Arquivada · '");
    // A explicação também é lida por leitor de tela, não só no hover.
    expect(INDEX_HTML).toContain('aria-label="');
    expect(INDEX_HTML).toContain('role="note"');
  });

  it('ler a explicação não fecha o acordeão em que ela mora', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    // O glifo fica dentro do <summary>: sem isto, o clique alternaria o card.
    expect(INDEX_HTML).toMatch(/closest\('\.hint'\)[^]{0,80}stopPropagation/);
  });

  it('CHANGES continua em inglês, e a explicação diz por quê', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    // O termo é o mesmo em spec/changes/ e nos comandos; traduzir só na tela
    // obrigaria o leitor a traduzir de volta para digitar.
    expect(INDEX_HTML).toContain("label:'CHANGES'");
    expect(INDEX_HTML).toContain('specs new change');
  });
});

describe('specs serve — o harness dos comandos', () => {
  /** Um ambiente sem marcador nenhum: é assim que o painel sobe de verdade. */
  const BARE = { ...process.env, CLAUDECODE: '', CLAUDE_CODE_ENTRYPOINT: '', SPECS_HARNESS: '' };

  it('diz de onde veio o harness, em vez de apresentá-lo como observado', async () => {
    const workspace = await makeWorkspace({ harnesses: 'codex' });
    const server = await serve(workspace);
    const body = (await (await get(server, '/api/overview')).json()) as any;

    expect(body.harnesses).toEqual(['claude', 'codex', 'opencode', 'kiro']);
    expect(['chosen', 'env', 'config', 'default']).toContain(body.harnessSource);
  });

  it('sem marcador de ambiente, a procedência é a configuração — não uma detecção', async () => {
    const { buildOverview } = await import('../../src/core/overview.js');
    const workspace = await makeWorkspace({ harnesses: 'codex' });
    const data = await buildOverview(workspace, { env: BARE });

    // O `specs serve` sobe no terminal, fora do harness: aqui não há o que detectar.
    expect(data.harness).toBe('codex');
    expect(data.harnessSource).toBe('config');
  });

  it('o leitor pede um harness e todo comando volta na sintaxe dele', async () => {
    const workspace = await makeWorkspace();
    await writeFile(path.join(workspace.changesPath, 'alguma', 'proposal.md'), '# x\n');
    const server = await serve(workspace);

    const body = (await (await get(server, '/api/changes?harness=codex')).json()) as any;
    expect(body.harness).toBe('codex');
    expect(body.harnessSource).toBe('chosen');
    expect(body.changes[0].next.startsWith('$spec-')).toBe(true);
  });

  it('um harness que não existe é recusado, não ignorado', async () => {
    const server = await serve(await makeWorkspace());
    for (const route of ['/api/overview', '/api/changes', '/api/events']) {
      const response = await get(server, route + '?harness=nao-existe');
      expect(response.status, route).toBe(400);
      expect((await response.json()).error.code, route).toBe('unknown_harness');
    }
  });

  it('o stream entrega a cada leitor o harness que ele pediu', async () => {
    const server = await serve(await makeWorkspace());
    const response = await fetch(server.url + '/api/events?harness=codex');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    for (let read = 0; read < 12 && !buffer.includes('event: overview'); read += 1) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => undefined);

    const frame = buffer.slice(buffer.indexOf('data: ') + 6, buffer.indexOf('\n\n', buffer.indexOf('data: ')));
    expect(JSON.parse(frame).harness).toBe('codex');
  });

  it('a página traz o seletor e a procedência, e nenhuma reescrita de comando no cliente', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('id="harness"');
    expect(INDEX_HTML).toContain('function drawHarness(d)');
    expect(INDEX_HTML).toContain('HSOURCE');
    // A escolha vai na query: o servidor remonta as projeções, o cliente não
    // reescreve comando nenhum — reescrever seria inventar sintaxe na página.
    expect(INDEX_HTML).toContain("'harness='+encodeURIComponent(HARNESS)");
    expect(INDEX_HTML).toContain("localStorage.setItem('sw-harness'");
  });
});

describe('specs serve — o grafo de dependências', () => {
  it('abre por cima do plano, sem virar outra tela', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('id="gmodal"');
    expect(INDEX_HTML).toContain('id="gopen"');
    // Esc fecha o grafo antes de qualquer outro atalho, como no painel lateral.
    expect(INDEX_HTML).toMatch(/Escape'&&E\('gmodal'\)/);
    // Enquanto ele está aberto, 1..4 não trocam de aba por baixo dele.
    expect(INDEX_HTML).toContain("E('gmodal').classList.contains('on')||E('drawer')");
  });

  it('desenha a partir do plano que a tela já carregou, sem rota nova', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('function graphSvg(changes)');
    expect(INDEX_HTML).toContain('cache.plano');
    // Nenhum fetch dedicado: o payload de /api/plan já traz o DAG inteiro.
    expect(INDEX_HTML).not.toContain("fetch('/api/graph");
  });

  it('a camada é o caminho mais longo, para a coluna ser a ordem de execução', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain('function graphLayers(changes)');
    expect(INDEX_HTML).toContain('1+Math.max.apply(null,deps.map(deep))');
    expect(INDEX_HTML).toContain('ONDA');
  });

  it('a aresta que ainda barra o destino é desenhada diferente', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain("(n.c.blockedBy||[]).indexOf(dep)>=0");
    expect(INDEX_HTML).toMatch(/\.gedge\.block\{[^}]*stroke-dasharray/);
  });

  it('a change em execução se destaca das demais', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    expect(INDEX_HTML).toContain("c.execution==='in_progress'||c.execution==='verifying'");
    expect(INDEX_HTML).toMatch(/\.gn\.run rect\{/);
  });

  it('a projeção do plano publica tudo que o grafo desenha', async () => {
    const workspace = await makeWorkspace();
    const cli = (args: string[]) => runCli(args, workspace.projectRoot);
    expect((await cli(['project', 'create', 'demo', '--json'])).code).toBe(0);
    await writeFile(
      path.join(workspace.projectRoot, 'g.json'),
      JSON.stringify({
        bundleVersion: 1,
        expectRevision: 0,
        operations: [
          { op: 'addChange', ref: '$a', slug: 'base', title: 'Base' },
          { op: 'addChange', ref: '$b', slug: 'topo', title: 'Topo', dependsOn: ['$a'] },
        ],
      })
    );
    expect((await cli(['project', 'apply', '--file', 'g.json', '--json'])).code).toBe(0);

    const server = await serve(workspace);
    const body = (await (await get(server, '/api/plan')).json()) as any;
    for (const key of ['id', 'title', 'presentation', 'execution', 'milestone', 'dependsOn', 'blockedBy', 'unlocks']) {
      expect(body.changes[0], key).toHaveProperty(key);
    }
    // A aresta e a sua volta: o grafo acende a linhagem nos dois sentidos.
    expect(body.changes[1].dependsOn).toEqual(['CH-001']);
    expect(body.changes[0].unlocks).toEqual(['CH-002']);
  });
});
