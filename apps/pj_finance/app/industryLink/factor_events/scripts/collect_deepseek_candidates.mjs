#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { buildRawMessage, parseArgs } from './rawMessageStore.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FACTOR_EVENTS_DIR = path.resolve(__dirname, '..');
const INDUSTRY_LINK_DIR = path.resolve(FACTOR_EVENTS_DIR, '..');
const APP_DIR = path.resolve(INDUSTRY_LINK_DIR, '../..');
const FACTOR_DIR = path.join(INDUSTRY_LINK_DIR, 'factor_taxonomy/factors');
const PROMPT_PATH = path.join(FACTOR_EVENTS_DIR, 'prompts/deepseek_candidate_raw_messages.md');
const CANDIDATES_DIR = path.join(FACTOR_EVENTS_DIR, 'candidates');

function usage() {
  return `Usage:
  DEEPSEEK_API_KEY=... node scripts/collect_deepseek_candidates.mjs --factor-id ai_capex --query-scope "海外云厂商资本开支、AI数据中心" --lookback-window "最近30天" --max-items 10

Options:
  --output /tmp/ai_capex_candidates.jsonl
  --model deepseek-v4-pro
  --base-url https://api.deepseek.com
  --dry-run`;
}

function stripCodeFence(text) {
  return String(text ?? '')
    .trim()
    .replace(/^```(?:jsonl|json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function renderPrompt(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? ''));
  }
  return out;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseLookbackDays(text) {
  const m = String(text ?? '').match(/最近\s*(\d+)\s*天/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isWithinLookback(publishedAt, lookbackWindow, now = new Date()) {
  const days = parseLookbackDays(lookbackWindow);
  if (!days) return true;
  if (!publishedAt) return false;
  const t = Date.parse(String(publishedAt).trim());
  if (!Number.isFinite(t)) return false;
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return t >= cutoff.getTime() && t <= now.getTime() + 24 * 60 * 60 * 1000;
}

async function readFactor(factorId) {
  const file = path.join(FACTOR_DIR, `${factorId}.yaml`);
  const content = await fs.readFile(file, 'utf8');
  return YAML.parse(content);
}

async function loadDotEnvLocal() {
  const file = path.join(APP_DIR, '.env.local');
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return;
    throw e;
  }
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key]) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function callDeepSeek({ baseUrl, apiKey, model, prompt }) {
  const base = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            '你是严格的财经数据结构化助手。必须只输出 JSONL，不要输出 Markdown、解释或代码块。',
        },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(Number(process.env.DEEPSEEK_TIMEOUT_MS || 180000)),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  return data?.choices?.[0]?.message?.content ?? '';
}

function parseCandidateJsonl(text) {
  const rows = [];
  for (const [idx, line] of stripCodeFence(text).split(/\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      throw new Error(`DeepSeek returned invalid JSONL at line ${idx + 1}: ${trimmed.slice(0, 160)}`);
    }
  }
  return rows;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(usage());
  process.exit(0);
}

const factorId = String(args.factorId || '').trim();
if (!/^[a-z0-9_]+$/.test(factorId)) {
  console.error(usage());
  process.exit(1);
}

await loadDotEnvLocal();

const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
if (!apiKey && !args.dryRun) {
  throw new Error('Missing DEEPSEEK_API_KEY');
}

const factor = await readFactor(factorId);
const template = await fs.readFile(PROMPT_PATH, 'utf8');
const lookbackWindow = args.lookbackWindow || '最近30天';
const prompt = renderPrompt(template, {
  factor_id: factorId,
  factor_label: factor.label || factorId,
  factor_definition: factor.definition || '',
  factor_observables: Array.isArray(factor.observables) ? factor.observables.join('；') : '',
  query_scope: args.queryScope || factor.aliases?.join('、') || factor.label || factorId,
  current_date: todayIsoDate(),
  lookback_window: lookbackWindow,
  max_items: args.maxItems || '10',
});

const output =
  args.output ||
  path.join(CANDIDATES_DIR, `${factorId}_raw_messages.candidates.jsonl`);

if (args.dryRun) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: true,
        factorId,
        output,
        prompt,
      },
      null,
      2
    )
  );
  process.exit(0);
}

const raw = await callDeepSeek({
  baseUrl: String(args.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'),
  apiKey,
  model: String(args.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro'),
  prompt,
});

const parsedRows = parseCandidateJsonl(raw);
const staleRows = parsedRows.filter((row) => !isWithinLookback(row.published_at, lookbackWindow));
const freshRows = parsedRows.filter((row) => isWithinLookback(row.published_at, lookbackWindow));
const candidates = freshRows.map((row) =>
  buildRawMessage({
    source: row.source || 'deepseek_candidates',
    source_url: row.source_url,
    title: row.title,
    content: row.content,
    published_at: row.published_at,
    metadata: {
      ...(row.metadata || {}),
      factor_id: row.metadata?.factor_id || factorId,
      verification_status: row.metadata?.verification_status || 'unverified',
      deepseek_candidate_count_before_date_filter: parsedRows.length,
      deepseek_stale_candidate_count: staleRows.length,
    },
  })
);

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, candidates.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');

console.log(
  JSON.stringify(
    {
      ok: true,
      factorId,
      output,
      candidates: candidates.length,
      rejectedByDateFilter: staleRows.length,
    },
    null,
    2
  )
);
