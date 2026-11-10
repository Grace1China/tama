import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';
import { symbolOf } from './codes.js';
import { freshness } from './freshness.js';

const BASE_URL = 'https://webapi.cninfo.com.cn';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type DisclosureRecord = Record<string, string | number | null>;

function buildAcceptEnckey(slatkey: string): string {
  const key = Buffer.from(slatkey, 'utf8');
  const iv = Buffer.from(slatkey, 'utf8');
  const payload = Math.floor(Date.now() / 1000).toString();
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  let encrypted = cipher.update(payload, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function cachePath(config: AppConfig, scode: string): string {
  return path.join(config.home, 'cache', 'cninfo', `${scode}.json`);
}

function readCache(config: AppConfig, scode: string): { fetched_at: number; records: DisclosureRecord[] } | null {
  const file = cachePath(config, scode);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { fetched_at?: number; records?: DisclosureRecord[] };
    if (!parsed || !Array.isArray(parsed.records) || !Number.isFinite(parsed.fetched_at)) return null;
    return { fetched_at: Number(parsed.fetched_at), records: parsed.records };
  } catch {
    return null;
  }
}

function writeCache(config: AppConfig, scode: string, records: DisclosureRecord[]): void {
  const file = cachePath(config, scode);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ fetched_at: Date.now(), records }));
}

async function fetchRecords(scode: string): Promise<DisclosureRecord[]> {
  const slatkeyResp = await fetch(`${BASE_URL}/api/mcode/slatkey`);
  if (!slatkeyResp.ok) throw new Error(`获取 slatkey 失败 HTTP ${slatkeyResp.status}`);
  const slatkey = (await slatkeyResp.text()).trim();
  if (!slatkey) throw new Error('slatkey 为空');
  const resp = await fetch(`${BASE_URL}/api/info/p_info3085?scode=${encodeURIComponent(scode)}`, {
    headers: {
      'Accept-Enckey': buildAcceptEnckey(slatkey),
      Referer: `${BASE_URL}/#/dataBrowse`,
      Origin: BASE_URL,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  const text = await resp.text();
  if (text.includes('验证') && !text.trim().startsWith('{')) {
    throw new Error('cninfo_challenge');
  }
  const json = JSON.parse(text) as { records?: DisclosureRecord[] };
  if (!resp.ok) throw new Error(`巨潮 HTTP ${resp.status}`);
  return Array.isArray(json.records) ? json.records : [];
}

/** 读取巨潮 p_info3085。缓存只写本服务 var/，不写数据根。 */
export async function loadDisclosures(config: AppConfig, tsCode: string, limit: number) {
  const scode = symbolOf(tsCode);
  const cached = readCache(config, scode);
  const fresh = cached != null && Date.now() - cached.fetched_at < CACHE_TTL_MS;
  if (fresh && cached) {
    return {
      ts_code: tsCode,
      scode,
      records: cached.records.slice(0, limit),
      fields: ['F001D 公告日期', 'F002V 标题', 'F003V 链接', 'F004V 文件格式'],
      ...freshness({
        asOf: new Date(cached.fetched_at).toISOString().slice(0, 10).replace(/-/g, ''),
        source: 'var/cache/cninfo',
        compareToSession: false,
      }),
      cached: true,
    };
  }
  try {
    const records = await fetchRecords(scode);
    writeCache(config, scode, records);
    const stamp = freshness({
      asOf: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      source: 'cninfo:p_info3085',
      compareToSession: false,
    });
    return {
      ts_code: tsCode,
      scode,
      records: records.slice(0, limit),
      fields: ['F001D 公告日期', 'F002V 标题', 'F003V 链接', 'F004V 文件格式'],
      ...stamp,
      cached: false,
      missing: records.length === 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cninfo_failed';
    if (cached) {
      return {
        ts_code: tsCode,
        scode,
        records: cached.records.slice(0, limit),
        error: message,
        ...freshness({
          asOf: new Date(cached.fetched_at).toISOString().slice(0, 10).replace(/-/g, ''),
          source: 'var/cache/cninfo',
          compareToSession: false,
        }),
        stale: true,
        cached: true,
        note: '巨潮本次没有返回，下面是本服务缓存，不是刚刚抓取的结果。',
      };
    }
    return {
      ts_code: tsCode,
      scode,
      records: [],
      error: message,
      ...freshness({ asOf: null, source: 'cninfo:p_info3085', missing: true, compareToSession: false }),
    };
  }
}
