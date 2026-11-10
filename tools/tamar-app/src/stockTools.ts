import type { AppConfig } from './config.js';
import { argCode, argLimit, argString } from './args.js';
import { loadDisclosures } from './cninfo.js';
import { presentStatement, type StatementKind } from './finance/statements.js';
import { freshness } from './freshness.js';
import { existingFile, type FileKey } from './paths.js';
import { SafeError } from './safety.js';
import { queryMarginTable, queryOrderedRows, queryQfqKline, queryStatement, readStockList } from './store.js';
import { dateDigits, maxDate } from './time.js';

export const stockTools = [
  tool('stock_profile', '个股资料：名称、地域、行业、上市日期。来自 ts_a_stock_list.csv。', {
    ts_code: { type: 'string' },
  }, profile, ['ts_code']),
  tool('stock_cninfo_disclosures', '巨潮 p_info3085 披露索引。字段沿用 F001D/F002V/F003V/F004V。', {
    ts_code: { type: 'string' },
    limit: { type: 'number' },
  }, disclosures, ['ts_code']),
  tool('stock_kline', '前复权 OHLCV 与换手率，由 bfq 和复权因子计算，不读取 qfqDir.parquet。', {
    ts_code: { type: 'string' },
    limit: { type: 'number' },
  }, kline, ['ts_code']),
  tool('stock_holders', '股东表。table=top10_holders、top10_floatholders 或 stk_holdernumber。', {
    ts_code: { type: 'string' },
    table: { type: 'string' },
    limit: { type: 'number' },
  }, holders, ['ts_code', 'table']),
  tool('stock_corporate_actions', '回购、股东增减持或限售解禁。金额保持源数据单位，多数为人民币元。', {
    ts_code: { type: 'string' },
    kind: { type: 'string' },
    limit: { type: 'number' },
  }, corporate, ['ts_code', 'kind']),
  tool('stock_shock', '个股异动、严重异动和交易所重点提示。某一张表为空时返回空列表。', {
    ts_code: { type: 'string' },
    limit: { type: 'number' },
  }, shock, ['ts_code']),
  tool('stock_margin', '融资融券。margin 与 slb_len 是全市场表，不会按 ts_code 当成个股明细。', {
    ts_code: { type: 'string' },
    table: { type: 'string' },
    limit: { type: 'number' },
  }, margin, ['ts_code', 'table']),
  tool('stock_financial_statement', '资产负债表、利润表或现金流量表。现金流量表默认合并口径 cashflow_vip_ss。费用列区分 finan_exp 与 fin_exp。Q1/Q3 的 net_profit 允许为 null。', {
    ts_code: { type: 'string' },
    report: { type: 'string' },
    limit: { type: 'number' },
  }, statement, ['ts_code', 'report']),
  tool('stock_forecast', '业绩预告。净利润上下限单位沿用源表，通常为万元，会在字段上标明。', {
    ts_code: { type: 'string' },
    limit: { type: 'number' },
  }, forecast, ['ts_code']),
  tool('stock_main_business', '主营业务构成 fina_mainbz。', {
    ts_code: { type: 'string' },
    limit: { type: 'number' },
  }, mainBusiness, ['ts_code']),
];

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  handler: (config: AppConfig, args: Record<string, unknown>) => Promise<unknown>,
  required?: string[],
) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, additionalProperties: false, ...(required ? { required } : {}) },
    handler,
  };
}

const HOLDER_TABLES: Record<string, { key: FileKey; order: string; share_fields: string[] }> = {
  top10_holders: { key: 'top10Holders', order: 'end_date', share_fields: ['hold_amount', 'hold_change'] },
  top10_floatholders: { key: 'top10FloatHolders', order: 'end_date', share_fields: ['hold_amount', 'hold_change'] },
  stk_holdernumber: { key: 'holderNumber', order: 'end_date', share_fields: [] },
};

