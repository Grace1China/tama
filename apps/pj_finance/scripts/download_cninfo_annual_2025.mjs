#!/usr/bin/env node
/**
 * M1（本地 API 版）：通信一级（801770.SI）成分 → p_info3085 → 勾选「2025 年报全文」PDF → 落到 temp/cninfo/report/
 *
 * 前置：Next dev 已在 base-url 跑着，且 parquet 成员表可用。
 *
 * @example
 *   cd apps/pj_finance
 *   node scripts/download_cninfo_annual_2025.mjs --base-url http://127.0.0.1:3000 --max-stocks 3
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PJ_FIN_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPORT_DIR = path.join(PJ_FIN_ROOT, 'temp', 'cninfo', 'report');

/** Tushare 代码 → 巨潮 6 位 scode */
function tsCodeToScode(tsCode) {
  const s = String(tsCode ?? '')
    .trim()
    .toUpperCase();
  const m = s.match(/^(\d{6})\.(SZ|SH|BJ)$/);
  if (m) return m[1];
  const digits = s.replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(0, 6) : null;
}

function isPdfRecord(r) {
  const fmt = String(r.F004V ?? '').toUpperCase();
  const url = String(r.F003V ?? '');
  return fmt.includes('PDF') && /^https?:\/\//i.test(url);
}

/**
 * 从巨潮 disclosure 中选「面向 2025 会计年度」的年报正文 PDF：
 * - 标题含 2025 与 年报类关键词；
 * - 排除摘要 / 英文等。
 */
function pickAnnualReport2025Pdf(records) {
  const annualRe = /年报|年度报告/;
  const yearRe = /(2025|二〇二五)/;
  const excludeRe = /摘要|英文版|English|临时公告/;
  /** @type {{ t: number; rec: Record<string, unknown> }[]} */
  const cand = [];

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const title = String(rec.F002V ?? '').trim();
    if (!annualRe.test(title) || !yearRe.test(title)) continue;
    if (excludeRe.test(title)) continue;
    if (!isPdfRecord(rec)) continue;
    const d = String(rec.F001D ?? '')
      .replace(/\//g, '-')
      .slice(0, 10);
    let t = 0;
    if (d.length === 10) {
      const p = Date.parse(d);
      if (Number.isFinite(p)) t = p;
    }
    cand.push({ t, rec });
  }
  if (cand.length === 0) return null;
  cand.sort((a, b) => b.t - a.t);
  return cand[0].rec;
}

function safeFilePart(s, maxLen = 64) {
  return String(s)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[/\\:*?"<>|]/g, '')
    .slice(0, maxLen)
    .replace(/^\.+|\.+$/g, '');
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (cninfo-batch)',
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    const err = typeof json === 'object' && json?.error ? json.error : text.slice(0, 200);
    throw new Error(`HTTP ${res.status} ${url}: ${err}`);
  }
  return json;
}

