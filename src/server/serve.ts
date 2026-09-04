import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { buildDashboard } from '../core/dashboard.js';
import { buildOverview } from '../core/overview.js';
import { computeProjectStatus, statusPayload } from '../core/project/status.js';
import { recommendNext } from '../core/project/next.js';
import { listPlanIds, planPaths, safeResolve } from '../core/project/paths.js';
import { loadPlan } from '../core/project/repository.js';
import { readFileIfExists } from '../util/fs.js';
import { listDocuments, readDocument } from '../core/documents.js';
import { parseTasks } from '../core/change/model.js';
import { dashboardEnvelope, overviewEnvelope } from '../core/contract.js';
import { WORKSPACE_DIR, type Workspace } from '../core/workspace.js';
import { HARNESS_ENV_OVERRIDE } from '../core/harness/current.js';
import { harnessIds } from '../core/harness/registry.js';
import { PLANNING_DIR } from '../core/project/paths.js';
import { watchProject, type ProjectWatcher } from './watcher.js';
import { INDEX_HTML } from './ui.js';

export const DEFAULT_PORT = 4477;

export interface ServeOptions {
  port?: number;
  /** Loopback by default: the panel exposes project content (I-13). */
  host?: string;
  planId?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  /** Directories under observation, for the caller to report. */
  watching: string[];
  close(): Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(text);
}

/**
 * Every projection the page can ask for, and the one the stream pushes.
 *
 * Read-only by construction: the routes call projection functions and nothing
 * else. There is no write path here, and adding one would break I-1 — the panel
 * would become a second way to mutate the project, outside the confirmation
 * protocol the harness commands follow.
 */
async function projections(workspace: Workspace, planId: string | undefined) {
  /**
   * O harness pedido pelo leitor, se houver.
   *
   * O painel roda FORA do harness — o `specs serve` sobe no terminal — então o
   * ambiente do processo raramente diz qual está em uso. Em vez de adivinhar, a
   * página pergunta: `?harness=codex` refaz as projeções com aquele harness e
   * todo comando volta na sintaxe que ele aceita. É o mesmo caminho de
   * `SPECS_HARNESS`, que já existe, exposto por requisição.
   */
  const envFor = (harness?: string): NodeJS.ProcessEnv | undefined =>
    harness ? { ...process.env, [HARNESS_ENV_OVERRIDE]: harness } : undefined;

  return {
    overview: async (harness?: string) => {
      const env = envFor(harness);
      return overviewEnvelope(await buildOverview(workspace, { planId, ...(env ? { env } : {}) }));
    },
    changes: async (harness?: string) => {
      const env = envFor(harness);
      return dashboardEnvelope(await buildDashboard(workspace, env ? { env } : {}));
    },
    plan: async () => {
      const ids = await listPlanIds(workspace.projectRoot);
      if (ids.length === 0) return { plan: null, message: 'Nenhum plano neste projeto.' };
      const id = planId ?? (ids.length === 1 ? ids[0] : undefined);
      if (id === undefined) return { plan: null, message: 'Vários planos: informe qual.', plans: ids };
      const status = await computeProjectStatus(workspace, id);
      return dashboardEnvelope({
        ...statusPayload(status),
        recommended: recommendNext(status).recommended,
      });
    },
    /**
     * The brief of one increment, as written on disk.
     *
     * The path comes from the manifest, never from the query: `change` selects a
     * record, and the record carries where its brief lives. Taking a path from
     * the caller would hand the reader of a loopback port a file reader for the
     * whole disk. `safeResolve` is the second gate, in case a manifest itself
     * carries a path that escapes the plan directory.
     */
    brief: async (changeId: string) => {
      const ids = await listPlanIds(workspace.projectRoot);
      const id = planId ?? (ids.length === 1 ? ids[0] : undefined);
      if (id === undefined) return { found: false, reason: 'no_plan' as const };

      const { manifest } = await loadPlan(workspace.projectRoot, id);
      const record = manifest.changes.find((entry) => entry.id === changeId);
      if (!record) return { found: false, reason: 'change_not_found' as const };
      if (!record.planned_change) return { found: false, reason: 'not_materialized' as const };

      const absolute = safeResolve(planPaths(workspace.projectRoot, id).dir, record.planned_change.path);
      const content = absolute === undefined ? undefined : await readFileIfExists(absolute);
      if (content === undefined) return { found: false, reason: 'missing_on_disk' as const };

      // The materialization state comes from the same computation `status` runs,
      // so the panel and the CLI cannot disagree about a brief. This route used
      // to derive its own `null`-or-`undefined` signal from the presence of
      // `record_hash`, which was a third reading of a rule that has one owner
      // (F-06).
      const briefStatus = await computeProjectStatus(workspace, id);
      const view = briefStatus.changes.find((entry) => entry.id === changeId);

      return {
        found: true,
        id: record.id,
        slug: record.slug,
        title: record.title,
        path: record.planned_change.path,
        state: view?.plannedChange?.state ?? null,
        markdown: content,
      };
    },
    /** The catalogue: which documents exist, what each one is for, where it lives. */
    docs: async () =>
      dashboardEnvelope({ documents: await listDocuments(workspace, planId) }),
    /**
     * One catalogued document. The `id` is a handle, not a path: it is looked up
     * in the catalogue, so the reader can only reach a file the catalogue itself
     * published — the same rule the brief route follows.
     *
     * `tasks.md` is parsed here as well as returned raw. A checklist read as
     * prose loses what it is for; the panel shows progress, and the markdown
     * stays available underneath.
     */
    doc: async (id: string) => {
      const document = await readDocument(workspace, id, planId);
      if (!document) return { found: false as const, reason: 'not_found' as const };
      if (document.kind !== 'tasks') return { found: true as const, ...document };
      const progress = parseTasks(document.markdown);
      return {
        found: true as const,
        ...document,
        tasks: {
          total: progress.total,
          completed: progress.completed,
          items: progress.tasks,
        },
      };
    },
  };
}

