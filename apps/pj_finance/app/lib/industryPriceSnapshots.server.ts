// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

import { buildLatestAdjCte, getQfqSourcePaths } from '@/app/lib/qfqDailyQuery';

export type IndustryPriceSnapshotRow = {
  ts_code: string;
  trade_date: string;
  close: number | null;
  d1: number | null;
  d5: number | null;
  d20: number | null;
  d60: number | null;
};

function queryRows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();
    conn.all(sql, (err: Error | null, rows: unknown) => {
      conn.close();
      db.close();
      if (err) {
        reject(err);
        return;
      }
      resolve(Array.isArray(rows) ? (rows as T[]) : []);
    });
  });
}

export function normalizeTsCodes(rawCodes: Iterable<string>, maxCodes?: number): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const raw of rawCodes) {
    const code = String(raw).trim().toUpperCase();
    if (!/^\d{6}\.(SZ|SH|BJ)$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (maxCodes != null && codes.length >= maxCodes) break;
  }
  return codes;
}

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function queryIndustryPriceSnapshots(
  rawCodes: Iterable<string>,
): Promise<IndustryPriceSnapshotRow[]> {
  const tsCodes = normalizeTsCodes(rawCodes);
  if (tsCodes.length === 0) return [];

  const { bfq, adj } = getQfqSourcePaths();
  const inCodes = tsCodes.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');
  const sql = `
    WITH ${buildLatestAdjCte(adj, tsCodes)},
    ranked AS (
      SELECT
        b.ts_code,
        b.trade_date,
        b.close * a.adj_factor / l.latest_adj AS close,
        b.pre_close * a.adj_factor / l.latest_adj AS pre_close,
        b.pct_chg,
        ROW_NUMBER() OVER (PARTITION BY b.ts_code ORDER BY b.trade_date DESC) AS rn
      FROM read_parquet('${bfq}') b
      INNER JOIN read_parquet('${adj}') a
        ON b.ts_code = a.ts_code AND b.trade_date = a.trade_date
      INNER JOIN latest_adj l ON b.ts_code = l.ts_code
      WHERE b.ts_code IN (${inCodes})
        AND b.close IS NOT NULL
    ),
    pivoted AS (
      SELECT
        ts_code,
        MAX(CASE WHEN rn = 1 THEN strftime(trade_date, '%Y%m%d') END) AS trade_date,
        MAX(CASE WHEN rn = 1 THEN close END) AS latest_close,
        MAX(CASE WHEN rn = 1 THEN pre_close END) AS pre_close,
        MAX(CASE WHEN rn = 1 THEN pct_chg END) AS pct_chg,
        MAX(CASE WHEN rn = 2 THEN close END) AS close_1d,
        MAX(CASE WHEN rn = 6 THEN close END) AS close_5d,
        MAX(CASE WHEN rn = 21 THEN close END) AS close_20d,
        MAX(CASE WHEN rn = 61 THEN close END) AS close_60d
      FROM ranked
      WHERE rn <= 61
      GROUP BY ts_code
    )
    SELECT
      ts_code,
      trade_date,
      latest_close AS close,
      CASE
        WHEN pct_chg IS NOT NULL THEN pct_chg
        WHEN pre_close IS NOT NULL AND pre_close != 0 THEN (latest_close / pre_close - 1) * 100.0
        WHEN close_1d IS NOT NULL AND close_1d != 0 THEN (latest_close / close_1d - 1) * 100.0
        ELSE NULL
      END AS d1,
      CASE WHEN close_5d IS NOT NULL AND close_5d != 0 THEN (latest_close / close_5d - 1) * 100.0 ELSE NULL END AS d5,
      CASE WHEN close_20d IS NOT NULL AND close_20d != 0 THEN (latest_close / close_20d - 1) * 100.0 ELSE NULL END AS d20,
      CASE WHEN close_60d IS NOT NULL AND close_60d != 0 THEN (latest_close / close_60d - 1) * 100.0 ELSE NULL END AS d60
    FROM pivoted
    ORDER BY ts_code ASC
  `;

  const rows = await queryRows<IndustryPriceSnapshotRow>(sql);
  return rows.map((row) => ({
    ts_code: String(row.ts_code ?? '').toUpperCase(),
    trade_date: String(row.trade_date ?? ''),
    close: finiteOrNull(row.close),
    d1: finiteOrNull(row.d1),
    d5: finiteOrNull(row.d5),
    d20: finiteOrNull(row.d20),
    d60: finiteOrNull(row.d60),
  }));
}
