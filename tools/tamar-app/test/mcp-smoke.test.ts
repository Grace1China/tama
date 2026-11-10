import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig } from '../src/config.js';
import { startHttpServer } from '../src/server.js';

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? '';
}

test('健康检查和三个 MCP 入口可以连接', async () => {
  const port = await freePort();
  assert.ok(port !== 3000 && port !== 3001 && port !== 3011);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tamar-data-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tamar-home-'));
  const config = loadConfig({
    TAMA_DATA_ROOT: dataRoot,
    TAMAR_APP_HOME: home,
    TAMAR_APP_PORT: String(port),
    TAMAR_TAXONOMY_DIR: path.join(FIXTURE_ROOT, 'taxonomies'),
  });
  const http = await startHttpServer(config);
  const client = new Client({ name: 'tamar-app-smoke', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/industry/mcp`));
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await health.json() as {
      display_name: string;
      endpoints: Array<{ name: string; url: string }>;
      read_only: boolean;
    };
    assert.equal(body.display_name, 'tamar App');
    assert.equal(body.read_only, true);
    assert.deepEqual(body.endpoints.map((item) => item.name), ['tamar-industry', 'tamar-contrast', 'tamar-stock']);
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((item) => item.name);
    assert.ok(names.includes('industry_company_lookup'));
    assert.ok(names.includes('industry_price_snapshots'));
    assert.ok(names.includes('industry_auction_snapshots'));
    const looked = JSON.parse(toolText(await client.callTool({
      name: 'industry_company_lookup',
      arguments: { query: '688072' },
    })));
    assert.deepEqual(looked.locations.map((item: { taxonomy_id: string }) => item.taxonomy_id).sort(), ['hbm', 'tao']);
    const auction = JSON.parse(toolText(await client.callTool({
      name: 'industry_auction_snapshots',
      arguments: { ts_code: '688072.SH' },
    })));
    assert.equal(auction.missing, true);
  } finally {
    await client.close().catch(() => undefined);
    await http.close();
  }
});
