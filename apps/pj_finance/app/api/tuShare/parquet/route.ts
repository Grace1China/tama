/**
 * TuShare Parquet 分页查询 API
 *
 * GET /api/tuShare/parquet?path=<相对路径>&page=1&size=50&sortField=&sortDir=
 *
 * 读取 temp/tuShare 下指定的 .parquet 文件，用 DuckDB 分页查询，返回与 CSV 接口相同结构：
 * { filename, headers, originalHeaders, data, totalRows }，供前端表格分页展示。
 * - path: 相对路径，必须以 .parquet 结尾。
 * - page: 页码，从 1 开始，默认 1。
 * - size: 每页条数，默认 50。
 * - sortField / sortDir: 可选排序（仅允许字母数字下划线列名，sortDir 为 asc|desc）。
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

const BASE = 'temp/tuShare';

export const dynamic = 'force-dynamic';

(BigInt.prototype as unknown as { toJSON?: () => number }).toJSON = function () {
  return Number(this);
};

function safeSortField(field: string | null): string | null {
  if (!field || !/^[a-zA-Z0-9_]+$/.test(field)) return null;
  return field;
}

export async function GET(request: NextRequest) {
  try {
    const rel = request.nextUrl.searchParams.get('path');
    if (!rel || rel.includes('..') || path.isAbsolute(rel) || !rel.toLowerCase().endsWith('.parquet')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    const filePath = path.join(process.cwd(), BASE, rel);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    const absolutePath = path.resolve(filePath).replace(/\\/g, '/');
    const escapedPath = absolutePath.replace(/'/g, "''");

    const page = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get('page')) || 1));
    const size = Math.max(1, Math.min(500, Math.floor(Number(request.nextUrl.searchParams.get('size')) || 50)));
    const sortField = safeSortField(request.nextUrl.searchParams.get('sortField'));
    const sortDir = request.nextUrl.searchParams.get('sortDir')?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const offset = (page - 1) * size;

    const result = await new Promise<{
      headers: string[];
      data: Record<string, unknown>[];
      totalRows: number;
    }>((resolve, reject) => {
      const db = new duckdb.Database(':memory:');
      const conn = db.connect();
      const fromClause = `FROM read_parquet('${escapedPath}')`;
      const orderByClause = sortField ? `ORDER BY "${sortField}" ${sortDir}` : '';
      const limitOffset = `LIMIT ${size} OFFSET ${offset}`;

      const countSql = `SELECT COUNT(*) AS cnt ${fromClause}`;
      const dataSql = `SELECT * ${fromClause} ${orderByClause} ${limitOffset}`;

      conn.all(countSql, (countErr: Error | null, countRows: unknown) => {
        if (countErr) {
          conn.close();
          db.close();
          reject(countErr);
          return;
        }
        const rows = Array.isArray(countRows) ? countRows : [];
        const totalRows = Number((rows[0] as { cnt?: number })?.cnt ?? 0);

        conn.all(dataSql, (dataErr: Error | null, rows: Record<string, unknown>[] | undefined) => {
          conn.close();
          db.close();
          if (dataErr) {
            reject(dataErr);
            return;
          }
          const list = rows ?? [];
          const headers = list.length > 0 ? Object.keys(list[0]) : [];
          resolve({ headers, data: list, totalRows });
        });
      });
    });

    return NextResponse.json({
      filename: path.basename(filePath),
      headers: result.headers,
      originalHeaders: result.headers,
      data: result.data,
      totalRows: result.totalRows,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read Parquet' },
      { status: 500 }
    );
  }
}
