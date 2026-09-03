import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../../src/server/serve.js';
import { makeWorkspace, runCli, writeFile } from '../helpers/workspace.js';
import type { Workspace } from '../../src/core/workspace.js';

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
  it('a página traz as três abas do terminal, com as mesmas teclas', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    for (const label of ['RESUMO', 'CHANGES', 'PLANO']) {
      expect(INDEX_HTML, label).toContain(label);
    }
    // 1/2/3 saltam, Tab e setas andam, r repinta — o hábito vem do TUI.
    expect(INDEX_HTML).toMatch(/\[1-3\]/);
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
    // O primeiro card de cada tela continua fixo: esconder o resumo não ajuda.
    expect(INDEX_HTML).toContain('var box=first?sec:card');
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
