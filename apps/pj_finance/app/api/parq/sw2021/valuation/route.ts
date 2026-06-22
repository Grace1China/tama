import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

export const dynamic = 'force-dynamic';

const DAILY_FILE = path.join(process.cwd(), 'temp/tuShare/sw_daily.parquet');
const CLASSIFY_FILE = path.join(process.cwd(), 'temp/tuShare/index_classify_SW2021.parquet');

type ClassifyRow = {
  index_code: string;
  industry_name: string;
  parent_code: string;
  level: 'L1' | 'L2' | 'L3' | string;
  industry_code: string;
};

type ValuationRow = {
  ts_code: string;
  name: string;
  trade_date: string;
  close: number;
  pct_change: number;
  vol: number;
  amount: number;
  float_mv: number;
  total_mv: number;
  pe: number | null;
  pe_percentile: number | null;
  pb: number | null;
  pb_percentile: number | null;
};

function queryAll<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();
    conn.all(sql, (err: Error | null, rows: Record<string, unknown>[] | undefined) => {
      conn.close();
      db.close();
      if (err) {
        reject(err);
        return;
      }
      resolve((rows ?? []) as T[]);
    });
  });
}

function collectDescendantIndexCodes(rows: ClassifyRow[], root: ClassifyRow): string[] {
  const byParent = new Map<string, ClassifyRow[]>();
  for (const row of rows) {
    const key = String(row.parent_code ?? '');
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }

  const queue: string[] = [String(root.industry_code)];
  const industryCodes = new Set<string>(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const children = byParent.get(current) ?? [];
    for (const child of children) {
      const c = String(child.industry_code ?? '');
      if (!c || industryCodes.has(c)) continue;
      industryCodes.add(c);
      queue.push(c);
    }
  }

  const indexCodes = new Set<string>();
  for (const row of rows) {
    if (!industryCodes.has(String(row.industry_code ?? ''))) continue;
    const code = String(row.index_code ?? '').toUpperCase();
    if (code) indexCodes.add(code);
  }
  return [...indexCodes];
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const indexCode = String(params.get('index_code') ?? '').trim().toUpperCase();
    const level = String(params.get('level') ?? '').trim().toUpperCase();

    const classifyPath = path.resolve(CLASSIFY_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const classifyRows = await queryAll<ClassifyRow>(`
      SELECT index_code, industry_name, parent_code, level, industry_code
      FROM read_parquet('${classifyPath}')
      WHERE src = 'SW2021'
      ORDER BY industry_code ASC
    `);

    let codes: string[];

    if (indexCode) {
      const root = classifyRows.find(
        (r) => String(r.index_code ?? '').toUpperCase() === indexCode
      );
      if (!root) {
        return NextResponse.json(
          { error: `Classify node not found for index_code: ${indexCode}` },
          { status: 404 }
        );
      }
      codes = collectDescendantIndexCodes(classifyRows, root);
      if (codes.length === 0) {
        codes = [indexCode];
      }
    } else if (level === 'L1' || level === 'L2' || level === 'L3') {
      codes = classifyRows
        .filter((r) => String(r.level ?? '').toUpperCase() === level)
        .map((r) => String(r.index_code ?? '').toUpperCase())
        .filter((c) => c);
    } else if (!indexCode && !level) {
      // No params: default to all L1
      codes = classifyRows
        .filter((r) => String(r.level ?? '').toUpperCase() === 'L1')
        .map((r) => String(r.index_code ?? '').toUpperCase())
        .filter((c) => c);
    } else {
      return NextResponse.json({ error: 'index_code or valid level (L1/L2/L3) is required' }, { status: 400 });
    }

    if (codes.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    const dailyPath = path.resolve(DAILY_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const inCodes = codes.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');

    const sql = `
      WITH raw AS (
        SELECT ts_code, trade_date, name, close, pct_change, vol, amount, pe, pb, float_mv, total_mv
        FROM read_parquet('${dailyPath}')
        WHERE ts_code IN (${inCodes})
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS rn,
          CASE WHEN pe IS NOT NULL
            THEN PERCENT_RANK() OVER (PARTITION BY ts_code ORDER BY pe)
            ELSE NULL
          END AS pe_pct,
          CASE WHEN pb IS NOT NULL
            THEN PERCENT_RANK() OVER (PARTITION BY ts_code ORDER BY pb)
            ELSE NULL
          END AS pb_pct
        FROM raw
      )
      SELECT ts_code, name, trade_date, close, pct_change, vol, amount, pe, pb, float_mv, total_mv,
             pe_pct * 100.0 AS pe_percentile,
             pb_pct * 100.0 AS pb_percentile
      FROM ranked
      WHERE rn = 1
      ORDER BY ts_code ASC
    `;

    const rows = await queryAll<ValuationRow>(sql);

    // Post-process: ensure percentile is null when the value is null
    const cleaned = rows.map((r) => ({
      ts_code: r.ts_code,
      name: r.name,
      trade_date: String(r.trade_date ?? ''),
      close: Number(r.close ?? 0),
      pct_change: Number(r.pct_change ?? 0),
      vol: Number(r.vol ?? 0),
      amount: Number(r.amount ?? 0),
      float_mv: Number(r.float_mv ?? 0),
      total_mv: Number(r.total_mv ?? 0),
      pe: r.pe != null && Number.isFinite(Number(r.pe)) ? Number(r.pe) : null,
      pe_percentile: r.pe != null && Number.isFinite(Number(r.pe)) && Number.isFinite(Number(r.pe_percentile))
        ? Number(r.pe_percentile)
        : null,
      pb: r.pb != null && Number.isFinite(Number(r.pb)) ? Number(r.pb) : null,
      pb_percentile: r.pb != null && Number.isFinite(Number(r.pb)) && Number.isFinite(Number(r.pb_percentile))
        ? Number(r.pb_percentile)
        : null,
    }));

    return NextResponse.json({ rows: cleaned });
  } catch (error) {
    console.error('[sw2021/valuation] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to compute industry valuation percentiles',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
