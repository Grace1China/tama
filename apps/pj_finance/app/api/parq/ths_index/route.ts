import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';
import { mapHeadersToChinese } from '../../csv/[category]/route';

export const dynamic = 'force-dynamic';

async function queryParquet(
  parquetPath: string,
  page: number,
  size: number,
  sortField: string,
  sortDir: 'ASC' | 'DESC',
  filtersStr: string | null
): Promise<{
  headers: string[];
  originalHeaders: string[];
  data: Record<string, unknown>[];
  totalRows: number;
}> {
  if (!fs.existsSync(parquetPath)) {
    throw new Error(`Parquet file not found: ${parquetPath}`);
  }

  const absolutePath = path.resolve(parquetPath).replace(/\\/g, '/').replace(/'/g, "''");
  const safePage = Math.max(1, Math.floor(page || 1));
  const safeSize = Math.max(1, Math.min(1000, Math.floor(size || 50)));
  const offset = (safePage - 1) * safeSize;
  const safeSortField = /^[a-zA-Z0-9_]+$/.test(sortField) ? sortField : 'ts_code';
  const safeSortDir = sortDir === 'ASC' ? 'ASC' : 'DESC';

  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();
    const whereClauses: string[] = ['1=1'];

    if (filtersStr) {
      try {
        const filters = JSON.parse(filtersStr) as Record<string, any>;
        Object.keys(filters).forEach((key) => {
          if (!/^[a-zA-Z0-9_]+$/.test(key)) return;
          const f = filters[key];
          if (f?.filterType === 'text') {
            const escapedValue = String(f.filter ?? '').replace(/'/g, "''");
            whereClauses.push(`${key} LIKE '%${escapedValue}%'`);
            return;
          }
          if (f?.filterType === 'number') {
            const numValue = Number(f.filter);
            if (!Number.isFinite(numValue)) return;
            if (f.type === 'equals') whereClauses.push(`${key} = ${numValue}`);
            else if (f.type === 'greaterThan') whereClauses.push(`${key} > ${numValue}`);
            else if (f.type === 'lessThan') whereClauses.push(`${key} < ${numValue}`);
            else if (f.type === 'greaterThanOrEqual') whereClauses.push(`${key} >= ${numValue}`);
            else if (f.type === 'lessThanOrEqual') whereClauses.push(`${key} <= ${numValue}`);
          }
        });
      } catch {
        // ignore invalid filter json
      }
    }

    const whereClause = `WHERE ${whereClauses.join(' AND ')}`;
    const fromClause = `FROM read_parquet('${absolutePath}')`;
    const countSql = `SELECT COUNT(*) AS cnt ${fromClause} ${whereClause}`;
    const dataSql = `
      SELECT *
      ${fromClause}
      ${whereClause}
      ORDER BY ${safeSortField} ${safeSortDir}
      LIMIT ${safeSize} OFFSET ${offset}
    `;

    conn.all(countSql, (countErr: Error | null, countRows: any[]) => {
      if (countErr) {
        conn.close();
        db.close();
        reject(new Error(`DuckDB count query error: ${countErr.message}`));
        return;
      }

      const totalRows = Number(countRows?.[0]?.cnt ?? 0);
      conn.all(dataSql, (err: Error | null, rows: any[]) => {
        if (err) {
          conn.close();
          db.close();
          reject(new Error(`DuckDB query error: ${err.message}`));
          return;
        }

        const originalHeaders = rows?.[0] ? Object.keys(rows[0]) : ['ts_code', 'name', 'count', 'exchange', 'list_date', 'type'];
        const headers = mapHeadersToChinese(originalHeaders, 'ths_index');
        const data = Array.isArray(rows) ? rows : [];

        conn.close();
        db.close();
        resolve({ headers, originalHeaders, data, totalRows });
      });
    });
  });
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const size = Number(url.searchParams.get('size') ?? '50');
    const sortField = String(url.searchParams.get('sortField') ?? 'ts_code').trim();
    const sortDir = String(url.searchParams.get('sortDir') ?? 'asc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const filters = url.searchParams.get('filters');

    const parquetPath = path.join(process.cwd(), 'temp/tuShare/ths_index.parquet');
    const result = await queryParquet(parquetPath, page, size, sortField, sortDir, filters);

    return NextResponse.json({
      category: 'ths_index',
      filename: 'ths_index',
      headers: result.headers,
      originalHeaders: result.originalHeaders,
      data: result.data,
      totalRows: result.totalRows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to query ths_index parquet',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
