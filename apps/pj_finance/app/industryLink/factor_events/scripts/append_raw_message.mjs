#!/usr/bin/env node
import { appendRawMessages, buildRawMessage, parseArgs } from './rawMessageStore.mjs';

function usage() {
  return `Usage:
  node scripts/append_raw_message.mjs --title "消息标题" --content "消息正文或摘要"

Options:
  --source manual
  --source-url https://example.com
  --published-at 2026-06-15T09:00:00+08:00
  --metadata-json '{"author":"me"}'
  --dry-run`;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(usage());
  process.exit(0);
}

if (!args.title) {
  console.error(usage());
  process.exit(1);
}

let metadata;
if (args.metadataJson) {
  try {
    metadata = JSON.parse(args.metadataJson);
  } catch {
    console.error('--metadata-json must be valid JSON');
    process.exit(1);
  }
}

const message = buildRawMessage({
  source: args.source || 'manual',
  source_url: args.sourceUrl,
  title: args.title,
  content: args.content,
  published_at: args.publishedAt,
  metadata,
});

const result = await appendRawMessages([message], { dryRun: Boolean(args.dryRun) });
console.log(
  JSON.stringify(
    {
      ok: true,
      file: result.filePath,
      dryRun: result.dryRun,
      inserted: result.inserted.length,
      duplicates: result.duplicates.length,
      ids: result.inserted.map((row) => row.id),
    },
    null,
    2
  )
);
