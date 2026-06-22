import fs from 'fs';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

export const dynamic = 'force-dynamic';

const DAILY_FILE = path.join(process.cwd(), 'temp/tuShare/sw_daily.parquet');
const MAX_CODES = 800;

type PriceSnapshotRow = {
  ts_code: string;
  trade_date: string;
  close: number | null;
  d1: number | null;
  d5: number | null;
  d20: number | null;
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

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanIndexCodes(raw: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const part of raw.split(',')) {
    const code = part.trim().toUpperCase();
    if (!/^\d+\.SI$/.test(code)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= MAX_CODES) break;
  }
  return codes;
}

export async function GET(request: NextRequest) {
  try {
    if (!fs.existsSync(DAILY_FILE)) {
      return NextResponse.json(
        { error: 'Parquet file not found', message: `File not found: ${DAILY_FILE}` },
        { status: 404 },
      );
    }

    const tsCodes = cleanIndexCodes(String(request.nextUrl.searchParams.get('ts_codes') ?? ''));
    const filePath = path.resolve(DAILY_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const codeFilter =
      tsCodes.length > 0
        ? `AND ts_code IN (${tsCodes.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ')})`
        : '';

    const sql = `
      WITH ranked AS (
        SELECT
          ts_code,
          trade_date,
          close,
          pct_change,
          ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS rn
        FROM read_parquet('${filePath}')
        WHERE close IS NOT NULL
          ${codeFilter}
      ),
      pivoted AS (
        SELECT
          ts_code,
          MAX(CASE WHEN rn = 1 THEN trade_date END) AS trade_date,
          MAX(CASE WHEN rn = 1 THEN close END) AS latest_close,
          MAX(CASE WHEN rn = 1 THEN pct_change END) AS pct_change,
          MAX(CASE WHEN rn = 2 THEN close END) AS close_1d,
          MAX(CASE WHEN rn = 6 THEN close END) AS close_5d,
          MAX(CASE WHEN rn = 21 THEN close END) AS close_20d
        FROM ranked
        WHERE rn <= 21
        GROUP BY ts_code
      )
      SELECT
        ts_code,
        trade_date,
        latest_close AS close,
        CASE
          WHEN pct_change IS NOT NULL THEN pct_change
          WHEN close_1d IS NOT NULL AND close_1d != 0 THEN (latest_close / close_1d - 1) * 100.0
          ELSE NULL
        END AS d1,
        CASE WHEN close_5d IS NOT NULL AND close_5d != 0 THEN (latest_close / close_5d - 1) * 100.0 ELSE NULL END AS d5,
        CASE WHEN close_20d IS NOT NULL AND close_20d != 0 THEN (latest_close / close_20d - 1) * 100.0 ELSE NULL END AS d20
      FROM pivoted
      ORDER BY ts_code ASC
    `;

    const rows = await queryRows<PriceSnapshotRow>(sql);
    return NextResponse.json({
      rows: rows.map((r) => ({
        ts_code: String(r.ts_code ?? '').toUpperCase(),
        trade_date: String(r.trade_date ?? ''),
        close: finiteOrNull(r.close),
        returns: {
          d1: finiteOrNull(r.d1),
          d5: finiteOrNull(r.d5),
          d20: finiteOrNull(r.d20),
        },
      })),
    });
  } catch (error) {
    console.error('[sw2021/price-snapshots] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to query sw index price snapshots',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
