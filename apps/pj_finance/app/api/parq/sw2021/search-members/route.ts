import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

export const dynamic = 'force-dynamic';

const MEMBER_FILE = path.join(process.cwd(), 'temp/tuShare/index_member_all.parquet');

function queryRows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
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

export async function GET(request: NextRequest) {
  try {
    const q = String(request.nextUrl.searchParams.get('q') ?? '').trim();
    if (!q) return NextResponse.json({ nodeCodes: [] });

    const qLower = q.toLowerCase().replace(/'/g, "''");
    const qUpper = q.toUpperCase().replace(/'/g, "''");
    const trimmed = q.trim();
    // 成分库里 ts_code 可能是「000426.SZ」或仅「000426」；用数字部分对齐，避免只能依赖名称匹配
    const fullStock = trimmed.match(/^(\d{6})(\.(SZ|SH|BJ))?$/i);
    const digit6 = fullStock ? fullStock[1] : /^\d{6}$/.test(trimmed) ? trimmed : '';
    const digitEsc = digit6.replace(/'/g, "''");
    const filePath = path.resolve(MEMBER_FILE).replace(/\\/g, '/').replace(/'/g, "''");

    const tsNorm = `UPPER(TRIM(COALESCE(CAST(ts_code AS VARCHAR), '')))`;
    const codePrefixEq = digit6
      ? ` OR (
          TRY_CAST(SPLIT_PART(${tsNorm}, '.', 1) AS BIGINT) IS NOT DISTINCT FROM TRY_CAST('${digitEsc}' AS BIGINT)
        )`
      : '';
    const sql = `
      SELECT DISTINCT l1_code, l2_code, l3_code
      FROM read_parquet('${filePath}')
      WHERE (
        LOWER(COALESCE(CAST(name AS VARCHAR), '')) LIKE '%${qLower}%'
        OR ${tsNorm} LIKE '%${qUpper}%'
        ${codePrefixEq}
      )
      LIMIT 20000
    `;
    const rows = await queryRows<{ l1_code?: string; l2_code?: string; l3_code?: string }>(sql);
    const set = new Set<string>();
    for (const r of rows) {
      const codes = [r.l1_code, r.l2_code, r.l3_code];
      for (const c of codes) {
        const s = String(c ?? '').trim().toUpperCase();
        if (s) set.add(s);
      }
    }
    return NextResponse.json({ nodeCodes: [...set] });
  } catch (error) {
    console.error('[sw2021/search-members] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to search member nodes',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

