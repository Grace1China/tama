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

type DailyRow = {
  ts_code: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
  amount: number;
  pe: number | null;
  pb: number | null;
};

type IndustryChartData = {
  ts_code: string;
  name: string;
  daily: DailyRow[];
  pe_stats: { mean: number; std: number; high: number; low: number } | null;
  pb_stats: { mean: number; std: number; high: number; low: number } | null;
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
      if (codes.length === 0) codes = [indexCode];
    } else if (level === 'L1' || level === 'L2' || level === 'L3') {
      codes = classifyRows
        .filter((r) => String(r.level ?? '').toUpperCase() === level)
        .map((r) => String(r.index_code ?? '').toUpperCase())
        .filter((c) => c);
    } else {
      codes = classifyRows
        .filter((r) => String(r.level ?? '').toUpperCase() === 'L1')
        .map((r) => String(r.index_code ?? '').toUpperCase())
        .filter((c) => c);
    }

    if (codes.length === 0) {
      return NextResponse.json({ industries: [] });
    }

    const dailyPath = path.resolve(DAILY_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const inCodes = codes.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');

    // Fetch all daily data for these codes, ordered by trade_date
    const dailySql = `
      SELECT ts_code, trade_date, name, open, high, low, close, vol, amount, pe, pb
      FROM read_parquet('${dailyPath}')
      WHERE ts_code IN (${inCodes})
      ORDER BY ts_code ASC, trade_date ASC
    `;

    const allRows = await queryAll<DailyRow & { name: string }>(dailySql);

    // Group by ts_code, sample and compute stats
    const byCode = new Map<string, (DailyRow & { name: string })[]>();
    for (const r of allRows) {
      const code = String(r.ts_code ?? '').toUpperCase();
      if (!code) continue;
      const list = byCode.get(code) ?? [];
      list.push(r);
      byCode.set(code, list);
    }

    const industries: IndustryChartData[] = [];
    for (const c of codes) {
      const rows = byCode.get(c) ?? [];

      const peValues = rows
        .map((r) => r.pe)
        .filter((v): v is number => v != null && Number.isFinite(v));
      const pbValues = rows
        .map((r) => r.pb)
        .filter((v): v is number => v != null && Number.isFinite(v));

      const peStats = computeStats(peValues);
      const pbStats = computeStats(pbValues);

      industries.push({
        ts_code: c,
        name: rows.length > 0 ? String(rows[0].name ?? '') : c,
        daily: rows.map((r) => ({
          ts_code: String(r.ts_code ?? ''),
          trade_date: String(r.trade_date ?? ''),
          open: Number(r.open ?? 0),
          high: Number(r.high ?? 0),
          low: Number(r.low ?? 0),
          close: Number(r.close ?? 0),
          vol: Number(r.vol ?? 0),
          amount: Number(r.amount ?? 0),
          pe: r.pe != null && Number.isFinite(Number(r.pe)) ? Number(r.pe) : null,
          pb: r.pb != null && Number.isFinite(Number(r.pb)) ? Number(r.pb) : null,
        })),
        pe_stats: peStats,
        pb_stats: pbStats,
      });
    }

    return NextResponse.json({ industries });
  } catch (error) {
    console.error('[sw2021/chart-data] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to load industry chart data',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

function computeStats(values: number[]): { mean: number; std: number; high: number; low: number } | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  const std = Math.sqrt(variance);
  return { mean, std, high: mean + std, low: mean - std };
}
