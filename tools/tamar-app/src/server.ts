import fs from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { AppConfig } from './config.js';
import { contrastTools } from './contrastTools.js';
import { industryTools } from './industryTools.js';
import { SafeError, jsonText } from './safety.js';
import { stockTools } from './stockTools.js';

export type EntryName = 'industry' | 'contrast' | 'stock';

type ToolModule = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (config: AppConfig, args: Record<string, unknown>) => Promise<unknown>;
};

const ENTRIES: Record<EntryName, { serverName: string; label: string; path: string; tools: ToolModule[] }> = {
  industry: { serverName: 'tamar-industry', label: '产业链', path: '/industry/mcp', tools: industryTools },
  contrast: { serverName: 'tamar-contrast', label: '财务指标对比分析', path: '/contrast/mcp', tools: contrastTools },
  stock: { serverName: 'tamar-stock', label: '个股详情', path: '/stock/mcp', tools: stockTools },
};

export function entryCatalog() {
  return Object.entries(ENTRIES).map(([id, entry]) => ({
    id,
    name: entry.serverName,
    label: entry.label,
    path: entry.path,
    tools: entry.tools.map((item) => item.name),
  }));
}

function logLine(config: AppConfig, message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  const dir = path.join(config.home, 'log');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'server.log'), line);
}

export function createEntryServer(config: AppConfig, entryName: EntryName): Server {
  const entry = ENTRIES[entryName];
  const byName = new Map(entry.tools.map((item) => [item.name, item]));
  const server = new Server({ name: entry.serverName, version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: entry.tools.map((item) => ({
      name: item.name,
      description: item.description,
      inputSchema: item.inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const started = Date.now();
    const tool = byName.get(request.params.name);
    if (!tool) {
      return { content: [{ type: 'text' as const, text: jsonText({ error: 'unknown_tool' }) }], isError: true };
    }
    try {
      const args = request.params.arguments ?? {};
      const result = await tool.handler(config, args);
      logLine(config, `tool ${entryName} ${request.params.name} ok ${Date.now() - started}ms`);
      return { content: [{ type: 'text' as const, text: jsonText(result) }] };
    } catch (error) {
      const message = error instanceof SafeError ? error.message : error instanceof Error ? error.message : 'tool_failed';
      logLine(config, `tool ${entryName} ${request.params.name} error ${Date.now() - started}ms ${message}`);
      return { content: [{ type: 'text' as const, text: jsonText({ error: message }) }], isError: true };
    }
  });
  return server;
}

function bearerAuth(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.token) return next();
    if (req.header('authorization') !== `Bearer ${config.token}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

type ActiveSession = { server: Server; transport: StreamableHTTPServerTransport };

function mountMcp(app: ReturnType<typeof createMcpExpressApp>, config: AppConfig, entryName: EntryName) {
  const route = ENTRIES[entryName].path;
  const sessions = new Map<string, ActiveSession>();
  app.post(route, async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    try {
      if (sessionId) {
        const active = sessions.get(sessionId);
        if (!active) {
          res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'MCP session not found' }, id: null });
          return;
        }
        await active.transport.handleRequest(req, res, req.body);
        return;
      }
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Missing MCP session ID or initialize request' }, id: null });
        return;
      }
      const server = createEntryServer(config, entryName);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { server, transport });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logLine(config, `http ${entryName} ${error instanceof Error ? error.message : 'request_failed'}`);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });
  app.get(route, async (req, res) => {
    const active = sessions.get(req.header('mcp-session-id') ?? '');
    if (!active) {
      res.status(404).send('MCP session not found');
      return;
    }
    await active.transport.handleRequest(req, res);
  });
  app.delete(route, async (req, res) => {
    const active = sessions.get(req.header('mcp-session-id') ?? '');
    if (!active) {
      res.status(404).send('MCP session not found');
      return;
    }
    await active.transport.handleRequest(req, res);
  });
  return async () => {
    for (const [id, active] of sessions) {
      await active.transport.close().catch(() => undefined);
      await active.server.close().catch(() => undefined);
      sessions.delete(id);
    }
  };
}

export async function startHttpServer(config: AppConfig): Promise<{ close: () => Promise<void> }> {
  const app = createMcpExpressApp({ host: config.host, allowedHosts: ['127.0.0.1', 'localhost'] });
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'tamar-app',
      display_name: 'tamar App',
      status: 'ok',
      transport: 'streamable-http',
      bind: config.host,
      port: config.port,
      read_only: true,
      data_root: config.dataRoot,
      taxonomy_dir: config.taxonomyDir,
      endpoints: entryCatalog().map((entry) => ({
        name: entry.name,
        label: entry.label,
        url: `http://${config.host}:${config.port}${entry.path}`,
      })),
    });
  });
  for (const name of Object.keys(ENTRIES) as EntryName[]) {
    app.use(ENTRIES[name].path, bearerAuth(config));
  }
  const closers = (Object.keys(ENTRIES) as EntryName[]).map((name) => mountMcp(app, config, name));
  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => resolve(server));
    server.on('error', reject);
  });
  const close = async () => {
    for (const closer of closers) await closer();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  };
  logLine(config, `listen http://${config.host}:${config.port}`);
  console.error(`[tamar-app] http://${config.host}:${config.port}`);
  return { close };
}
