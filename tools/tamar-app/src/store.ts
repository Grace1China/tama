import fs from 'node:fs';
import type { AppConfig } from './config.js';
import { parseCsv } from './csv.js';
import { querySql, sqlString } from './duck.js';
import { normalizeFinancialData } from './finance/normalize.js';
import { existingFile, type FileKey } from './paths.js';
import { SafeError } from './safety.js';
import { priceSnapshotSql, qfqDailySql, weekBreadthSql } from './market/sql.js';

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requireFile(config: AppConfig, key: FileKey) {
  const file = existingFile(config, key);
  if (!file) throw new SafeError('file_missing', `${key} 源文件不存在`);
  return file;
}

export async function queryOrderedRows(
  config: AppConfig,
  key: FileKey,
  tsCode: string,
  orderField: string,
  limit = 200,
  filterByCode = true,
): Promise<Array<Record<string, unknown>>> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(orderField)) {
    throw new SafeError('column_rejected', '排序字段不合法');
  }
  const file = requireFile(config, key);
  const code = tsCode.replace(/'/g, "''");
  const where = filterByCode ? `WHERE UPPER(CAST(ts_code AS VARCHAR)) = '${code}'` : '';
  const safeLimit = Math.max(1, Math.floor(limit));
  return querySql(`
    SELECT * FROM read_parquet('${sqlString(file.absolute)}')
    ${where}
    ORDER BY ${orderField} DESC
    LIMIT ${safeLimit}
  `);
}

