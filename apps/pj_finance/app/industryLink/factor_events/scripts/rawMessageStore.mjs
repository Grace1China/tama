import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FACTOR_EVENTS_DIR = path.resolve(__dirname, '..');
export const RAW_MESSAGES_PATH = path.join(FACTOR_EVENTS_DIR, 'data/raw_messages.jsonl');

export function formatDateId(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function sha256Short(input, len = 12) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, len);
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function buildRawHash(input) {
  const payload = [
    normalizeText(input.source),
    normalizeText(input.source_url),
    normalizeText(input.title),
    normalizeText(input.published_at),
    normalizeText(input.content),
  ].join('\n');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function buildRawMessage(input, now = new Date()) {
  const raw_hash = input.raw_hash || buildRawHash(input);
  return {
    id: input.id || `raw_${formatDateId(now)}_${raw_hash.slice(0, 10)}`,
    source: normalizeText(input.source),
    ...(input.source_url ? { source_url: normalizeText(input.source_url) } : {}),
    title: normalizeText(input.title),
    ...(input.content ? { content: String(input.content).trim() } : {}),
    ...(input.published_at ? { published_at: normalizeText(input.published_at) } : {}),
    fetched_at: input.fetched_at || now.toISOString(),
    raw_hash,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export async function readExistingRawHashes(filePath = RAW_MESSAGES_PATH) {
  const hashes = new Set();
  try {
    const text = await fs.readFile(filePath, 'utf8');
    for (const line of text.split(/\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const row = JSON.parse(trimmed);
      if (row.raw_hash) hashes.add(String(row.raw_hash));
    }
  } catch (e) {
    if (e && e.code === 'ENOENT') return hashes;
    throw e;
  }
  return hashes;
}

export async function appendRawMessages(messages, options = {}) {
  const filePath = options.filePath || RAW_MESSAGES_PATH;
  const dryRun = Boolean(options.dryRun);
  const existingHashes = await readExistingRawHashes(filePath);
  const inserted = [];
  const duplicates = [];

  for (const message of messages) {
    if (existingHashes.has(message.raw_hash)) {
      duplicates.push(message);
      continue;
    }
    existingHashes.add(message.raw_hash);
    inserted.push(message);
  }

  if (!dryRun && inserted.length > 0) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, inserted.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  }

  return { inserted, duplicates, filePath, dryRun };
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}
