import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../../src/server/serve.js';
import { makeWorkspace, writeFile } from '../helpers/workspace.js';
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

  it('as telas fora do RESUMO recarregam quando o stream avisa', async () => {
    const { INDEX_HTML } = await import('../../src/server/ui.js');
    // O SSE só carrega o overview; sem invalidar, CHANGES e PLANO ficariam velhas.
    expect(INDEX_HTML).toContain('delete cache.changes');
    expect(INDEX_HTML).toContain('delete cache.plano');
  });
});
