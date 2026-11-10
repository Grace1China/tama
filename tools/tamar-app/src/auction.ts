import fs from 'node:fs';
import type { AppConfig } from './config.js';
import { freshness } from './freshness.js';
import { dateDigits, maxDate } from './time.js';

type AuctionRow = {
  ts_code?: unknown;
  snapshot_at?: unknown;
  received_at?: unknown;
  last_price?: unknown;
  pre_close?: unknown;
  pct_chg?: unknown;
  volume?: unknown;
  amount?: unknown;
  source?: unknown;
  status?: unknown;
};

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function readAuctionSnapshots(config: AppConfig, tsCodes: string[]) {
  const source = config.auctionExpected ?? 'auction/latest.json';
  if (!config.auctionFile) {
    return {
      rows: [],
      ...freshness({ asOf: null, source, missing: true, compareToSession: false }),
      note: '集合竞价 latest.json 目前不存在。',
    };
  }
  const data = JSON.parse(fs.readFileSync(config.auctionFile, 'utf8')) as Record<string, AuctionRow>;
  const rows = tsCodes.flatMap((code) => {
    const row = data[code];
    if (!row) return [];
    return [{
      ts_code: code,
      snapshot_at: String(row.snapshot_at ?? ''),
      received_at: String(row.received_at ?? ''),
      last_price: num(row.last_price),
      pre_close: num(row.pre_close),
      pct_chg: num(row.pct_chg),
      volume: num(row.volume),
      amount: num(row.amount),
      source: String(row.source ?? 'myquant'),
      status: String(row.status ?? 'unknown'),
      unit: { pct_chg: '%', scale: 'percent', amount: 'CNY', amount_scale: 'yuan' },
    }];
  });
  const asOf = maxDate(rows.map((row) => dateDigits(row.snapshot_at)));
  const stamp = freshness({
    asOf,
    source,
    missing: rows.length === 0,
    compareToSession: true,
  });
  return { rows, ...stamp };
}
