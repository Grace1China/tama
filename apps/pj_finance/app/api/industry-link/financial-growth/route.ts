import fs from 'fs';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

export const dynamic = 'force-dynamic';

const INCOME_FILE = path.join(process.cwd(), 'temp/tuShare/income_vip_ss.parquet');
const MAX_CODES = 240;

type RawGrowthRow = {
  ts_code: string;
  report_date: string;
  revenue_cagr: number | null;
  revenue_years: number | null;
  profit_cagr: number | null;
  profit_years: number | null;
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

function intOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export async function GET(request: NextRequest) {
  try {
    const tsCodes = cleanTsCodes(String(request.nextUrl.searchParams.get('ts_codes') ?? ''));
    if (tsCodes.length === 0) {
      return NextResponse.json({ rows: [] });
    }
    if (!fs.existsSync(INCOME_FILE)) {
      return NextResponse.json(
        { error: 'Parquet file not found', message: `File not found: ${INCOME_FILE}` },
        { status: 404 },
      );
    }

    const filePath = path.resolve(INCOME_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const inCodes = tsCodes.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');

    const sql = `
      WITH annual_raw AS (
        SELECT
          ts_code,
          CAST(end_date AS VARCHAR) AS end_date,
          TRY_CAST(total_revenue AS DOUBLE) AS total_revenue,
          TRY_CAST(n_income_attr_p AS DOUBLE) AS n_income_attr_p,
          ROW_NUMBER() OVER (
            PARTITION BY ts_code, CAST(end_date AS VARCHAR)
            ORDER BY
              CASE WHEN CAST(report_type AS VARCHAR) = '1' AND CAST(comp_type AS VARCHAR) = '1' THEN 0 ELSE 1 END,
              CAST(ann_date AS VARCHAR) DESC NULLS LAST
          ) AS rn
        FROM read_parquet('${filePath}')
        WHERE ts_code IN (${inCodes})
          AND RIGHT(CAST(end_date AS VARCHAR), 4) = '1231'
      ),
      annual AS (
        SELECT
          ts_code,
          end_date,
          CAST(LEFT(end_date, 4) AS INTEGER) AS report_year,
          total_revenue,
          n_income_attr_p
        FROM annual_raw
        WHERE rn = 1
      ),
      anchor AS (
        SELECT *
        FROM annual
        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY ts_code
          ORDER BY report_year DESC
        ) = 1
      ),
      candidates AS (
        SELECT
          a.ts_code,
          a.end_date AS report_date,
          p.report_year,
          a.report_year - p.report_year AS years,
          a.total_revenue AS cur_revenue,
          p.total_revenue AS past_revenue,
          a.n_income_attr_p AS cur_profit,
          p.n_income_attr_p AS past_profit
        FROM anchor a
        JOIN annual p ON p.ts_code = a.ts_code
        WHERE a.report_year - p.report_year BETWEEN 1 AND 5
      ),
      revenue_pick AS (
        SELECT
          ts_code,
          report_date,
          years AS revenue_years,
          (POWER(cur_revenue / past_revenue, 1.0 / years) - 1.0) * 100.0 AS revenue_cagr
        FROM candidates
        WHERE cur_revenue > 0 AND past_revenue > 0
        QUALIFY ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY years DESC) = 1
      ),
      profit_pick AS (
        SELECT
          ts_code,
          report_date,
          years AS profit_years,
          (POWER(cur_profit / past_profit, 1.0 / years) - 1.0) * 100.0 AS profit_cagr
        FROM candidates
        WHERE cur_profit > 0 AND past_profit > 0
        QUALIFY ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY years DESC) = 1
      )
      SELECT
        a.ts_code,
        a.end_date AS report_date,
        r.revenue_cagr,
        r.revenue_years,
        p.profit_cagr,
        p.profit_years
      FROM anchor a
      LEFT JOIN revenue_pick r ON r.ts_code = a.ts_code
      LEFT JOIN profit_pick p ON p.ts_code = a.ts_code
      ORDER BY a.ts_code ASC
    `;

    const rows = await queryRows<RawGrowthRow>(sql);
    return NextResponse.json({
      rows: rows.map((r) => ({
        ts_code: String(r.ts_code ?? '').toUpperCase(),
        report_date: String(r.report_date ?? ''),
        revenue_cagr: finiteOrNull(r.revenue_cagr),
        revenue_years: intOrNull(r.revenue_years),
        profit_cagr: finiteOrNull(r.profit_cagr),
        profit_years: intOrNull(r.profit_years),
      })),
    });
  } catch (error) {
    console.error('[industry-link/financial-growth] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to query financial growth',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
