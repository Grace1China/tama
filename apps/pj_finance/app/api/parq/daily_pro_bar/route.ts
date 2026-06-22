import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
// @ts-ignore
import * as duckdb from 'duckdb';
import { mapHeadersToChinese } from '../../csv/[category]/route';
import { resolveDailyBasicParquet } from '@/app/lib/tuShareParquetPath';

export const dynamic = 'force-dynamic';

const gzip = promisify(zlib.gzip);

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
  const groupByQuarter = params.get('groupByQuarter') === 'true';
  const getAllDates = params.get('getAllDates') === 'true';
  const startDate = params.get('start_date');

  const page = Number.isFinite(pageCfg?.page) ? pageCfg.page : 1;
  const size = Number.isFinite(pageCfg?.size) ? pageCfg.size : 50;
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.floor(size));
  const offset = (safePage - 1) * safeSize;

  /** 兼容 parquet 中 trade_date 为 DATE 或 VARCHAR */
  const tradeDateStr = `regexp_replace(CAST(trade_date AS VARCHAR), '-', '')`;

  return new Promise((resolve, reject) => {
    try {
      const db = new duckdb.Database(':memory:');
      const conn = db.connect();

      const fromClause = `FROM read_parquet('${absolutePath.replace(/'/g, "''")}')`;
      let whereClause = 'WHERE 1=1';
      const conditions: string[] = [];

      if (tsCode) {
        conditions.push(`ts_code = '${tsCode.replace(/'/g, "''")}'`);
      }

      if (startDate) {
        const raw = startDate.trim();
        if (/^\d{8}$/.test(raw)) {
          conditions.push(`${tradeDateStr} >= '${raw.replace(/'/g, "''")}'`);
        }
      }

      // 非 getAllDates 且非 groupByQuarter：默认只显示季度末
      if (!getAllDates && !groupByQuarter) {
        conditions.push(`(
          (CAST(substring(${tradeDateStr}, 5, 2) AS INTEGER) = 3 AND CAST(substring(${tradeDateStr}, 7, 2) AS INTEGER) = 31) OR
          (CAST(substring(${tradeDateStr}, 5, 2) AS INTEGER) = 6 AND CAST(substring(${tradeDateStr}, 7, 2) AS INTEGER) = 30) OR
          (CAST(substring(${tradeDateStr}, 5, 2) AS INTEGER) = 9 AND CAST(substring(${tradeDateStr}, 7, 2) AS INTEGER) = 30) OR
          (CAST(substring(${tradeDateStr}, 5, 2) AS INTEGER) = 12 AND CAST(substring(${tradeDateStr}, 7, 2) AS INTEGER) = 31)
        )`);
      }

      if (filtersStr) {
        try {
          const filters = JSON.parse(filtersStr);
          Object.keys(filters).forEach((key) => {
            const f = filters[key];
            if (!/^[a-zA-Z0-9_]+$/.test(key)) return;
            if (f.filterType === 'text') {
              whereClause += ` AND ${key} LIKE '%${String(f.filter).replace(/'/g, "''")}%'`;
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
        } catch { /* ignore */ }
      }

      if (conditions.length > 0) whereClause += ' AND ' + conditions.join(' AND ');

      const sortCol = sortField && /^[a-zA-Z0-9_]+$/.test(sortField) ? sortField : 'trade_date';
      const dir = sortDir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      if (groupByQuarter) {
        // 季度分组：对数值字段取 AVG
        const yearExpr = `CAST(substring(${tradeDateStr}, 1, 4) AS INTEGER)`;
        const monthExpr = `CAST(substring(${tradeDateStr}, 5, 2) AS INTEGER)`;
        const quarterExpr = `CASE WHEN ${monthExpr} <= 3 THEN 1 WHEN ${monthExpr} <= 6 THEN 2 WHEN ${monthExpr} <= 9 THEN 3 ELSE 4 END`;

        const numericFields = ['close', 'turnover_rate', 'turnover_rate_f', 'volume_ratio',
          'pe', 'pe_ttm', 'pb', 'ps', 'ps_ttm', 'dv_ratio', 'dv_ttm',
          'total_share', 'float_share', 'free_share', 'total_mv', 'circ_mv'];

        // 先获取列结构
        conn.all(`SELECT * ${fromClause} ${whereClause} LIMIT 1`, (colErr, sampleRows: any[]) => {
          if (colErr || !sampleRows?.length) {
            conn.close(); db.close();
            resolve({ headers: [], originalHeaders: [], data: [], totalRows: 0 });
            return;
          }
          const allColumns = Object.keys(sampleRows[0]);
          const selectFields = allColumns.map((col) => {
            const lower = col.toLowerCase();
            if (lower === 'ts_code') return 'ts_code';
            if (lower === 'trade_date') return `MAX(trade_date) AS trade_date`;
            if (numericFields.includes(lower)) return `AVG(${col}) AS ${col}`;
            return `MIN(${col}) AS ${col}`;
          });

          const groupByFields = `ts_code, ${yearExpr}, ${quarterExpr}`;
          const groupByClause = `GROUP BY ${groupByFields}`;
          const groupOrderBy = sortField && /^[a-zA-Z0-9_]+$/.test(sortField)
            ? `ORDER BY ${sortField} ${dir}`
            : `ORDER BY ${yearExpr} DESC, ${quarterExpr} DESC`;

          const countSql = `SELECT COUNT(*) AS cnt FROM (SELECT ${groupByFields} ${fromClause} ${whereClause} ${groupByClause}) AS g`;
          const dataSql = `SELECT ${selectFields.join(', ')} ${fromClause} ${whereClause} ${groupByClause} ${groupOrderBy} LIMIT ${safeSize} OFFSET ${offset}`;

          conn.all(countSql, (countErr, countRows: any[]) => {
            if (countErr) { conn.close(); db.close(); reject(new Error(`count error: ${countErr.message}`)); return; }
            const totalRows = Number(countRows?.[0]?.cnt ?? 0);
            conn.all(dataSql, (err, rows: any[]) => {
              if (err) { conn.close(); db.close(); reject(new Error(`query error: ${err.message}`)); return; }
              if (!rows?.length) {
                conn.close(); db.close();
                resolve({ headers: [], originalHeaders: [], data: [], totalRows });
                return;
              }
              const originalHeaders = Object.keys(rows[0]);
              const chineseHeaders = mapHeadersToChinese(originalHeaders, 'indicator');
              const data = rows.map((row) => {
                const record: Record<string, any> = {};
                originalHeaders.forEach((h) => { record[h] = row[h]; });
                return record;
              });
              conn.close(); db.close();
              resolve({ headers: chineseHeaders, originalHeaders, data, totalRows });
            });
          });
        });
      } else {
        // 非分组模式
        const orderByClause = `ORDER BY ${sortCol === 'trade_date' ? `CAST(${tradeDateStr} AS INTEGER)` : sortCol} ${dir}`;
        const countSql = `SELECT COUNT(*) AS cnt ${fromClause} ${whereClause}`;
        const dataSql = `SELECT * ${fromClause} ${whereClause} ${orderByClause} LIMIT ${safeSize} OFFSET ${offset}`;

        conn.all(countSql, (countErr, countRows: any[]) => {
          if (countErr) { conn.close(); db.close(); reject(new Error(`count error: ${countErr.message}`)); return; }
          const totalRows = Number(countRows?.[0]?.cnt ?? 0);
          conn.all(dataSql, (err, rows: any[]) => {
            if (err) { conn.close(); db.close(); reject(new Error(`query error: ${err.message}`)); return; }
            if (!rows?.length) {
              conn.close(); db.close();
              resolve({ headers: [], originalHeaders: [], data: [], totalRows });
              return;
            }
            const originalHeaders = Object.keys(rows[0]);
            const chineseHeaders = mapHeadersToChinese(originalHeaders, 'indicator');
            const data = rows.map((row) => {
              const record: Record<string, any> = {};
              originalHeaders.forEach((h) => {
                if (h === 'trade_date' && row[h] instanceof Date) {
                  record[h] = row[h].toISOString().slice(0, 10).replace(/-/g, '');
                } else {
                  record[h] = row[h];
                }
              });
              return record;
            });
            conn.close(); db.close();
            resolve({ headers: chineseHeaders, originalHeaders, data, totalRows });
          });
        });
      }
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
    let parquetPath: string;
    try {
      parquetPath = resolveDailyBasicParquet(null);
    } catch {
      return NextResponse.json({ error: 'Parquet file not found' }, { status: 404 });
    }

    const page = Number(url.searchParams.get('page') ?? '1');
    const size = Number(url.searchParams.get('size') ?? '50');
    const q = new URLSearchParams(url.searchParams);
    q.delete('page'); q.delete('size'); q.delete('file');
    const queryString = q.toString() ? `?${q.toString()}` : '';

    const queryData = await queryParquetFile(parquetPath, queryString, { page, size });

    const response = {
      category: 'indicator',
      filename: 'daily_pro_bar',
      headers: queryData.headers,
      originalHeaders: queryData.originalHeaders,
      data: queryData.data,
      totalRows: queryData.totalRows,
    };

    const jsonString = JSON.stringify(response);
    if (supportsGzip && Buffer.byteLength(jsonString, 'utf8') > 1024) {
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
    console.error('Error querying daily_pro_bar:', error);
    return NextResponse.json(
      { error: 'Failed to query daily_pro_bar', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
