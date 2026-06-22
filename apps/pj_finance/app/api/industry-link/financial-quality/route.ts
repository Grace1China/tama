import fs from 'fs';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

export const dynamic = 'force-dynamic';

const INDICATOR_FILE = path.join(process.cwd(), 'temp/tuShare/fina_indicator_vip_ss.parquet');
const MAX_CODES = 240;

type RawQualityRow = {
  ts_code: string;
  report_date: string;
  roe: number | null;
  leverage: number | null;
  gross_margin: number | null;
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

function cleanTsCodes(raw: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const part of raw.split(',')) {
    const code = part.trim().toUpperCase();
    if (!/^\d{6}\.(SZ|SH|BJ)$/.test(code)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= MAX_CODES) break;
  }
  return codes;
}

function finiteOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest) {
  try {
    const tsCodes = cleanTsCodes(String(request.nextUrl.searchParams.get('ts_codes') ?? ''));
    if (tsCodes.length === 0) {
      return NextResponse.json({ rows: [] });
    }
    if (!fs.existsSync(INDICATOR_FILE)) {
      return NextResponse.json(
        { error: 'Parquet file not found', message: `File not found: ${INDICATOR_FILE}` },
        { status: 404 },
      );
    }

    const filePath = path.resolve(INDICATOR_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const inCodes = tsCodes.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');

    const sql = `
      WITH ranked AS (
        SELECT
          ts_code,
          CAST(end_date AS VARCHAR) AS report_date,
          COALESCE(TRY_CAST(roe AS DOUBLE), TRY_CAST(roe_waa AS DOUBLE), TRY_CAST(q_roe AS DOUBLE)) AS roe,
          TRY_CAST(assets_to_eqt AS DOUBLE) AS leverage,
          COALESCE(TRY_CAST(grossprofit_margin AS DOUBLE), TRY_CAST(q_gc_to_gr AS DOUBLE)) AS gross_margin,
          ROW_NUMBER() OVER (
            PARTITION BY ts_code
            ORDER BY CAST(end_date AS VARCHAR) DESC, CAST(ann_date AS VARCHAR) DESC NULLS LAST
          ) AS rn
        FROM read_parquet('${filePath}')
        WHERE ts_code IN (${inCodes})
      )
      SELECT
        ts_code,
        report_date,
        roe,
        leverage,
        gross_margin
      FROM ranked
      WHERE rn = 1
      ORDER BY ts_code ASC
    `;

    const rows = await queryRows<RawQualityRow>(sql);
    return NextResponse.json({
      rows: rows.map((r) => ({
        ts_code: String(r.ts_code ?? '').toUpperCase(),
        report_date: String(r.report_date ?? ''),
        roe: finiteOrNull(r.roe),
        leverage: finiteOrNull(r.leverage),
        gross_margin: finiteOrNull(r.gross_margin),
      })),
    });
  } catch (error) {
    console.error('[industry-link/financial-quality] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to query financial quality',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