async function downloadPdf(destPath, pdfUrl) {
  const res = await fetch(pdfUrl, {
    headers: {
      Referer: 'https://www.cninfo.com.cn/',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!res.ok) {
    throw new Error(`PDF HTTP ${res.status}`);
  }
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const fileStream = fs.createWriteStream(destPath);
  await pipeline(res.body, fileStream);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {
    '--base-url': 'http://127.0.0.1:3000',
    '--code': '801770.SI',
    '--level': 'L1',
    '--max-stocks': '500',
    '--delay-ms': '400',
    '--dry-run': false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--dry-run') {
      out[k] = true;
      continue;
    }
    if (k.startsWith('--') && v && !v.startsWith('--')) {
      out[k] = v;
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const base = String(args['--base-url'] ?? '').replace(/\/+$/, '');
  const code = String(args['--code'] ?? '').trim().toUpperCase();
  const level = String(args['--level'] ?? 'L1').trim().toUpperCase();
  const maxStocks = Math.max(1, parseInt(String(args['--max-stocks'] ?? '500'), 10) || 500);
  const delayMs = Math.max(0, parseInt(String(args['--delay-ms'] ?? '400'), 10) || 400);
  const dryRun = args['--dry-run'] === true;

  fs.mkdirSync(REPORT_DIR, { recursive: true });

  /** @type {string[]} */
  const tsCodes = [];
  const seen = new Set();
  let page = 1;
  while (tsCodes.length < maxStocks) {
    const pageSize = Math.min(500, maxStocks - tsCodes.length);
    const membersUrl = new URL('/api/parq/sw2021/members', base);
    membersUrl.searchParams.set('level', level);
    membersUrl.searchParams.set('code', code);
    membersUrl.searchParams.set('page', String(page));
    membersUrl.searchParams.set('size', String(pageSize));

    if (page === 1) console.error(`# 拉成分: ${membersUrl.toString()}`);
    const memJson = await fetchJson(membersUrl.toString());
    const rows = Array.isArray(memJson?.data) ? memJson.data : [];
    if (rows.length === 0) break;

    let added = false;
    for (const row of rows) {
      const tc = String(row?.ts_code ?? row?.TS_CODE ?? '')
        .trim()
        .toUpperCase();
      if (!/^(\d{6})\.(SZ|SH|BJ)$/.test(tc)) continue;
      if (seen.has(tc)) continue;
      seen.add(tc);
      tsCodes.push(tc);
      added = true;
      if (tsCodes.length >= maxStocks) break;
    }
    if (!added || rows.length < pageSize) break;
    page++;
    await sleep(delayMs);
  }

  console.error(`# 待处理 ts_code ${tsCodes.length} 条（最多 ${maxStocks}），输出目录 ${REPORT_DIR} dry-run=${dryRun}`);
  /** @type {Record<string, unknown>[]} */
  const manifest = [];

  for (let i = 0; i < tsCodes.length; i++) {
    const tsCode = tsCodes[i];
    const scode = tsCodeToScode(tsCode);
    if (!scode) continue;
    if (delayMs > 0) await sleep(delayMs);

    let j;
    try {
      const u = new URL('/api/cninfo/p-info3085', base);
      u.searchParams.set('scode', scode);
      j = await fetchJson(u.toString());
    } catch (e) {
      manifest.push({ ts_code: tsCode, scode, ok: false, err: String(e) });
      console.error(`[${i + 1}/${tsCodes.length}] ${tsCode} p_info3085 失败 ${e}`);
      continue;
    }

    const records = Array.isArray(j.records) ? j.records : [];
    const picked = pickAnnualReport2025Pdf(records);
    if (!picked) {
      manifest.push({ ts_code: tsCode, scode, ok: false, err: '无 2025 年报正文 PDF（或仅有摘要/非 PDF）' });
      console.error(`[${i + 1}/${tsCodes.length}] ${tsCode} 无匹配 2025 年报 PDF`);
      continue;
    }

    const title = String(picked.F002V ?? '');
    const pdfUrl = String(picked.F003V ?? '');
    const announceDate = String(picked.F001D ?? '').slice(0, 16);
    const slug = crypto.createHash('sha1').update(`${pdfUrl}\n${title}`).digest('hex').slice(0, 12);
    const fn = `${tsCode}_${slug}_${safeFilePart(title)}.pdf`;
    const destPath = path.join(REPORT_DIR, fn);

    if (dryRun) {
      manifest.push({
        ts_code: tsCode,
        scode,
        ok: true,
        announce_date: announceDate,
        title,
        pdf_url: pdfUrl,
        save_path: destPath,
        dry_run: true,
      });
      console.error(`[dry-run][${i + 1}/${tsCodes.length}] ${tsCode} → ${announceDate} ${title.slice(0, 40)}...`);
      continue;
    }

    try {
      if (delayMs > 0) await sleep(delayMs);
      await downloadPdf(destPath, pdfUrl);
      const st = fs.statSync(destPath);
      manifest.push({
        ts_code: tsCode,
        scode,
        ok: true,
        announce_date: announceDate,
        title,
        pdf_url: pdfUrl,
        bytes: st.size,
        save_path: path.relative(PJ_FIN_ROOT, destPath),
      });
      console.error(`[${i + 1}/${tsCodes.length}] OK ${tsCode} ${announceDate} ${(st.size / 1e6).toFixed(2)} MiB`);
    } catch (e) {
      manifest.push({
        ts_code: tsCode,
        scode,
        ok: false,
        pdf_url: pdfUrl,
        err: String(e),
      });
      console.error(`[${i + 1}/${tsCodes.length}] 下载失败 ${tsCode}: ${e}`);
    }
  }

  const mf = path.join(REPORT_DIR, 'manifest_annual_2025.json');
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 2), 'utf8');
  console.error(`# manifest 写入 ${mf}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
