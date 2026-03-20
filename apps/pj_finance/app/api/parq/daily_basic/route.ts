import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';
import { mapHeadersToChinese } from '../../csv/[category]/route';

export const dynamic = 'force-dynamic';

const gzip = promisify(zlib.gzip);

/**
 * 使用DuckDB查询parquet文件
 * @param parquetPath parquet文件路径
 * @param query 查询参数字符串
 * @param pageCfg 分页配置
 */
async function queryParquetFile(
  parquetPath: string,
  query: string,
  pageCfg: { page: number; size: number }
): Promise<{
  headers: string[];
  originalHeaders: string[];
  data: Record<string, any>[];
  totalRows: number;
}> {
  if (!fs.existsSync(parquetPath)) {
    throw new Error(`Parquet file not found: ${parquetPath}`);
  }

  const absolutePath = path.resolve(parquetPath).replace(/\\/g, '/');
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const tsCode = params.get('ts_code');
  const sortField = params.get('sortField');
  const sortDir = params.get('sortDir');
  const filtersStr = params.get('filters');
  const startDate = params.get('start_date');

  const page = Number.isFinite(pageCfg?.page) ? pageCfg.page : 1;
  const size = Number.isFinite(pageCfg?.size) ? pageCfg.size : 50;
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.floor(size));
  const offset = (safePage - 1) * safeSize;

  const metaPath = path.join(process.cwd(), 'temp/meta/dialy_basic.csv');
  const readMetaHeaders = (): { originalHeaders: string[]; chineseHeaders: string[] } => {
    try {
      if (!fs.existsSync(metaPath)) return { originalHeaders: [], chineseHeaders: [] };
      const raw = fs.readFileSync(metaPath, 'utf-8');
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const rows = lines.slice(1); // skip title row
      const originalHeaders: string[] = [];
      const chineseHeaders: string[] = [];
      for (const line of rows) {
        const parts = line.split('\t');
        const field = String(parts[0] ?? '').trim();
        const label = String(parts[2] ?? field).trim();
        if (!field) continue;
        originalHeaders.push(field);
        chineseHeaders.push(label || field);
      }
      return { originalHeaders, chineseHeaders };
    } catch {
      return { originalHeaders: [], chineseHeaders: [] };
    }
  };

  return new Promise((resolve, reject) => {
    try {
      const db = new duckdb.Database(':memory:');
      const conn = db.connect();

      const fromClause = `FROM read_parquet('${absolutePath.replace(/'/g, "''")}')`;
      const tradeDateExpr = `STRPTIME(CAST(trade_date AS VARCHAR), '%Y%m%d')`;
      let whereClause = 'WHERE 1=1';
      const conditions: string[] = [];

      if (tsCode) {
        const escapedTsCode = tsCode.replace(/'/g, "''");
        conditions.push(`ts_code = '${escapedTsCode}'`);
      }

      if (startDate) {
        const raw = startDate.trim();
        if (/^\d{8}$/.test(raw)) {
          conditions.push(`${tradeDateExpr} >= STRPTIME('${raw.replace(/'/g, "''")}', '%Y%m%d')`);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          conditions.push(`${tradeDateExpr} >= CAST('${raw.replace(/'/g, "''")}' AS DATE)`);
        }
      }

      if (filtersStr) {
        try {
          const filters = JSON.parse(filtersStr);
          Object.keys(filters).forEach((key) => {
            const f = filters[key];
            if (!/^[a-zA-Z0-9_]+$/.test(key)) return;
            if (f.filterType === 'text') {
              const escapedValue = String(f.filter).replace(/'/g, "''");
              whereClause += ` AND ${key} LIKE '%${escapedValue}%'`;
            } else if (f.filterType === 'number') {
              const numValue = Number(f.filter);
              if (isNaN(numValue)) return;
              if (f.type === 'equals') whereClause += ` AND ${key} = ${numValue}`;
              else if (f.type === 'greaterThan') whereClause += ` AND ${key} > ${numValue}`;
              else if (f.type === 'lessThan') whereClause += ` AND ${key} < ${numValue}`;
              else if (f.type === 'greaterThanOrEqual') whereClause += ` AND ${key} >= ${numValue}`;
              else if (f.type === 'lessThanOrEqual') whereClause += ` AND ${key} <= ${numValue}`;
            }
          });
        } catch (e) {
          console.error('Error parsing filters:', e);
        }
      }

      if (conditions.length > 0) whereClause += ' AND ' + conditions.join(' AND ');

      let orderByClause = `ORDER BY ${tradeDateExpr} DESC`;
      if (sortField && sortDir && /^[a-zA-Z0-9_]+$/.test(sortField)) {
        const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        orderByClause = sortField === 'trade_date'
          ? `ORDER BY ${tradeDateExpr} ${dir}`
          : `ORDER BY ${sortField} ${dir}`;
      }

      const countSql = `SELECT COUNT(*) AS cnt ${fromClause} ${whereClause}`;
      const dataSql = `SELECT * ${fromClause} ${whereClause} ${orderByClause} LIMIT ${safeSize} OFFSET ${offset}`;

      conn.all(countSql, (countErr: Error | null, countRows: any[]) => {
        if (countErr) {
          conn.close();
          db.close();
          reject(new Error(`DuckDB count query error: ${countErr.message}`));
          return;
        }

        const totalRows = Number(countRows?.[0]?.cnt ?? 0);
        console.log(`[Parquet API] 查询: dataSql`,dataSql);
        conn.all(dataSql, (err: Error | null, rows: any[]) => {
          if (err) {
            conn.close();
            db.close();
            reject(new Error(`DuckDB query error: ${err.message}`));
            return;
          }

          if (!rows || rows.length === 0) {
            const meta = readMetaHeaders();
            conn.close();
            db.close();
            resolve({
              headers: meta.chineseHeaders,
              originalHeaders: meta.originalHeaders,
              data: [],
              totalRows,
            });
            return;
          }

          const originalHeaders = Object.keys(rows[0]);
          const chineseHeaders = mapHeadersToChinese(originalHeaders, 'indicator');
          const data = rows.map((row) => {
            const record: Record<string, any> = {};
            originalHeaders.forEach((header) => {
              record[header] = row[header];
            });
            return record;
          });

          conn.close();
          db.close();
          resolve({ headers: chineseHeaders, originalHeaders, data, totalRows });
        });
      });
    } catch (error) {
      reject(new Error(`Failed to initialize DuckDB: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}

export async function GET(request: NextRequest) {
  try {
    const acceptEncoding = request.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');

    const url = new URL(request.url);
    const parquetPath = path.join(process.cwd(), 'temp/tuShare/daily_basic_ss.parquet');

    const page = Number(url.searchParams.get('page') ?? '1');
    const size = Number(url.searchParams.get('size') ?? '50');
    const pageCfg = { page, size };

    const q = new URLSearchParams(url.searchParams);
    q.delete('page');
    q.delete('size');
    q.delete('file');
    const queryString = q.toString() ? `?${q.toString()}` : '';
    console.log(`[Parquet API] 执行查询: parquetPath, queryString, pageCfg`,parquetPath, queryString, pageCfg);
    const queryData = await queryParquetFile(parquetPath, queryString, pageCfg);
    const response = {
      category: 'daily_basic',
      filename: 'daily_basic',
      headers: queryData.headers,
      originalHeaders: queryData.originalHeaders,
      data: queryData.data,
      totalRows: queryData.totalRows,
    };

    const jsonString = JSON.stringify(response);
    const originalSize = Buffer.byteLength(jsonString, 'utf8');
    if (supportsGzip && originalSize > 1024) {
      const compressedData = await gzip(jsonString);
      return new NextResponse(compressedData, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Content-Length': compressedData.length.toString(),
        },
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error querying parquet file:', error);
    return NextResponse.json(
      {
        error: 'Failed to query parquet file',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

