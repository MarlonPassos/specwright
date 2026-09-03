import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { buildDashboard } from '../core/dashboard.js';
import { buildOverview } from '../core/overview.js';
import { computeProjectStatus, statusPayload } from '../core/project/status.js';
import { recommendNext } from '../core/project/next.js';
import { listPlanIds } from '../core/project/paths.js';
import { dashboardEnvelope, overviewEnvelope } from '../core/contract.js';
import { WORKSPACE_DIR, type Workspace } from '../core/workspace.js';
import { PLANNING_DIR } from '../core/project/paths.js';
import { watchProject, type ProjectWatcher } from './watcher.js';
import { INDEX_HTML } from './ui.js';

export const DEFAULT_PORT = 4477;

export interface ServeOptions {
  port?: number;
  /** Loopback by default: the panel exposes project content (I-2). */
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
  return {
    overview: async () => overviewEnvelope(await buildOverview(workspace, { planId })),
    changes: async () => dashboardEnvelope(await buildDashboard(workspace)),
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
  };
}

export async function startServer(
  workspace: Workspace,
  options: ServeOptions = {}
): Promise<RunningServer> {
  const host = options.host ?? '127.0.0.1';
  const routes = await projections(workspace, options.planId);
  const clients = new Set<ServerResponse>();
  let watcher: ProjectWatcher | undefined;

  const push = async (): Promise<void> => {
    if (clients.size === 0) return;
    let frame: string;
    try {
      frame = JSON.stringify(await routes.overview());
    } catch {
      // A projection that fails mid-flight must not kill the stream: the reader
      // keeps the last good frame until the next settled change.
      return;
    }
    for (const client of clients) client.write(`event: overview\ndata: ${frame}\n\n`);
  };

  const server: Server = http.createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', `http://${host}`);
    const route = url.pathname;

    // Read-only surface, stated in the protocol itself (I-1).
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: { code: 'read_only', message: 'O painel é somente leitura.' } });
      return;
    }

    if (route === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      response.write(': ok\n\n');
      clients.add(response);
      // Without a heartbeat a proxy or a sleeping laptop drops the stream and
      // the page shows stale data believing it is live.
      const beat = setInterval(() => response.write(': beat\n\n'), 30_000);
      beat.unref?.();
      request.on('close', () => {
        clearInterval(beat);
        clients.delete(response);
      });
      void routes.overview().then((data) => {
        response.write(`event: overview\ndata: ${JSON.stringify(data)}\n\n`);
      });
      return;
    }

    const handler =
      route === '/api/overview' ? routes.overview
      : route === '/api/changes' ? routes.changes
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
      for (const client of clients) client.end();
      clients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
