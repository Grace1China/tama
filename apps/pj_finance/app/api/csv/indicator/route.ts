import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import zlib from 'zlib';
import { promisify } from 'util';
import { mapHeadersToChinese } from '../[category]/route';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

export const dynamic = 'force-dynamic';

const gzip = promisify(zlib.gzip);

/**
 * 从 Parquet 文件查询数据（使用 DuckDB）
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
  const groupByQuarter = params.get('groupByQuarter') === 'true';
  const getAllDates = params.get('getAllDates') === 'true';

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

      const fromClause = `FROM read_parquet('${absolutePath.replace(/'/g, "''")}')`;
      let whereClause = 'WHERE 1=1';
      if (!groupByQuarter && !getAllDates) {
        // 非分组模式且不是获取所有日期：只显示季度末数据
        whereClause = `WHERE ((month(trade_date) = 3 AND day(trade_date) = 31)
   OR (month(trade_date) = 6 AND day(trade_date) = 30)
   OR (month(trade_date) = 9 AND day(trade_date) = 30)
   OR (month(trade_date) = 12 AND day(trade_date) = 31))`;
      }
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

      // 构建排序子句
      let orderByClause = 'ORDER BY trade_date DESC';
      if (sortField && sortDir) {
        // 验证 sortField 是合法的列名，防止 SQL 注入
        if (/^[a-zA-Z0-9_]+$/.test(sortField)) {
          const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
          orderByClause = `ORDER BY ${sortField} ${dir}`;
        }
      }

      const limitOffsetClause = `LIMIT ${safeSize} OFFSET ${offset}`;

      let countSql: string;
      let dataSql: string;

      if (groupByQuarter) {
        // 按季分组：先获取所有列名
        const getColumnsSql = `SELECT * ${fromClause} ${whereClause} LIMIT 1`;
        
        conn.all(getColumnsSql, (colErr: Error | null, sampleRows: any[]) => {
          if (colErr || !sampleRows || sampleRows.length === 0) {
            conn.close();
            db.close();
            reject(new Error(`Failed to get column structure: ${colErr?.message || 'No data'}`));
            return;
          }

          const allColumns = Object.keys(sampleRows[0]);
          const numericFields = ['close', 'turnover_rate', 'turnover_rate_f', 'volume_ratio', 
            'pe', 'pe_ttm', 'pb', 'ps', 'ps_ttm', 'dv_ratio', 'dv_ttm', 
            'total_share', 'float_share', 'free_share', 'total_mv', 'circ_mv'];
          
          const yearExpr = `YEAR(trade_date)`;
          const quarterExpr = `CASE 
            WHEN MONTH(trade_date) <= 3 THEN 1
            WHEN MONTH(trade_date) <= 6 THEN 2
            WHEN MONTH(trade_date) <= 9 THEN 3
            ELSE 4
          END`;

          const selectFields = allColumns.map(col => {
            if (col === 'ts_code') {
              return `ts_code`;
            } else if (col === 'trade_date') {
              return `MAX(trade_date) AS trade_date`;
            } else if (numericFields.includes(col.toLowerCase())) {
              return `AVG(${col}) AS ${col}`;
            } else {
              return `MIN(${col}) AS ${col}`;
            }
          });

          const groupByFields = `ts_code, ${yearExpr}, ${quarterExpr}`;
          const groupByClause = `GROUP BY ${groupByFields}`;
          
          let groupOrderBy = `ORDER BY ts_code, ${yearExpr} DESC, ${quarterExpr} DESC`;
          if (sortField && sortDir && /^[a-zA-Z0-9_]+$/.test(sortField)) {
            const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            groupOrderBy = `ORDER BY ${sortField} ${dir}`;
          }

          countSql = `SELECT COUNT(*) AS cnt FROM (
            SELECT ${groupByFields}
            ${fromClause} ${whereClause}
            ${groupByClause}
          ) AS grouped`;
          
          dataSql = `SELECT ${selectFields.join(', ')}
            ${fromClause} ${whereClause}
            ${groupByClause}
            ${groupOrderBy}
            ${limitOffsetClause}`;

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

              const originalHeaders = Object.keys(rows[0]);
              const chineseHeaders = mapHeadersToChinese(originalHeaders, 'indicator');
              const data = rows.map(row => {
                const record: Record<string, any> = {};
                originalHeaders.forEach(header => {
                  record[header] = row[header];
                });
                return record;
              });

              conn.close();
              db.close();

              resolve({
                headers: chineseHeaders,
                originalHeaders,
                data,
                totalRows,
              });
            });
          });
        });
      } else {
        // 非分组模式
        countSql = `SELECT COUNT(*) AS cnt ${fromClause} ${whereClause}`;
        dataSql = `SELECT * ${fromClause} ${whereClause} ${orderByClause} ${limitOffsetClause}`;
        
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

            const originalHeaders = Object.keys(rows[0]);
            const chineseHeaders = mapHeadersToChinese(originalHeaders, 'indicator');
            const data = rows.map(row => {
              const record: Record<string, any> = {};
              originalHeaders.forEach(header => {
                if(header === 'trade_date') {
                  record[header] = Intl.DateTimeFormat("zh-CN").format(row[header])
                } else {
                  record[header] = row[header];
                }
              });
              return record;
            });

            conn.close();
            db.close();

            resolve({
              headers: chineseHeaders,
              originalHeaders,
              data,
              totalRows,
            });
          });
        });
      }
    } catch (error) {
      reject(new Error(`Failed to initialize DuckDB: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}

/**
 * 从CSV文件读取数据并按季度分组，取平均值（使用DuckDB）
 */
