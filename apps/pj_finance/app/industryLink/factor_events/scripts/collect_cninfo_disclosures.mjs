#!/usr/bin/env node
import crypto from 'node:crypto';
import { appendRawMessages, buildRawMessage, parseArgs } from './rawMessageStore.mjs';

const BASE_URL = 'https://webapi.cninfo.com.cn';
const SLATKEY_URL = `${BASE_URL}/api/mcode/slatkey`;

function usage() {
  return `Usage:
  node scripts/collect_cninfo_disclosures.mjs --ts-code 000001.SZ
  node scripts/collect_cninfo_disclosures.mjs --scode 000001

Options:
  --max 80
  --dry-run`;
}

function tsCodeToScode(tsCode) {
  const raw = String(tsCode ?? '').trim().toUpperCase();
  const m = raw.match(/^(\d{6})\.(SZ|SH|BJ)$/);
  return m ? m[1] : '';
}

function buildAcceptEnckey(slatkey) {
  const key = Buffer.from(slatkey, 'utf8');
  const iv = Buffer.from(slatkey, 'utf8');
  const payload = Math.floor(Date.now() / 1000).toString();
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  let encrypted = cipher.update(payload, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

async function fetchPInfo3085Json(scode) {
  const slatkeyResp = await fetch(SLATKEY_URL);
  if (!slatkeyResp.ok) throw new Error(`获取 slatkey 失败 HTTP ${slatkeyResp.status}`);
  const slatkey = (await slatkeyResp.text()).trim();
  if (!slatkey) throw new Error('slatkey 为空');

  const acceptEnckey = buildAcceptEnckey(slatkey);
  const url = `${BASE_URL}/api/info/p_info3085?scode=${encodeURIComponent(scode)}`;
  const resp = await fetch(url, {
    headers: {
      'Accept-Enckey': acceptEnckey,
      Referer: `${BASE_URL}/#/dataBrowse`,
      Origin: BASE_URL,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('巨潮接口返回非 JSON');
  }
  if (!resp.ok) throw new Error(`巨潮 HTTP ${resp.status}`);
  if (json.resultcode != null && json.resultcode !== 200) {
    throw new Error(String(json.resultmsg ?? `巨潮 resultcode=${json.resultcode}`));
  }
  return json;
}

function recordToRawMessage(record, context) {
  const title = String(record?.F002V ?? '').trim();
  const publishedAt = String(record?.F001D ?? '').trim();
  const announcementId = String(record?.announcementId ?? record?.F003V ?? record?.id ?? '').trim();
  const sourceUrl =
    announcementId && publishedAt
      ? `https://www.cninfo.com.cn/new/disclosure/detail?stockCode=${context.scode}&announcementId=${encodeURIComponent(
          announcementId
        )}&announcementTime=${encodeURIComponent(publishedAt)}`
      : `https://webapi.cninfo.com.cn/api/info/p_info3085?scode=${context.scode}`;

  return buildRawMessage({
    source: 'cninfo_disclosure',
    source_url: sourceUrl,
    title,
    content: title,
    published_at: publishedAt,
    metadata: {
      ts_code: context.tsCode || undefined,
      scode: context.scode,
      cninfo_record: record,
    },
  });
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(usage());
  process.exit(0);
}

const scode = args.scode ? String(args.scode).trim() : tsCodeToScode(args.tsCode);
const tsCode = args.tsCode ? String(args.tsCode).trim().toUpperCase() : undefined;
const max = Number.isFinite(Number(args.max)) ? Math.max(1, Number(args.max)) : 80;

if (!/^\d{6}$/.test(scode)) {
  console.error(usage());
  process.exit(1);
}

const json = await fetchPInfo3085Json(scode);
const records = Array.isArray(json.records) ? json.records : [];
const messages = records
  .map((record) => recordToRawMessage(record, { scode, tsCode }))
  .filter((message) => message.title)
  .slice(0, max);

const result = await appendRawMessages(messages, { dryRun: Boolean(args.dryRun) });
console.log(
  JSON.stringify(
    {
      ok: true,
      source: 'cninfo_disclosure',
      scode,
      tsCode,
      fetched: messages.length,
      inserted: result.inserted.length,
      duplicates: result.duplicates.length,
      file: result.filePath,
      dryRun: result.dryRun,
    },
    null,
    2
  )
);