const ACTION_TABLES: Record<string, { key: FileKey; order: string }> = {
  repurchase: { key: 'repurchase', order: 'ann_date' },
  holdertrade: { key: 'holderTrade', order: 'ann_date' },
  share_float: { key: 'shareFloat', order: 'float_date' },
};

async function profile(config: AppConfig, args: Record<string, unknown>) {
  const tsCode = argCode(args);
  const file = existingFile(config, 'stockList');
  const row = readStockList(config).find((item) => String(item.ts_code ?? '').toUpperCase() === tsCode) ?? null;
  return {
    ts_code: tsCode,
    profile: row,
    ...freshness({
      asOf: row?.list_date ?? null,
      source: file?.relative ?? 'ts_a_stock_list.csv',
      missing: !row,
      compareToSession: false,
    }),
  };
}

async function disclosures(config: AppConfig, args: Record<string, unknown>) {
  return loadDisclosures(config, argCode(args), argLimit(args, 50, 200));
}

async function kline(config: AppConfig, args: Record<string, unknown>) {
  const tsCode = argCode(args);
  const queried = await queryQfqKline(config, tsCode, argLimit(args, 120, 500));
  return {
    ts_code: tsCode,
    ...queried,
    ...freshness({
      asOf: maxDate(queried.bars.map((bar) => bar.trade_date)),
      source: queried.source,
      missing: queried.bars.length === 0,
    }),
  };
}

async function holders(config: AppConfig, args: Record<string, unknown>) {
  const table = argString(args, 'table');
  const spec = HOLDER_TABLES[table];
  if (!spec) throw new SafeError('bad_table', 'table 只能是 top10_holders、top10_floatholders 或 stk_holdernumber');
  const tsCode = argCode(args);
  const rows = await queryOrderedRows(config, spec.key, tsCode, spec.order, argLimit(args, 50, 200), true);
  return {
    ts_code: tsCode,
    table,
    share_unit: 'shares',
    share_scale: 'shares',
    ratio_unit: '%',
    ratio_scale: 'percent',
    share_fields: spec.share_fields,
    rows,
    ...freshness({
      asOf: maxDate(rows.map((row) => dateDigits(row.end_date))),
      source: existingFile(config, spec.key)?.relative ?? spec.key,
      missing: rows.length === 0,
      compareToSession: false,
    }),
  };
}

async function corporate(config: AppConfig, args: Record<string, unknown>) {
  const kind = argString(args, 'kind');
  const spec = ACTION_TABLES[kind];
  if (!spec) throw new SafeError('bad_kind', 'kind 只能是 repurchase、holdertrade 或 share_float');
  const tsCode = argCode(args);
  const rows = await queryOrderedRows(config, spec.key, tsCode, spec.order, argLimit(args, 50, 200), true);
  return {
    ts_code: tsCode,
    kind,
    amount_unit: 'CNY',
    amount_scale: 'yuan',
    share_unit: 'shares',
    share_scale: 'shares',
    rows,
    ...freshness({
      asOf: maxDate(rows.map((row) => dateDigits(row.ann_date ?? row.float_date ?? row.end_date))),
      source: existingFile(config, spec.key)?.relative ?? spec.key,
      missing: rows.length === 0,
      compareToSession: false,
    }),
    note: '金额保持源数据单位。回购 amount、增减持与解禁数量未改写成万元或万股。',
  };
}

async function readOptional(config: AppConfig, key: FileKey, tsCode: string, order: string, limit: number) {
  if (!existingFile(config, key)) {
    return { rows: [] as Array<Record<string, unknown>>, missing: true, source: key };
  }
  const rows = await queryOrderedRows(config, key, tsCode, order, limit, true);
  return { rows, missing: false, source: existingFile(config, key)?.relative ?? key };
}