export async function startServer(
  workspace: Workspace,
  options: ServeOptions = {}
): Promise<RunningServer> {
  const host = options.host ?? '127.0.0.1';
  const routes = await projections(workspace, options.planId);
  /** Cada leitor com o harness que pediu: duas abas podem pedir sintaxes diferentes. */
  const clients = new Map<ServerResponse, string | undefined>();
  let watcher: ProjectWatcher | undefined;

  const push = async (): Promise<void> => {
    if (clients.size === 0) return;
    // Um quadro por harness pedido, não um por leitor: dez abas no mesmo harness
    // recalculam a projeção uma vez só.
    const frames = new Map<string | undefined, string>();
    for (const harness of new Set(clients.values())) {
      try {
        frames.set(harness, JSON.stringify(await routes.overview(harness)));
      } catch {
        // A projection that fails mid-flight must not kill the stream: the reader
        // keeps the last good frame until the next settled change.
      }
    }
    for (const [client, harness] of clients) {
      const frame = frames.get(harness);
      if (frame !== undefined) client.write(`event: overview\ndata: ${frame}\n\n`);
    }
  };

  /**
   * O harness pedido na query, validado contra o registro.
   *
   * Um id desconhecido é recusado em vez de ignorado: ignorar devolveria uma
   * projeção com a sintaxe de outro harness sem dizer nada, e o leitor copiaria
   * um comando que o harness dele não aceita.
   */
  const askedHarness = (url: URL): { harness?: string; bad?: string } => {
    const asked = url.searchParams.get('harness');
    if (asked === null || asked === '') return {};
    return harnessIds().includes(asked) ? { harness: asked } : { bad: asked };
  };

  const server: Server = http.createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', `http://${host}`);
    const route = url.pathname;

    // Read-only surface, stated in the protocol itself (I-12).
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: { code: 'read_only', message: 'O painel é somente leitura.' } });
      return;
    }

    if (route === '/api/events') {
      const stream = askedHarness(url);
      if (stream.bad !== undefined) {
        sendJson(response, 400, {
          error: { code: 'unknown_harness', message: `"${stream.bad}" não é um harness suportado.` },
        });
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      response.write(': ok\n\n');
      clients.set(response, stream.harness);
      // Without a heartbeat a proxy or a sleeping laptop drops the stream and
      // the page shows stale data believing it is live.
      const beat = setInterval(() => response.write(': beat\n\n'), 30_000);
      beat.unref?.();
      request.on('close', () => {
        clearInterval(beat);
        clients.delete(response);
      });
      void routes.overview(stream.harness).then((data) => {
        response.write(`event: overview\ndata: ${JSON.stringify(data)}\n\n`);
      });
      return;
    }

    if (route === '/api/brief') {
      const changeId = url.searchParams.get('change') ?? '';
      if (!/^CH-\d{3,}$/.test(changeId)) {
        sendJson(response, 400, {
          error: { code: 'invalid_change_id', message: 'Informe ?change=CH-NNN.' },
        });
        return;
      }
      routes
        .brief(changeId)
        .then((body) => sendJson(response, body.found ? 200 : 404, body))
        .catch((error: unknown) =>
          sendJson(response, 500, {
            error: { code: 'projection_failed', message: (error as Error).message },
          })
        );
      return;
    }

    if (route === '/api/doc') {
      const id = url.searchParams.get('id') ?? '';
      if (id === '' || id.length > 512) {
        sendJson(response, 400, {
          error: { code: 'invalid_document_id', message: 'Informe ?id=<id do catálogo>.' },
        });
        return;
      }
      routes
        .doc(id)
        .then((body) => sendJson(response, body.found ? 200 : 404, body))
        .catch((error: unknown) =>
          sendJson(response, 500, {
            error: { code: 'projection_failed', message: (error as Error).message },
          })
        );
      return;
    }

    const { harness, bad } = askedHarness(url);
    if (bad !== undefined) {
      sendJson(response, 400, {
        error: {
          code: 'unknown_harness',
          message: `"${bad}" não é um harness suportado. Suportados: ${harnessIds().join(', ')}`,
        },
      });
      return;
    }

    const handler =
      route === '/api/overview' ? () => routes.overview(harness)
      : route === '/api/docs' ? routes.docs
      : route === '/api/changes' ? () => routes.changes(harness)
      : route === '/api/plan' ? routes.plan
      : undefined;

    if (handler) {
      handler()
        .then((body) => sendJson(response, 200, body))
        .catch((error: unknown) =>
          sendJson(response, 500, {
            error: { code: 'projection_failed', message: (error as Error).message },
          })
        );
      return;
    }

    if (route === '/' || route === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(INDEX_HTML);
      return;
    }

    sendJson(response, 404, { error: { code: 'not_found', message: route } });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_PORT, host, resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? DEFAULT_PORT);

  watcher = watchProject({
    directories: [
      path.join(workspace.projectRoot, WORKSPACE_DIR),
      path.join(workspace.projectRoot, PLANNING_DIR),
    ],
    onChange: () => void push(),
  });

  return {
    url: `http://${host}:${port}`,
    port,
    watching: watcher.watching,
    async close(): Promise<void> {
      watcher?.close();
      // Open streams keep the socket alive; without ending them the process
      // survives SIGINT and the port stays taken.
      for (const client of clients.keys()) client.end();
      clients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