export async function queryByCode(config: AppConfig, key: FileKey, tsCode: string, limit = 200): Promise<Array<Record<string, unknown>>> {
  const file = requireFile(config, key);
  const code = tsCode.replace(/'/g, "''");
  const safeLimit = Math.max(1, Math.floor(limit));
  return querySql(`
    SELECT * FROM read_parquet('${sqlString(file.absolute)}')
    WHERE UPPER(CAST(ts_code AS VARCHAR)) = '${code}'
    LIMIT ${safeLimit}
  `);
}

export async function queryStatement(config: AppConfig, key: FileKey, tsCode: string, limit: number) {
  const file = requireFile(config, key);
  const code = tsCode.replace(/'/g, "''");
  const columns = await querySql(`DESCRIBE SELECT * FROM read_parquet('${sqlString(file.absolute)}')`);
  const names = new Set(columns.map((row) => String(row.column_name ?? row.name ?? '')));
  const partition = ['ts_code', 'end_date', names.has('report_type') ? 'report_type' : '']
    .filter(Boolean)
    .join(', ');
  const order = names.has('update_flag')
    ? 'COALESCE(TRY_CAST(update_flag AS INTEGER), 0) DESC'
    : 'end_date DESC';
  const safeLimit = Math.max(1, Math.floor(limit));
  return querySql(`
    SELECT * EXCLUDE (__rn) FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY ${partition}
        ORDER BY ${order}
      ) AS __rn
      FROM read_parquet('${sqlString(file.absolute)}')
      WHERE UPPER(CAST(ts_code AS VARCHAR)) = '${code}'
    )
    WHERE __rn = 1
    ORDER BY end_date DESC
    LIMIT ${safeLimit}
  `);
}

export async function queryPriceSnapshots(config: AppConfig, tsCodes: string[]) {
  const bfq = requireFile(config, 'bfq');
  const adj = requireFile(config, 'adj');
  const rows = await querySql(priceSnapshotSql(bfq.absolute, adj.absolute, tsCodes));
  return {
    source: `${bfq.relative}+${adj.relative}`,
    rows: rows.map((row) => ({
      ts_code: String(row.ts_code ?? '').toUpperCase(),
      trade_date: String(row.trade_date ?? ''),
      close: num(row.close),
      d1: num(row.d1),
      d5: num(row.d5),
      d20: num(row.d20),
      d60: num(row.d60),
      unit: '%',
      scale: 'percent',
      d1_rule: '优先 bfq.pct_chg；否则前复权 pre_close；再否则前一交易日收盘',
      window_rule: 'd5/d20/d60 分别对应倒序第 6/21/61 根交易日',
    })),
  };
}

export async function queryQfqKline(config: AppConfig, tsCode: string, limit: number) {
  const bfq = requireFile(config, 'bfq');
  const adj = requireFile(config, 'adj');
  const sql = qfqDailySql(bfq.absolute, adj.absolute, tsCode, limit);
  if (sql.includes('qfqDir')) throw new SafeError('price_source_rejected', '禁止读取 qfqDir.parquet');
  const bars = await querySql(sql);
  let turnoverByDate = new Map<string, number>();
  const daily = existingFile(config, 'dailyBasic');
  if (daily) {
    const code = tsCode.replace(/'/g, "''");
    const dailyRows = await querySql(`
      SELECT trade_date, turnover_rate
      FROM read_parquet('${sqlString(daily.absolute)}')
      WHERE UPPER(CAST(ts_code AS VARCHAR)) = '${code}'
    `);
    turnoverByDate = new Map(
      dailyRows.map((row) => [String(row.trade_date ?? ''), num(row.turnover_rate) ?? Number.NaN]),
    );
  }
  const chronological = [...bars].reverse().map((row) => {
    const tradeDate = String(row.trade_date ?? '');
    const turnover = turnoverByDate.get(tradeDate);
    return {
      trade_date: tradeDate,
      open: num(row.open),
      high: num(row.high),
      low: num(row.low),
      close: num(row.close),
      pre_close: num(row.pre_close),
      pct_chg: num(row.pct_chg),
      vol: num(row.vol),
      amount: num(row.amount),
      turnover_rate: turnover == null || Number.isNaN(turnover) ? null : turnover,
      price_unit: 'CNY',
      price_scale: 'yuan',
      price_basis: 'qfq_from_bfq_adj',
      pct_unit: '%',
      pct_scale: 'percent',
      turnover_unit: '%',
      turnover_scale: 'percent',
    };
  });
  return {
    source: `${bfq.relative}+${adj.relative}`,
    daily_basic_source: daily?.relative ?? null,
    bars: chronological,
  };
}

export async function queryWeekPct(config: AppConfig, tsCodes: string[]) {
  const bfq = requireFile(config, 'bfq');
  const rows = await querySql(weekBreadthSql(bfq.absolute, tsCodes, 5));
  return { source: bfq.relative, rows };
}

const QUALITY_SQL = (file: string, codes: string) => `
  WITH ranked AS (
    SELECT
      ts_code,
      CAST(end_date AS VARCHAR) AS report_date,
      COALESCE(TRY_CAST(roe AS DOUBLE), TRY_CAST(roe_waa AS DOUBLE), TRY_CAST(q_roe AS DOUBLE)) AS roe,
      TRY_CAST(assets_to_eqt AS DOUBLE) AS leverage,
      COALESCE(TRY_CAST(grossprofit_margin AS DOUBLE), TRY_CAST(q_gc_to_gr AS DOUBLE)) AS gross_margin,
      ROW_NUMBER() OVER (
        PARTITION BY ts_code
        ORDER BY CAST(end_date AS VARCHAR) DESC, CAST(ann_date AS VARCHAR) DESC NULLS LAST
      ) AS rn
    FROM read_parquet('${file}')
    WHERE ts_code IN (${codes})
  )
  SELECT ts_code, report_date, roe, leverage, gross_margin
  FROM ranked WHERE rn = 1 ORDER BY ts_code ASC
`;

export async function queryFinancialQuality(config: AppConfig, tsCodes: string[]) {
  const file = requireFile(config, 'finaIndicator');
  const codes = tsCodes.map((code) => `'${code}'`).join(', ');
  const rows = await querySql(QUALITY_SQL(sqlString(file.absolute), codes));
  return {
    source: file.relative,
    rows: rows.map((row) => ({
      ts_code: String(row.ts_code ?? '').toUpperCase(),
      report_date: String(row.report_date ?? '').replace(/\D/g, '').slice(0, 8),
      roe: { value: num(row.roe), unit: '%', scale: 'percent', label: 'ROE', source_fields: 'roe, roe_waa, q_roe' },
      leverage: { value: num(row.leverage), unit: 'times', scale: 'times', label: '权益乘数 assets_to_eqt' },
      gross_margin: { value: num(row.gross_margin), unit: '%', scale: 'percent', label: '毛利率', source_fields: 'grossprofit_margin, q_gc_to_gr' },
    })),
  };
}

const GROWTH_SQL = (file: string, codes: string) => `
  WITH annual_raw AS (
    SELECT
      ts_code,
      CAST(end_date AS VARCHAR) AS end_date,
      TRY_CAST(total_revenue AS DOUBLE) AS total_revenue,
      TRY_CAST(n_income_attr_p AS DOUBLE) AS n_income_attr_p,
      ROW_NUMBER() OVER (
        PARTITION BY ts_code, CAST(end_date AS VARCHAR)
        ORDER BY
          CASE WHEN CAST(report_type AS VARCHAR) = '1' AND CAST(comp_type AS VARCHAR) = '1' THEN 0 ELSE 1 END,
          CAST(ann_date AS VARCHAR) DESC NULLS LAST
      ) AS rn
    FROM read_parquet('${file}')
    WHERE ts_code IN (${codes})
      AND RIGHT(regexp_replace(CAST(end_date AS VARCHAR), '[^0-9]', ''), 4) = '1231'
  ),
  annual AS (
    SELECT ts_code, end_date, CAST(LEFT(end_date, 4) AS INTEGER) AS report_year, total_revenue, n_income_attr_p
    FROM annual_raw WHERE rn = 1
  ),
  anchor AS (
    SELECT * FROM annual
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY report_year DESC) = 1
  ),
  candidates AS (
    SELECT
      a.ts_code, a.end_date AS report_date, p.report_year,
      a.report_year - p.report_year AS years,
      a.total_revenue AS cur_revenue, p.total_revenue AS past_revenue,
      a.n_income_attr_p AS cur_profit, p.n_income_attr_p AS past_profit
    FROM anchor a
    JOIN annual p ON p.ts_code = a.ts_code
    WHERE a.report_year - p.report_year BETWEEN 1 AND 5
  ),
  revenue_pick AS (
    SELECT ts_code, report_date, years AS revenue_years,
      (POWER(cur_revenue / past_revenue, 1.0 / years) - 1.0) * 100.0 AS revenue_cagr
    FROM candidates
    WHERE cur_revenue > 0 AND past_revenue > 0
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY years DESC) = 1
  ),
  profit_pick AS (
    SELECT ts_code, report_date, years AS profit_years,
      (POWER(cur_profit / past_profit, 1.0 / years) - 1.0) * 100.0 AS profit_cagr
    FROM candidates
    WHERE cur_profit > 0 AND past_profit > 0
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY years DESC) = 1
  )
  SELECT a.ts_code, a.end_date AS report_date, r.revenue_cagr, r.revenue_years, p.profit_cagr, p.profit_years
  FROM anchor a
  LEFT JOIN revenue_pick r ON r.ts_code = a.ts_code
  LEFT JOIN profit_pick p ON p.ts_code = a.ts_code
  ORDER BY a.ts_code ASC
`;

export async function queryFinancialGrowth(config: AppConfig, tsCodes: string[]) {
  const file = requireFile(config, 'income');
  const codes = tsCodes.map((code) => `'${code}'`).join(', ');
  const rows = await querySql(GROWTH_SQL(sqlString(file.absolute), codes));
  return {
    source: file.relative,
    annual_only: true,
    rows: rows.map((row) => ({
      ts_code: String(row.ts_code ?? '').toUpperCase(),
      report_date: String(row.report_date ?? '').replace(/\D/g, '').slice(0, 8),
      revenue_cagr: { value: num(row.revenue_cagr), unit: '%', scale: 'percent', years: num(row.revenue_years) },
      profit_cagr: { value: num(row.profit_cagr), unit: '%', scale: 'percent', years: num(row.profit_years) },
    })),
  };
}

export async function loadFinancialData(config: AppConfig, tsCode: string) {
  const read = async (key: FileKey) => {
    const file = existingFile(config, key);
    if (!file) return [] as Array<Record<string, unknown>>;
    const code = tsCode.replace(/'/g, "''");
    return querySql(`
      SELECT * FROM read_parquet('${sqlString(file.absolute)}')
      WHERE UPPER(CAST(ts_code AS VARCHAR)) = '${code}'
    `);
  };
  const [income, balance, cashflow, daily, dividend] = await Promise.all([
    read('income'),
    read('balance'),
    read('cashflow'),
    read('dailyBasic'),
    read('dividend'),
  ]);
  return {
    data: normalizeFinancialData(income, balance, cashflow, daily, dividend),
    sources: {
      income: existingFile(config, 'income')?.relative ?? null,
      balance: existingFile(config, 'balance')?.relative ?? null,
      cashflow: existingFile(config, 'cashflow')?.relative ?? null,
      daily_basic: existingFile(config, 'dailyBasic')?.relative ?? null,
      dividend: existingFile(config, 'dividend')?.relative ?? null,
    },
  };
}

export function readStockList(config: AppConfig): Array<Record<string, string>> {
  const file = existingFile(config, 'stockList');
  if (!file) return [];
  return parseCsv(fs.readFileSync(file.absolute, 'utf8'));
}

export async function queryDailyBasic(config: AppConfig, tsCode: string, limit: number) {
  const file = requireFile(config, 'dailyBasic');
  const code = tsCode.replace(/'/g, "''");
  const rows = await querySql(`
    SELECT trade_date, close, pe, pe_ttm, pb, total_mv, circ_mv, turnover_rate, volume_ratio, ps, ps_ttm, dv_ratio, dv_ttm
    FROM read_parquet('${sqlString(file.absolute)}')
    WHERE UPPER(CAST(ts_code AS VARCHAR)) = '${code}'
    ORDER BY trade_date DESC
    LIMIT ${Math.max(1, Math.floor(limit))}
  `);
  return { source: file.relative, rows };
}

export async function queryFflow(config: AppConfig, tsCode: string, limit: number) {
  const file = requireFile(config, 'fflow');
  const code = tsCode.replace(/'/g, "''");
  const rows = await querySql(`
    SELECT *
    FROM read_parquet('${sqlString(file.absolute)}')
    WHERE UPPER(CAST(ts_code AS VARCHAR)) = '${code}'
    ORDER BY trade_date DESC
    LIMIT ${Math.max(1, Math.floor(limit))}
  `);
  return { source: file.relative, rows };
}

const MARKET_WIDE = new Set(['margin', 'slbLen']);

export async function queryMarginTable(config: AppConfig, key: FileKey, tsCode: string, limit: number) {
  const file = requireFile(config, key);
  const marketWide = MARKET_WIDE.has(key);
  const code = tsCode.replace(/'/g, "''");
  const where = marketWide ? 'TRUE' : `UPPER(CAST(ts_code AS VARCHAR)) = '${code}'`;
  const rows = await querySql(`
    SELECT * FROM read_parquet('${sqlString(file.absolute)}')
    WHERE ${where}
    ORDER BY trade_date DESC
    LIMIT ${Math.max(1, Math.floor(limit))}
  `);
  return {
    source: file.relative,
    scope: marketWide ? 'market' : 'stock',
    filtered_by_ts_code: !marketWide,
    note: marketWide ? '这是全市场汇总表，不能当成单只股票的融资融券。' : null,
    rows,
  };
}