async function shock(config: AppConfig, args: Record<string, unknown>) {
  const tsCode = argCode(args);
  const limit = argLimit(args, 50, 200);
  const [normal, high, alert] = await Promise.all([
    readOptional(config, 'shock', tsCode, 'trade_date', limit),
    readOptional(config, 'highShock', tsCode, 'trade_date', limit),
    readOptional(config, 'alert', tsCode, 'start_date', limit),
  ]);
  return {
    ts_code: tsCode,
    stk_shock: normal.rows,
    stk_high_shock: high.rows,
    stk_alert: alert.rows,
    ...freshness({
      asOf: maxDate([
        ...normal.rows.map((row) => dateDigits(row.trade_date)),
        ...high.rows.map((row) => dateDigits(row.trade_date)),
        ...alert.rows.map((row) => dateDigits(row.start_date)),
      ]),
      source: 'tuShare/stk_shock_ss.parquet',
      missing: normal.missing && high.missing && alert.missing,
      compareToSession: false,
    }),
  };
}

async function margin(config: AppConfig, args: Record<string, unknown>) {
  const table = argString(args, 'table');
  const map: Record<string, FileKey> = {
    margin: 'margin',
    margin_detail: 'marginDetail',
    margin_secs: 'marginSecs',
    slb_len: 'slbLen',
  };
  const key = map[table];
  if (!key) throw new SafeError('bad_table', 'table 只能是 margin、margin_detail、margin_secs 或 slb_len');
  const tsCode = argCode(args);
  const queried = await queryMarginTable(config, key, tsCode, argLimit(args, 30, 200));
  return {
    ts_code: tsCode,
    table,
    ...queried,
    amount_note: table === 'margin' || table === 'slb_len' ? '全市场表金额按源表口径返回，不折算成单只股票。' : '个股明细金额按源表口径返回。',
    ...freshness({
      asOf: maxDate(queried.rows.map((row) => dateDigits(row.trade_date))),
      source: queried.source,
      missing: queried.rows.length === 0,
    }),
  };
}

async function statement(config: AppConfig, args: Record<string, unknown>) {
  const report = argString(args, 'report');
  if (report !== 'balance' && report !== 'income' && report !== 'cashflow') {
    throw new SafeError('bad_report', 'report 只能是 balance、income 或 cashflow');
  }
  const tsCode = argCode(args);
  const key = report === 'balance' ? 'balance' : report === 'income' ? 'income' : 'cashflow';
  const rows = await queryStatement(config, key, tsCode, argLimit(args, 40, 200));
  const presented = presentStatement(report as StatementKind, rows);
  return {
    ts_code: tsCode,
    ...presented,
    amount_unit: 'CNY',
    amount_scale: 'yuan',
    ...freshness({
      asOf: maxDate(rows.map((row) => dateDigits(row.end_date))),
      source: presented.source_file,
      missing: rows.length === 0,
      compareToSession: false,
    }),
  };
}

async function forecast(config: AppConfig, args: Record<string, unknown>) {
  const tsCode = argCode(args);
  const rows = await queryOrderedRows(config, 'forecast', tsCode, 'ann_date', argLimit(args, 20, 100), true);
  return {
    ts_code: tsCode,
    rows,
    net_profit_unit: 'CNY',
    net_profit_scale: 'wan_yuan',
    change_unit: '%',
    change_scale: 'percent',
    ...freshness({
      asOf: maxDate(rows.map((row) => dateDigits(row.ann_date))),
      source: 'tuShare/forecast_ss.parquet',
      missing: rows.length === 0,
      compareToSession: false,
    }),
    note: 'net_profit_min/max 与 last_parent_net 在源表中多为万元。',
  };
}

async function mainBusiness(config: AppConfig, args: Record<string, unknown>) {
  const tsCode = argCode(args);
  const rows = await queryStatement(config, 'mainbz', tsCode, argLimit(args, 50, 200));
  return {
    ts_code: tsCode,
    rows,
    amount_unit: 'CNY',
    amount_scale: 'yuan',
    ...freshness({
      asOf: maxDate(rows.map((row) => dateDigits(row.end_date))),
      source: 'tuShare/fina_mainbz_vip_ss.parquet',
      missing: rows.length === 0,
      compareToSession: false,
    }),
  };
}
