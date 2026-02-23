import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';
import { mapHeadersToChinese } from '../../csv/[category]/route';

export const dynamic = 'force-dynamic';

// ------------------------------------------------------------------
// BigInt to JSON conversion
// ------------------------------------------------------------------
(BigInt.prototype as any).toJSON = function () {
    return Number(this);
};

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
  // 检查文件是否存在
  if (!fs.existsSync(parquetPath)) {
    throw new Error(`Parquet file not found: ${parquetPath}`);
  }

  // 将路径转换为绝对路径，并处理Windows路径分隔符
  const absolutePath = path.resolve(parquetPath).replace(/\\/g, '/');

  // 解析查询参数
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const tsCode = params.get('ts_code');
  const sortField = params.get('sortField');
  const sortDir = params.get('sortDir'); // 'asc' 或 'desc'
  const filtersStr = params.get('filters');

  return new Promise((resolve, reject) => {
    try {
      // 创建DuckDB连接
      const db = new duckdb.Database(':memory:');
      const conn = db.connect();

      // 构建SQL查询
      const page = Number.isFinite(pageCfg?.page) ? pageCfg.page : 1;
      const size = Number.isFinite(pageCfg?.size) ? pageCfg.size : 50;
      const safePage = Math.max(1, Math.floor(page));
      const safeSize = Math.max(1, Math.floor(size));
      const offset = (safePage - 1) * safeSize;

      console.log(`[Parquet API] 执行分页查询(page=${safePage}, size=${safeSize}): ${absolutePath}`);
      const fromClause = `FROM read_parquet('${absolutePath.replace(/'/g, "''")}')`;
      let whereClause = 'WHERE 1=1';
      
      const conditions: string[] = [];

      // 添加查询条件
      if (tsCode) {
        const escapedTsCode = tsCode.replace(/'/g, "''");
        conditions.push(`ts_code = '${escapedTsCode}'`);
      }

      // 处理过滤器
      if (filtersStr) {
        try {
          const filters = JSON.parse(filtersStr);
          Object.keys(filters).forEach(key => {
            const f = filters[key];
            // 验证key是合法的列名，防止SQL注入
            if (!/^[a-zA-Z0-9_]+$/.test(key)) {
              return;
            }
            
            if (f.filterType === 'text') {
              const escapedValue = String(f.filter).replace(/'/g, "''");
              whereClause += ` AND ${key} LIKE '%${escapedValue}%'`;
            } else if (f.filterType === 'number') {
              const numValue = Number(f.filter);
              if (isNaN(numValue)) return;
              
              if (f.type === 'equals') {
                whereClause += ` AND ${key} = ${numValue}`;
              } else if (f.type === 'greaterThan') {
                whereClause += ` AND ${key} > ${numValue}`;
              } else if (f.type === 'lessThan') {
                whereClause += ` AND ${key} < ${numValue}`;
              } else if (f.type === 'greaterThanOrEqual') {
                whereClause += ` AND ${key} >= ${numValue}`;
              } else if (f.type === 'lessThanOrEqual') {
                whereClause += ` AND ${key} <= ${numValue}`;
              }
            }
          });
        } catch (e) {
          console.error('Error parsing filters:', e);
        }
      }

      if (conditions.length > 0) {
        if (whereClause) {
          whereClause += ' AND ' + conditions.join(' AND ');
        } else {
          whereClause = 'WHERE ' + conditions.join(' AND ');
        }
      }

      // 构建排序子句 - 利润表使用 end_date
      let orderByClause = 'ORDER BY end_date DESC';
      if (sortField && sortDir) {
        // 验证 sortField 是合法的列名，防止 SQL 注入
        if (/^[a-zA-Z0-9_]+$/.test(sortField)) {
          const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
          orderByClause = `ORDER BY ${sortField} ${dir}`;
        }
      }

      const limitOffsetClause = `LIMIT ${safeSize} OFFSET ${offset}`;

      // 构建查询SQL
      const countSql = `SELECT COUNT(*) AS cnt ${fromClause} ${whereClause}`;
      const dataSql = `SELECT * REPLACE (
        CAST(ann_date AS VARCHAR) AS ann_date,
        CAST(end_date AS VARCHAR) AS end_date,
        CAST(f_ann_date AS VARCHAR) AS f_ann_date
      ) ${fromClause} ${whereClause} ${orderByClause} ${limitOffsetClause}`;
      
      console.log(`[Parquet API] 执行count查询: ${countSql}`);
      console.log(`[Parquet API] 执行分页查询(page=${safePage}, size=${safeSize}): ${dataSql}`);

      // 先查总数
      conn.all(countSql, (countErr: Error | null, countRows: any[]) => {
        if (countErr) {
          conn.close();
          db.close();
          reject(new Error(`DuckDB count query error: ${countErr.message}`));
          return;
        }

        const totalRows = Number(countRows?.[0]?.cnt ?? 0);

        // 再查分页数据
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
            resolve({
              headers: [],
              originalHeaders: [],
              data: [],
              totalRows,
            });
            return;
          }

          // 获取列名（从第一行数据中提取）
          const originalHeaders = Object.keys(rows[0]);
          const chineseHeaders = mapHeadersToChinese(originalHeaders, 'income1') || originalHeaders;
          // 转换数据格式
          const data = rows.map(row => {
            const record: Record<string, any> = {};
            originalHeaders.forEach(header => {
              if (header === 'end_date' || header === 'ann_date') {
                record[header] = Intl.DateTimeFormat("zh-CN").format(new Date(row[header]));
              } else {
                record[header] = row[header];
              }
            });
            return record;
          });

          conn.close();
          db.close();

          console.log(`[Parquet API] 查询完成，返回 ${data.length} 条记录（总数: ${totalRows}）`);

          resolve({
            headers: chineseHeaders,
            originalHeaders,
            data,
            totalRows,
          });
        });
      });
    } catch (error) {
      reject(new Error(`Failed to initialize DuckDB: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}

export async function GET(request: NextRequest) {
  try {
    // 检查客户端是否支持gzip压缩
    const acceptEncoding = request.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');

    const url = new URL(request.url);
    
    // 构建parquet文件路径
    const parquetPath = path.join(process.cwd(), 'temp/tuShare/income_vip2.parquet');

    // 获取分页参数
    const page = Number(url.searchParams.get('page') ?? '1');
    const size = Number(url.searchParams.get('size') ?? '50');
    const pageCfg = { page, size };

    // 构建查询字符串（去掉分页和file参数）
    const q = new URLSearchParams(url.searchParams);
    q.delete('page');
    q.delete('size');
    q.delete('file');
    const queryString = q.toString() ? `?${q.toString()}` : '';

    // 查询parquet文件
    const queryData = await queryParquetFile(parquetPath, queryString, pageCfg);

    // 构建响应
    const response = {
      category: 'income1',
      filename: 'income_vip',
      headers: queryData.headers,
      originalHeaders: queryData.originalHeaders,
      data: queryData.data,
      totalRows: queryData.totalRows,
    };

    // 压缩响应（如果客户端支持）
    const jsonString = JSON.stringify(response);
    const originalSize = Buffer.byteLength(jsonString, 'utf8');
    
    if (supportsGzip && originalSize > 1024) {
      const compressedData = await gzip(jsonString);
      const compressedSize = compressedData.length;
      const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
      console.log(`[Parquet API] 原始大小: ${(originalSize / 1024).toFixed(2)}KB, 压缩后: ${(compressedSize / 1024).toFixed(2)}KB, 压缩率: ${compressionRatio}%`);

      return new NextResponse(compressedData, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Content-Length': compressedSize.toString(),
        },
      });
    } else {
      return NextResponse.json(response);
    }
  } catch (error) {
    console.error('Error querying parquet file:', error);
    return NextResponse.json(
      { 
        error: 'Failed to query parquet file',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
