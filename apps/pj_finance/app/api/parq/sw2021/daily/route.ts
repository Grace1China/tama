import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

export const dynamic = 'force-dynamic';

const DAILY_FILE = path.join(process.cwd(), 'temp/tuShare/sw_daily.parquet');
const ALLOWED_SORT_FIELDS = new Set([
  'ts_code',
  'trade_date',
  'name',
  'open',
  'low',
  'high',
  'close',
  'change',
  'pct_change',
  'vol',
  'amount',
  'pe',
  'pb',
  'float_mv',
  'total_mv',
]);

function queryRows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();
    conn.all(sql, (err: Error | null, rows: T[] | undefined) => {
      conn.close();
      db.close();
      if (err) {
        reject(err);
        return;
      }
      resolve(rows ?? []);
    });
  });
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const tsCode = String(params.get('ts_code') ?? '').trim().toUpperCase();
    if (!tsCode) {
      return NextResponse.json({ error: 'ts_code is required' }, { status: 400 });
    }

    const page = Math.max(1, Math.floor(Number(params.get('page') ?? '1') || 1));
    const size = Math.max(1, Math.min(500, Math.floor(Number(params.get('size') ?? '50') || 50)));
    const offset = (page - 1) * size;

    const sortFieldRaw = String(params.get('sortField') ?? '').trim();
    const sortField = ALLOWED_SORT_FIELDS.has(sortFieldRaw) ? sortFieldRaw : 'trade_date';
    const sortDir = String(params.get('sortDir') ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const startDate = String(params.get('start_date') ?? '').trim();
    const endDate = String(params.get('end_date') ?? '').trim();

    const filePath = path.resolve(DAILY_FILE).replace(/\\/g, '/').replace(/'/g, "''");
    const escTs = tsCode.replace(/'/g, "''");
    const where: string[] = [`ts_code = '${escTs}'`];
    if (/^\d{8}$/.test(startDate)) where.push(`trade_date >= '${startDate}'`);
    if (/^\d{8}$/.test(endDate)) where.push(`trade_date <= '${endDate}'`);
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = `ORDER BY ${sortField} ${sortDir}`;

    const countSql = `SELECT COUNT(*) AS cnt FROM read_parquet('${filePath}') ${whereClause}`;
    const dataSql = `
      SELECT *
      FROM read_parquet('${filePath}')
      ${whereClause}
      ${orderBy}
      LIMIT ${size} OFFSET ${offset}
    `;

    const countRows = await queryRows<{ cnt?: number }>(countSql);
    const totalRows = Number(countRows?.[0]?.cnt ?? 0);
    const data = await queryRows<Record<string, unknown>>(dataSql);
    const headers = data.length > 0
      ? Object.keys(data[0])
      : ['ts_code', 'trade_date', 'name', 'open', 'low', 'high', 'close', 'change', 'pct_change', 'vol', 'amount', 'pe', 'pb', 'float_mv', 'total_mv'];

    return NextResponse.json({
      category: 'sw2021_daily',
      filename: 'sw_daily',
      headers,
      originalHeaders: headers,
      data,
      totalRows,
    });
  } catch (error) {
    console.error('[sw2021/daily] failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to query sw_daily parquet',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

