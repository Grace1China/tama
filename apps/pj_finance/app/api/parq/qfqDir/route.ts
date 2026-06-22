import { NextRequest, NextResponse } from 'next/server';
import zlib from 'zlib';
import { promisify } from 'util';
// @ts-ignore
import * as duckdb from 'duckdb';
import {
  buildQfqDailyCountSql,
  buildQfqDailyDataSql,
  getQfqSourcePaths,
} from '@/app/lib/qfqDailyQuery';

export const dynamic = 'force-dynamic';

const gzip = promisify(zlib.gzip);

/** 返回给前端的 trade_date 统一为 YYYYMMDD */
function formatTradeDateYmd(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  return s;
}

async function queryQfqDaily(
  query: string,
  pageCfg: { page: number; size: number },
): Promise<{
  headers: string[];
  originalHeaders: string[];
  data: Record<string, any>[];
  totalRows: number;
}> {
  const { bfq, adj } = getQfqSourcePaths();
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const tsCode = params.get('ts_code');
  const sortField = params.get('sortField');
  const sortDir = params.get('sortDir');
  const startDate = params.get('start_date');
  const endDate = params.get('end_date');

  const page = Number.isFinite(pageCfg?.page) ? pageCfg.page : 1;
  const size = Number.isFinite(pageCfg?.size) ? pageCfg.size : 50;
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.floor(size));
  const offset = (safePage - 1) * safeSize;

  const baseOpts = {
    bfqPath: bfq,
    adjPath: adj,
    tsCode,
    startDate,
    endDate,
    sortCol: sortField && /^[a-zA-Z0-9_]+$/.test(sortField) ? sortField : 'trade_date',
    sortDir: (sortDir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC') as 'ASC' | 'DESC',
    limit: safeSize,
    offset,
  };

  const countSql = buildQfqDailyCountSql(baseOpts);
  const dataSql = buildQfqDailyDataSql(baseOpts);

  return new Promise((resolve, reject) => {
    try {
      const db = new duckdb.Database(':memory:');
      const conn = db.connect();

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

          if (!rows || rows.length === 0) {
            conn.close();
            db.close();
            resolve({ headers: [], originalHeaders: [], data: [], totalRows });
            return;
          }

          const originalHeaders = Object.keys(rows[0]);
          const data = rows.map((row) => {
            const record: Record<string, any> = {};
            originalHeaders.forEach((header) => {
              record[header] =
                header === 'trade_date' ? formatTradeDateYmd(row[header]) : row[header];
            });
            return record;
          });

          conn.close();
          db.close();
          resolve({ headers: originalHeaders, originalHeaders, data, totalRows });
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
    const page = Number(url.searchParams.get('page') ?? '1');
    const size = Number(url.searchParams.get('size') ?? '50');
    const pageCfg = { page, size };

    const q = new URLSearchParams(url.searchParams);
    q.delete('page');
    q.delete('size');
    q.delete('file');
    const queryString = q.toString() ? `?${q.toString()}` : '';

    const queryData = await queryQfqDaily(queryString, pageCfg);

    const response = {
      category: 'qfqDir',
      filename: 'qfqDir',
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
    console.error('Error querying qfqDir:', error);
    return NextResponse.json(
      {
        error: 'Failed to query qfq daily',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
