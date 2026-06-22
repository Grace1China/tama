#!/usr/bin/env node
import fs from 'node:fs/promises';
import { appendRawMessages, buildRawMessage, parseArgs } from './rawMessageStore.mjs';

function usage() {
  return `Usage:
  node scripts/append_raw_messages_jsonl.mjs --input /path/to/raw_messages.jsonl

Options:
  --source llm_web_search
  --dry-run`;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(usage());
  process.exit(0);
}

if (!args.input) {
  console.error(usage());
  process.exit(1);
}

const text = await fs.readFile(args.input, 'utf8');
const rows = [];
for (const [idx, line] of text.split(/\n/).entries()) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let row;
  try {
    row = JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid JSONL at line ${idx + 1}`);
  }
  rows.push(
    buildRawMessage({
      source: row.source || args.source || 'llm_web_search',
      source_url: row.source_url,
      title: row.title,
      content: row.content,
      published_at: row.published_at,
      metadata: row.metadata,
    })
  );
}

const result = await appendRawMessages(rows, { dryRun: Boolean(args.dryRun) });
console.log(
  JSON.stringify(
    {
      ok: true,
      file: result.filePath,
      dryRun: result.dryRun,
      parsed: rows.length,
      inserted: result.inserted.length,
      duplicates: result.duplicates.length,
      ids: result.inserted.map((row) => row.id),
    },
    null,
    2
  )
);
