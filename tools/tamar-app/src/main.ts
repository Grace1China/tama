import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createEntryServer, startHttpServer, type EntryName } from './server.js';

const config = loadConfig();
const mode = (process.env.TAMAR_APP_TRANSPORT ?? 'http').toLowerCase();

if (mode === 'http') {
  void startHttpServer(config).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
} else if (mode === 'stdio') {
  const entry = (process.env.TAMAR_APP_STDIO_ENTRY ?? '').trim() as EntryName;
  if (entry !== 'industry' && entry !== 'contrast' && entry !== 'stock') {
    console.error('TAMAR_APP_STDIO_ENTRY 只能是 industry、contrast 或 stock');
    process.exit(1);
  }
  const server = createEntryServer(config, entry);
  void server.connect(new StdioServerTransport()).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
} else {
  console.error('TAMAR_APP_TRANSPORT 只能是 http 或 stdio');
  process.exit(1);
}