async function processIndicatorCSV(
  tsCode: string,
  pageCfg: { page: number; size: number }
): Promise<{
  headers: string[];
  originalHeaders: string[];
  data: Record<string, any>[];
  totalRows: number;
}> {
  const indicatorDir = path.join(process.cwd(), 'temp/tuShare/indicator');
  
  // 查找匹配的文件：{tsCode}_*.csv 或 {tsCode}-*.csv
  const escapedTsCode = tsCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const files = fs.readdirSync(indicatorDir)
    .filter(file => {
      // 匹配格式：{tsCode}_YYYYMMDD.csv 或 {tsCode}-YYYYMMDD.csv
      const pattern1 = new RegExp(`^${escapedTsCode}_\\d{8}\\.csv$`);
      const pattern2 = new RegExp(`^${escapedTsCode}-\\d{8}\\.csv$`);
      return pattern1.test(file) || pattern2.test(file);
    })
    .map(file => ({
      filename: file,
      filepath: path.join(indicatorDir, file),
      // 提取日期部分（支持下划线和连字符）
      date: file.match(/[_-](\d{8})\.csv$/)?.[1] || ''
    }))
    .filter(f => f.date)
    .sort((a, b) => b.date.localeCompare(a.date)); // 按日期降序排序

  if (files.length === 0) {
    return {
      headers: [],
      originalHeaders: [],
      data: [],
      totalRows: 0,
    };
  }

  // 取日期最大的文件
  const latestFile = files[0];
  console.log(`[Indicator CSV] 使用文件: ${latestFile.filename}, 日期: ${latestFile.date}`);

  // 检查文件是否存在
  if (!fs.existsSync(latestFile.filepath)) {
    throw new Error(`CSV file not found: ${latestFile.filepath}`);
  }

  // 将路径转换为绝对路径，并处理Windows路径分隔符
  const absolutePath = path.resolve(latestFile.filepath).replace(/\\/g, '/');

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

      // 先读取CSV文件获取列结构
      const getColumnsSql = `SELECT * FROM read_csv_auto('${absolutePath.replace(/'/g, "''")}') LIMIT 1`;
      
      conn.all(getColumnsSql, (colErr: Error | null, sampleRows: any[]) => {
        if (colErr) {
          conn.close();
          db.close();
          reject(new Error(`Failed to read CSV file: ${colErr.message}`));
          return;
        }

        if (!sampleRows || sampleRows.length === 0) {
          conn.close();
          db.close();
          resolve({
            headers: [],
            originalHeaders: [],
            data: [],
            totalRows: 0,
          });
          return;
        }

        const allColumns = Object.keys(sampleRows[0]);
        const originalHeaders = [...allColumns];
        
        // 检查是否有 trade_date 字段
        const hasTradeDate = allColumns.some(col => col.toLowerCase() === 'trade_date');
        if (!hasTradeDate) {
          conn.close();
          db.close();
          reject(new Error('trade_date field not found in CSV'));
          return;
        }

        // 定义数值字段（需要计算平均值）
        const numericFields = ['close', 'turnover_rate', 'turnover_rate_f', 'volume_ratio', 
          'pe', 'pe_ttm', 'pb', 'ps', 'ps_ttm', 'dv_ratio', 'dv_ttm', 
          'total_share', 'float_share', 'free_share', 'total_mv', 'circ_mv'];

        // 构建季度分组查询
        // 使用子查询先转换日期，然后在外部查询中分组
        const dateStr = `CAST(trade_date AS VARCHAR)`;
        const dateExpr = `CASE 
          WHEN LENGTH(${dateStr}) = 8 THEN CAST(STRPTIME(${dateStr}, '%Y%m%d') AS DATE)
          ELSE CAST(${dateStr} AS DATE)
        END AS parsed_date`;
        const yearExpr = `YEAR(parsed_date) AS year_val`;
        const quarterExpr = `CASE 
          WHEN MONTH(parsed_date) <= 3 THEN 1
          WHEN MONTH(parsed_date) <= 6 THEN 2
          WHEN MONTH(parsed_date) <= 9 THEN 3
          ELSE 4
        END AS quarter_val`;

        // 构建子查询的 SELECT 字段（包含所有原始字段和计算字段）
        const quarterEndDateExpr = `DATE_TRUNC('quarter', parsed_date) + INTERVAL '3 months' - INTERVAL '1 day' AS trade_date`;
        const subquerySelectFields = [
          ...allColumns.filter(col => col.toLowerCase() !== 'trade_date').map(col => col), // 排除原始 trade_date，使用计算后的
          dateExpr,
          yearExpr,
          quarterExpr,
          quarterEndDateExpr
        ];

        // 构建外部查询的 SELECT 字段（聚合字段）
        // 注意：trade_date 在子查询中已经计算为季度末日期
        const selectFields = allColumns.map(col => {
          const colLower = col.toLowerCase();
          if (colLower === 'ts_code') {
            return `ts_code`;
          } else if (colLower === 'trade_date') {
            // 季度末日期（在子查询中已计算）
            return `MAX(trade_date) AS trade_date`;
          } else if (numericFields.includes(colLower)) {
            // 数值字段取平均值
            return `AVG(CAST(${col} AS DOUBLE)) AS ${col}`;
          } else {
            // 其他字段取第一个值
            return `MIN(${col}) AS ${col}`;
          }
        });

        const groupByFields = `ts_code, year_val, quarter_val`;
        const groupByClause = `GROUP BY ${groupByFields}`;
        const orderByClause = `ORDER BY year_val DESC, quarter_val DESC`;
        const limitOffsetClause = `LIMIT ${safeSize} OFFSET ${offset}`;

        const fromClause = `FROM read_csv_auto('${absolutePath.replace(/'/g, "''")}')`;
        const whereClause = `WHERE ts_code = '${tsCode.replace(/'/g, "''")}'`;

        // 先查总数（使用与 dataSql 相同的子查询结构）
        const countSql = `SELECT COUNT(*) AS cnt FROM (
          SELECT ts_code, year_val, quarter_val
          FROM (
            SELECT ${subquerySelectFields.join(', ')}
            ${fromClause}
            ${whereClause}
          ) AS subquery
          GROUP BY ts_code, year_val, quarter_val
        ) AS grouped`;

        // 再查分页数据（使用子查询）
        const dataSql = `SELECT ${selectFields.join(', ')}
          FROM (
            SELECT ${subquerySelectFields.join(', ')}
            ${fromClause}
            ${whereClause}
          ) AS subquery
          ${groupByClause}
          ${orderByClause}
          ${limitOffsetClause}`;

        console.log(`[Indicator CSV] 执行count查询: ${countSql}`);
        console.log(`[Indicator CSV] 执行分页查询(page=${safePage}, size=${safeSize}): ${dataSql}`);

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

            // 获取列名
            const resultHeaders = Object.keys(rows[0]);
            const chineseHeaders = mapHeadersToChinese(resultHeaders, 'indicator');

            // 转换数据格式
            const data = rows.map((row: Record<string, any>) => {
              const record: Record<string, any> = {};
              resultHeaders.forEach(header => {
                let value = row[header];
                // 处理日期格式
                if (header.toLowerCase() === 'trade_date' && value) {
                  // 将日期转换为 YYYYMMDD 格式
                  if (value instanceof Date) {
                    const year = value.getFullYear();
                    const month = String(value.getMonth() + 1).padStart(2, '0');
                    const day = String(value.getDate()).padStart(2, '0');
                    value = `${year}${month}${day}`;
                  } else if (typeof value === 'string') {
                    // 如果已经是字符串，尝试转换格式
                    value = value.replace(/-/g, '').replace(/\s.*$/, '');
                  }
                }
                record[header] = value;
              });
              return record;
            });

            conn.close();
            db.close();

            console.log(`[Indicator CSV] 查询完成，返回 ${data.length} 条记录（总数: ${totalRows}）`);

            resolve({
              headers: chineseHeaders,
              originalHeaders: resultHeaders,
              data,
              totalRows,
            });
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
    
    // 获取数据源类型：csv 或 parquet（默认为 parquet）
    const source = url.searchParams.get('source') || 'parquet';
    
    // 获取分页参数
    const page = Number(url.searchParams.get('page') ?? '1');
    const size = Number(url.searchParams.get('size') ?? '50');
    const pageCfg = { page, size };

    let queryData: {
      headers: string[];
      originalHeaders: string[];
      data: Record<string, any>[];
      totalRows: number;
    };

  
    // Parquet 处理方式（默认）
    const parquetPath = path.join(process.cwd(), 'temp/tuShare/daily_indicators.parquet');
    
    // 构建查询字符串（去掉分页和source参数）
    const q = new URLSearchParams(url.searchParams);
    q.delete('page');
    q.delete('size');
    q.delete('source');
    const queryString = q.toString() ? `?${q.toString()}` : '';

    queryData = await queryParquetFile(parquetPath, queryString, pageCfg);

    // 构建响应
    const response = {
      category: 'indicator',
      filename: source === 'csv' ? `indicator_csv` : 'daily_indicators',
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
      console.log(`[Indicator API] 原始大小: ${(originalSize / 1024).toFixed(2)}KB, 压缩后: ${(compressedSize / 1024).toFixed(2)}KB, 压缩率: ${compressionRatio}%`);

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
    console.error('Error processing indicator:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process indicator',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
