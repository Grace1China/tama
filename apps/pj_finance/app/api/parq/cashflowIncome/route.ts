import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

export const dynamic = 'force-dynamic';

(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

const gzip = promisify(zlib.gzip);

function formatDateZhCN(value: unknown): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  const normalized = m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
  try {
    const dt = new Date(normalized.replace(/-/g, '/'));
    if (Number.isNaN(dt.getTime())) return raw;
    return Intl.DateTimeFormat('zh-CN').format(dt);
  } catch {
    return raw;
  }
}

async function queryTTMData(
  incomePath: string,
  cashflowPath: string,
  query: string,
  pageCfg: { page: number; size: number }
): Promise<{
  headers: string[];
  originalHeaders: string[];
  data: Record<string, any>[];
  totalRows: number;
}> {
  if (!fs.existsSync(incomePath)) {
    throw new Error(`Income parquet file not found: ${incomePath}`);
  }
  if (!fs.existsSync(cashflowPath)) {
    throw new Error(`Cashflow parquet file not found: ${cashflowPath}`);
  }

  const incomeAbsPath = path.resolve(incomePath).replace(/\\/g, '/');
  const cashflowAbsPath = path.resolve(cashflowPath).replace(/\\/g, '/');

  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const tsCode = params.get('ts_code');
  const sortField = params.get('sortField');
  const sortDir = params.get('sortDir');

  return new Promise((resolve, reject) => {
    try {
      const db = new duckdb.Database(':memory:');
      const conn = db.connect();

      const page = Number.isFinite(pageCfg?.page) ? pageCfg.page : 1;
      const size = Number.isFinite(pageCfg?.size) ? pageCfg.size : 50;
      const safePage = Math.max(1, Math.floor(page));
      const safeSize = Math.max(1, Math.floor(size));
      const offset = (safePage - 1) * safeSize;

      let incomeWhereClause = "WHERE report_type = '1' AND comp_type = '1'";
      let cashflowWhereClause = "WHERE report_type = '1' AND comp_type = '1'";
      if (tsCode) {
        const escapedTsCode = tsCode.replace(/'/g, "''");
        incomeWhereClause += ` AND ts_code = '${escapedTsCode}'`;
        cashflowWhereClause += ` AND ts_code = '${escapedTsCode}'`;
      }

      let orderByClause = 'ORDER BY end_date DESC';
      if (sortField && sortDir && /^[a-zA-Z0-9_]+$/.test(sortField)) {
        const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        orderByClause = `ORDER BY ${sortField} ${dir}`;
      }

      const limitOffsetClause = `LIMIT ${safeSize} OFFSET ${offset}`;

      const schemaSql = `DESCRIBE SELECT * FROM read_parquet('${incomeAbsPath.replace(/'/g, "''")}')`;
      conn.all(schemaSql, (schemaErr: Error | null, schemaRows: any[]) => {
        if (schemaErr) {
          conn.close();
          db.close();
          reject(new Error(`DuckDB schema query error: ${schemaErr.message}`));
          return;
        }

        const hasNetAfterNrLpCorrect = (schemaRows || []).some((r: any) => {
          const col = String(r?.column_name ?? r?.name ?? Object.values(r || {})[0] ?? '').toLowerCase();
          return col === 'net_after_nr_lp_correct';
        });
        const netAfterFieldExpr = hasNetAfterNrLpCorrect ? 'net_after_nr_lp_correct' : 'NULL';

        const ttmSql = `
        WITH income_dedup AS (
          SELECT *
          FROM (
            SELECT *,
              ROW_NUMBER() OVER (PARTITION BY ts_code, end_date, report_type ORDER BY COALESCE(CAST(update_flag AS INTEGER), 0) DESC) AS __rn
            FROM read_parquet('${incomeAbsPath.replace(/'/g, "''")}')
            ${incomeWhereClause}
          )
          WHERE __rn = 1
        ),
        income_single_quarter AS (
          SELECT
            ts_code,
            end_date,
            report_type,
            comp_type,
            CASE
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331' 
                THEN TRY_CAST(total_revenue AS DOUBLE)
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0331' 
                THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0630' 
                THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0930' 
                THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              ELSE NULL 
            END AS q_total_revenue,
            CASE
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331' 
                THEN TRY_CAST(n_income AS DOUBLE)
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0331' 
                THEN TRY_CAST(n_income AS DOUBLE) - LAG(TRY_CAST(n_income AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0630' 
                THEN TRY_CAST(n_income AS DOUBLE) - LAG(TRY_CAST(n_income AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0930' 
                THEN TRY_CAST(n_income AS DOUBLE) - LAG(TRY_CAST(n_income AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              ELSE NULL 
            END AS q_n_income,
            CASE
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331' 
                THEN TRY_CAST(${netAfterFieldExpr} AS DOUBLE)
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0331' 
                THEN TRY_CAST(${netAfterFieldExpr} AS DOUBLE) - LAG(TRY_CAST(${netAfterFieldExpr} AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0630' 
                THEN TRY_CAST(${netAfterFieldExpr} AS DOUBLE) - LAG(TRY_CAST(${netAfterFieldExpr} AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0930' 
                THEN TRY_CAST(${netAfterFieldExpr} AS DOUBLE) - LAG(TRY_CAST(${netAfterFieldExpr} AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              ELSE NULL 
            END AS q_net_after_nr_lp_correct
          FROM income_dedup
        ),
        cashflow_dedup AS (
          SELECT *
          FROM (
            SELECT *,
              ROW_NUMBER() OVER (PARTITION BY ts_code, end_date, report_type ORDER BY COALESCE(CAST(update_flag AS INTEGER), 0) DESC) AS __rn
            FROM read_parquet('${cashflowAbsPath.replace(/'/g, "''")}')
            ${cashflowWhereClause}
          )
          WHERE __rn = 1
        ),
        cashflow_single_quarter AS (
          SELECT
            ts_code,
            end_date,
            report_type,
            comp_type,
            CASE
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331' 
                THEN TRY_CAST(c_inf_fr_operate_a AS DOUBLE)
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0331' 
                THEN TRY_CAST(c_inf_fr_operate_a AS DOUBLE) - LAG(TRY_CAST(c_inf_fr_operate_a AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0630' 
                THEN TRY_CAST(c_inf_fr_operate_a AS DOUBLE) - LAG(TRY_CAST(c_inf_fr_operate_a AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0930' 
                THEN TRY_CAST(c_inf_fr_operate_a AS DOUBLE) - LAG(TRY_CAST(c_inf_fr_operate_a AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              ELSE NULL 
            END AS q_c_inf_fr_operate_a
          FROM cashflow_dedup
        ),
        combined AS (
          SELECT
            i.ts_code,
            i.end_date,
            i.report_type,
            i.comp_type,
            i.q_total_revenue,
            i.q_n_income,
            i.q_net_after_nr_lp_correct,
            c.q_c_inf_fr_operate_a
          FROM income_single_quarter i
          LEFT JOIN cashflow_single_quarter c
            ON i.ts_code = c.ts_code
            AND i.end_date = c.end_date
            AND i.report_type = c.report_type
        ),
        ttm_calc AS (
          SELECT
            ts_code,
            end_date,
            report_type,
            comp_type,
            q_total_revenue,
            q_n_income,
            q_net_after_nr_lp_correct,
            q_c_inf_fr_operate_a,
            SUM(q_total_revenue) OVER (
              PARTITION BY ts_code, report_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS ttm_total_revenue,
            SUM(q_n_income) OVER (
              PARTITION BY ts_code, report_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS ttm_n_income,
            SUM(q_net_after_nr_lp_correct) OVER (
              PARTITION BY ts_code, report_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS ttm_net_after_nr_lp_correct,
            SUM(q_c_inf_fr_operate_a) OVER (
              PARTITION BY ts_code, report_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS ttm_c_inf_fr_operate_a,
            COUNT(q_total_revenue) OVER (
              PARTITION BY ts_code, report_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS window_count
          FROM combined
        )
        SELECT
          ts_code,
          CAST(end_date AS VARCHAR) AS end_date,
          report_type,
          comp_type,
          q_total_revenue,
          q_n_income,
          q_net_after_nr_lp_correct,
          q_c_inf_fr_operate_a,
          CASE WHEN window_count >= 4 THEN ttm_total_revenue ELSE NULL END AS ttm_total_revenue,
          CASE WHEN window_count >= 4 THEN ttm_n_income ELSE NULL END AS ttm_n_income,
          CASE WHEN window_count >= 4 THEN ttm_net_after_nr_lp_correct ELSE NULL END AS ttm_net_after_nr_lp_correct,
          CASE WHEN window_count >= 4 THEN ttm_c_inf_fr_operate_a ELSE NULL END AS ttm_c_inf_fr_operate_a
        FROM ttm_calc
        `;

        const countSql = `SELECT COUNT(*) AS cnt FROM (${ttmSql}) AS t`;
        const dataSql = `SELECT * FROM (${ttmSql}) AS t ${orderByClause} ${limitOffsetClause}`;

        console.log(`[CashflowIncome TTM API] Executing count query`);
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
            resolve({
              headers: [],
              originalHeaders: [],
              data: [],
              totalRows,
            });
            return;
          }

          const originalHeaders = Object.keys(rows[0]);
          const headerMap: Record<string, string> = {
            ts_code: '股票代码',
            end_date: '报告期',
            report_type: '报告类型',
            comp_type: '公司类型',
            q_total_revenue: '单季营业总收入',
            q_n_income: '单季净利润',
            q_net_after_nr_lp_correct: '单季扣非后净利润',
            q_c_inf_fr_operate_a: '单季经营现金流入',
            ttm_total_revenue: '滚动总营收',
            ttm_n_income: '滚动净利润',
            ttm_net_after_nr_lp_correct: '滚动扣非后净利润',
            ttm_c_inf_fr_operate_a: '滚动经营现金流入',
          };
          const chineseHeaders = originalHeaders.map(h => headerMap[h] || h);

          const data = rows.map(row => {
            const record: Record<string, any> = {};
            originalHeaders.forEach(header => {
              if (header === 'end_date') {
                record[header] = formatDateZhCN(row[header]);
              } else {
                record[header] = row[header];
              }
            });
            return record;
          });

          conn.close();
          db.close();

          console.log(`[CashflowIncome TTM API] Query complete, returning ${data.length} records (total: ${totalRows})`);

          resolve({
            headers: chineseHeaders,
            originalHeaders,
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
    const acceptEncoding = request.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');

    const url = new URL(request.url);

    const incomePath = path.join(process.cwd(), 'temp/tuShare/income_vip_ss.parquet');
    const cashflowPath = path.join(process.cwd(), 'temp/tuShare/cashflow_vip_ss.parquet');

    const page = Number(url.searchParams.get('page') ?? '1');
    const size = Number(url.searchParams.get('size') ?? '50');
    const pageCfg = { page, size };

    const q = new URLSearchParams(url.searchParams);
    q.delete('page');
    q.delete('size');
    const queryString = q.toString() ? `?${q.toString()}` : '';

    const queryData = await queryTTMData(incomePath, cashflowPath, queryString, pageCfg);

    const response = {
      category: 'cashflowIncome',
      filename: 'cashflow_income_ttm',
      headers: queryData.headers,
      originalHeaders: queryData.originalHeaders,
      data: queryData.data,
      totalRows: queryData.totalRows,
    };

    const jsonString = JSON.stringify(response);
    const originalSize = Buffer.byteLength(jsonString, 'utf8');

    if (supportsGzip && originalSize > 1024) {
      const compressedData = await gzip(jsonString);
      const compressedSize = compressedData.length;
      const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
      console.log(`[CashflowIncome TTM API] Original: ${(originalSize / 1024).toFixed(2)}KB, Compressed: ${(compressedSize / 1024).toFixed(2)}KB, Ratio: ${compressionRatio}%`);

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
    console.error('Error querying TTM data:', error);
    return NextResponse.json(
      {
        error: 'Failed to query TTM data',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
