import fs from 'node:fs';
import type { AppConfig } from './config.js';
import { parseCsv } from './csv.js';
import { existingFile } from './paths.js';
import { freshness } from './freshness.js';
import { dateDigits } from './time.js';

const TTL_MS = 24 * 60 * 60 * 1000;

export type ReportLink = {
  kind: string;
  label: string;
  year: number;
  title: string;
  announce_date: string;
  url: string;
  fetched_at: string;
};

export function readReportLinks(config: AppConfig, tsCode: string) {
  const file = existingFile(config, 'reportLinks');
  if (!file) {
    return {
      ts_code: tsCode,
      links: [] as ReportLink[],
      cached: false,
      ...freshness({ asOf: null, source: 'cninfo/report_links_v2.csv', missing: true, compareToSession: false }),
    };
  }
  const rows = parseCsv(fs.readFileSync(file.absolute, 'utf8'));
  const links: ReportLink[] = [];
  let newestFetch = 0;
  for (const row of rows) {
    if (String(row.ts_code ?? '').trim().toUpperCase() !== tsCode) continue;
    const fetched = Date.parse(String(row.fetched_at ?? ''));
    if (Number.isFinite(fetched) && fetched > newestFetch) newestFetch = fetched;
    links.push({
      kind: String(row.kind ?? ''),
      label: String(row.label ?? ''),
      year: Number(row.year) || 0,
      title: String(row.title ?? ''),
      announce_date: String(row.announce_date ?? ''),
      url: String(row.url ?? ''),
      fetched_at: String(row.fetched_at ?? ''),
    });
  }
  const cachedStale = newestFetch > 0 && Date.now() - newestFetch > TTL_MS;
  const asOf = dateDigits(links.map((link) => link.announce_date).sort().at(-1) ?? null);
  const stamp = freshness({
    asOf: asOf || (newestFetch ? new Date(newestFetch).toISOString().slice(0, 10).replace(/-/g, '') : null),
    source: file.relative,
    missing: links.length === 0,
    compareToSession: false,
  });
  return {
    ts_code: tsCode,
    links,
    cached: true,
    ...stamp,
    stale: stamp.stale || cachedStale || links.length === 0,
    note: links.length === 0 ? stamp.note : cachedStale ? '报告链接缓存超过 24 小时，仍是上次抽取的结果。' : stamp.note,
  };
}
