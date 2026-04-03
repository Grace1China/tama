import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';
import { createMetricEngine, type FinancialData, type MetricValue } from '@/lib/metrics/engine';
import { metrics } from '@/lib/metrics/definitions';
import { isValidPeriod, parsePeriod } from '@/lib/metrics/period';

export const dynamic = 'force-dynamic';

type RawRow = Record<string, unknown>;

function normalizeEndDateToPeriod(endDate: unknown): string | null {
  if (endDate == null) return null;
  const text = String(endDate).replace(/\D/g, '');
  if (!/^\d{8}$/.test(text)) return null;
  const year = text.slice(0, 4);
  const mmdd = text.slice(4);
  const map: Record<string, string> = {
    '0331': 'Q1',
    '0630': 'Q2',
    '0930': 'Q3',
    '1231': 'Q4',
  };
  const q = map[mmdd];
  return q ? `${year}${q}` : null;
}

function endDateSortKey(endDate: unknown): number {
  const text = String(endDate ?? '').replace(/\D/g, '');
  if (/^\d{8}$/.test(text)) return Number(text);
  return 0;
}

/** 同报告年度内上一季度 period，Q1 无上一季 */
function previousQuarterSameYear(period: string): string | null {
  const { year, quarter } = parsePeriod(period);
  if (quarter <= 1) return null;
  return `${year}Q${quarter - 1}`;
}

function readQuarterField(
  quarterData: Record<string, Record<string, MetricValue>>,
  period: string,
  keys: string[]
): number | null {
  const slice = quarterData[period];
  if (!slice) return null;
  for (const key of keys) {
    const v = slice[key as keyof typeof slice];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * 从行里取数；可选 `deaccumulateQuarterly`：把利润表「当年累计」转为单季
 * （Q1=当期累计；Q2/Q3/Q4=当期累计−同年前一季度累计）。需按 end_date 升序遍历，且先写入累计列。
 */
function pickNumber(
  row: RawRow,
  keys: string[],
  opts?: { deaccumulateQuarterly?: boolean },
  ctx?: { income?: FinancialData['income']; cashflow?: FinancialData['cashflow']; period: string }
): number | null {
  let current: number | null = null;
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const n = Number(value);
    if (!Number.isNaN(n)) {
      current = n;
      break;
    }
  }
  if (current == null) return null;
  if (!opts?.deaccumulateQuarterly || !ctx) return current;

  const { quarter } = parsePeriod(ctx.period);
  const prevP = previousQuarterSameYear(ctx.period);
  const source = ctx.income ?? ctx.cashflow;
  const prevYtd = source && prevP ? readQuarterField(source, prevP, keys) : null;
  if (quarter === 1) return current;
  if (prevYtd == null) return null;
  return current - prevYtd;
}

function latestPeriod(data: FinancialData): string | null {
  const periods = new Set<string>([
    ...Object.keys(data.income),
    ...Object.keys(data.balance),
    ...Object.keys(data.cashflow),
  ]);
  return Array.from(periods).sort().at(-1) ?? null;
}

function allPeriods(data: FinancialData): string[] {
  const periods = new Set<string>([
    ...Object.keys(data.income),
    ...Object.keys(data.balance),
    ...Object.keys(data.cashflow),
    ...Object.keys(data.market ?? {}),
  ]);
  return Array.from(periods).sort();
}

function comparePeriod(a: string, b: string): number {
  const pa = parsePeriod(a);
  const pb = parsePeriod(b);
  if (pa.year !== pb.year) return pa.year - pb.year;
  return pa.quarter - pb.quarter;
}

function filterPeriodsInRange(periods: string[], from?: string | null, to?: string | null): string[] {
  const sorted = periods.slice().sort(comparePeriod);
  const start = from ? parsePeriod(from) : null;
  const end = to ? parsePeriod(to) : null;

  return sorted.filter((p) => {
    const cur = parsePeriod(p);
    if (start) {
      if (cur.year < start.year) return false;
      if (cur.year === start.year && cur.quarter < start.quarter) return false;
    }
    if (end) {
      if (cur.year > end.year) return false;
      if (cur.year === end.year && cur.quarter > end.quarter) return false;
    }
    return true;
  });
}

function queryParquetRows(parquetPath: string, stockCode: string): Promise<RawRow[]> {
  if (!fs.existsSync(parquetPath)) {
    throw new Error(`Parquet file not found: ${parquetPath}`);
  }
  const absolutePath = path.resolve(parquetPath).replace(/\\/g, '/');

  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();
    const escapedStockCode = stockCode.replace(/'/g, "''");
    const sql = `SELECT * FROM read_parquet('${absolutePath}') WHERE ts_code='${escapedStockCode}'`;
    conn.all(sql, (err: Error | null, rows: RawRow[]) => {
      conn.close();
      db.close();
      if (err) {
        reject(new Error(`DuckDB query failed: ${err.message}`));
        return;
      }
      resolve(rows ?? []);
    });
  });
}

function normalizeFinancialData(
  incomeRows: RawRow[],
  balanceRows: RawRow[],
  cashflowRows: RawRow[],
  dailyBasicRows: RawRow[]
): FinancialData {
  const data: FinancialData = {
    income: {},
    balance: {},
    cashflow: {},
    market: {},
  };

  const incomeSorted = [...incomeRows].sort(
    (a, b) => endDateSortKey(a.end_date) - endDateSortKey(b.end_date)
  );
  for (const row of incomeSorted) {
    const period = normalizeEndDateToPeriod(row.end_date);
    if (!period) continue;
    data.income[period] = {
      // income_vip: total_revenue — 营业总收入
      total_revenue: pickNumber(row, ['total_revenue']),
      // income_vip: total_cogs — 营业总成本
      total_cogs: pickNumber(row, ['total_cogs']),
      oper_cost: pickNumber(row, ['oper_cost']),
      // income_vip: n_income_attr_p — 净利润(不含少数股东损益)
      n_income_attr_p: pickNumber(row, ['n_income_attr_p']),
      // income_vip: sell_exp — 减:销售费用
      sell_exp: pickNumber(row, ['sell_exp']),
      // income_vip: admin_exp — 减:管理费用
      admin_exp: pickNumber(row, ['admin_exp']),
      // income_vip: rd_exp — 研发费用
      rd_exp: pickNumber(row, ['rd_exp']),
      /** 单季：由当年累计值递推（Q1=累计；Q2=Q2累计−Q1累计…） */
      // income_vip: total_revenue — 营业总收入
      total_revenue_q: pickNumber(row, ['total_revenue'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      // income_vip: total_cogs — 营业总成本
      total_cogs_q: pickNumber(row, ['total_cogs'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      // income_vip: oper_cost — 营业成本
      oper_cost_q: pickNumber(row, ['oper_cost'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      // income_vip: n_income_attr_p — 净利润(不含少数股东损益)
      n_income_attr_p_q: pickNumber(row, ['n_income_attr_p'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      // income_vip: sell_exp — 减:销售费用
      sell_exp_q: pickNumber(row, ['sell_exp'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      // income_vip: admin_exp — 减:管理费用
      admin_exp_q: pickNumber(row, ['admin_exp'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      // income_vip: rd_exp — 研发费用
      rd_exp_q: pickNumber(row, ['rd_exp'], { deaccumulateQuarterly: true }, { income: data.income, period }),
    };
  }

  for (const row of balanceRows) {
    const period = normalizeEndDateToPeriod(row.end_date);
    if (!period) continue;
    data.balance[period] = {
      // balancesheet_vip: money_cap — 货币资金
      money_cap: pickNumber(row, ['money_cap']),
      // balancesheet_vip: trad_asset — 交易性金融资产
      trad_asset: pickNumber(row, ['trad_asset']),
      // balancesheet_vip: notes_receiv — 应收票据
      notes_receiv: pickNumber(row, ['notes_receiv']),
      // balancesheet_vip: accounts_receiv — 应收账款
      accounts_receiv: pickNumber(row, ['accounts_receiv']),
      // balancesheet_vip: accounts_receiv_bill — 应收票据及应收账款
      accounts_receiv_bill: pickNumber(row, ['accounts_receiv_bill']),
      // balancesheet_vip: prepayment — 预付款项
      prepayment: pickNumber(row, ['prepayment']),
      // balancesheet_vip: inventories — 存货
      inventories: pickNumber(row, ['inventories']),
      // balancesheet_vip: oth_cur_assets — 其他流动资产
      oth_cur_assets: pickNumber(row, ['oth_cur_assets']),
      // balancesheet_vip: oth_nca — 其他非流动资产
      oth_nca: pickNumber(row, ['oth_nca']),
      // balancesheet_vip: total_cur_assets — 流动资产合计
      total_cur_assets: pickNumber(row, ['total_cur_assets']),
      // balancesheet_vip: lt_eqt_invest — 长期股权投资
      lt_eqt_invest: pickNumber(row, ['lt_eqt_invest']),
      // balancesheet_vip: fix_assets — 固定资产
      fix_assets: pickNumber(row, ['fix_assets']),
      // balancesheet_vip: intan_assets — 无形资产
      intan_assets: pickNumber(row, ['intan_assets']),
      // balancesheet_vip: goodwill — 商誉
      goodwill: pickNumber(row, ['goodwill']),
      // balancesheet_vip: total_nca — 非流动资产合计
      total_nca: pickNumber(row, ['total_nca']),
      // balancesheet_vip: total_assets — 资产总计
      total_assets: pickNumber(row, ['total_assets']),
      // balancesheet_vip: st_borr — 短期借款
      st_borr: pickNumber(row, ['st_borr']),
      // balancesheet_vip: acct_payable — 应付账款
      acct_payable: pickNumber(row, ['acct_payable']),
      // balancesheet_vip: accounts_pay — 应付票据及应付账款
      accounts_pay: pickNumber(row, ['accounts_pay']),
      // balancesheet_vip: contract_liab — 合同负债
      contract_liab: pickNumber(row, ['contract_liab']),
      // balancesheet_vip: payroll_payable — 应付职工薪酬
      payroll_payable: pickNumber(row, ['payroll_payable']),
      // balancesheet_vip: taxes_payable — 应交税费
      taxes_payable: pickNumber(row, ['taxes_payable']),
      // balancesheet_vip: oth_cur_liab — 其他流动负债
      oth_cur_liab: pickNumber(row, ['oth_cur_liab']),
      // balancesheet_vip: total_cur_liab — 流动负债合计
      total_cur_liab: pickNumber(row, ['total_cur_liab']),
      // balancesheet_vip: lt_borr — 长期借款
      lt_borr: pickNumber(row, ['lt_borr']),
      // balancesheet_vip: total_ncl — 非流动负债合计
      total_ncl: pickNumber(row, ['total_ncl']),
      // balancesheet_vip: oth_ncl — 其他非流动负债
      oth_ncl: pickNumber(row, ['oth_ncl']),
      // balancesheet_vip: total_liab — 负债合计
      total_liab: pickNumber(row, ['total_liab']),
      // balancesheet_vip: minority_int — 少数股东权益
      minority_int: pickNumber(row, ['minority_int']),
      // balancesheet_vip: total_hldr_eqy_exc_min_int — 股东权益合计(不含少数股东权益)
      total_hldr_eqy_exc_min_int: pickNumber(row, ['total_hldr_eqy_exc_min_int']),
      // balancesheet_vip: total_liab_hldr_eqy — 负债及股东权益总计
      total_liab_hldr_eqy: pickNumber(row, ['total_liab_hldr_eqy']),
    };
  }

  for (const row of cashflowRows) {
    const period = normalizeEndDateToPeriod(row.end_date);
    if (!period) continue;
    data.cashflow[period] = {
      // cashflow_vip: n_cashflow_act — 经营活动产生的现金流量净额
      n_cashflow_act: pickNumber(row, ['n_cashflow_act']),
      // cashflow_vip: n_cashflow_act_q — 经营活动产生的现金流量单季净额
      n_cashflow_act_q: pickNumber(row, ['n_cashflow_act'], { deaccumulateQuarterly: true }, { cashflow: data.cashflow, period }),

      // cashflow_vip: c_inf_fr_operate_a — 经营活动现金流入小计
      c_inf_fr_operate_a:pickNumber(row,['c_inf_fr_operate_a']),
      // cashflow_vip: c_inf_fr_operate_a_q — 经营活动现金流入小计单季
      c_inf_fr_operate_a_q:pickNumber(row,['c_inf_fr_operate_a'], { deaccumulateQuarterly: true }, { cashflow: data.cashflow, period }),
    };
  }

  // daily_basic: total_mv — 总市值（万元），按季度取该季度最后一个交易日的值
  const mvByPeriod = buildQuarterLastValueMap(dailyBasicRows, 'total_mv');
  for (const [period, mv] of Object.entries(mvByPeriod)) {
    data.market![period] = { total_mv: mv };
  }

  return data;
}

function toResult(metricName: string, value: MetricValue) {
  const meta = metrics[metricName]?.meta;
  return {
    value,
    label: meta?.label ?? metricName,
    unit: meta?.unit ?? null,
    precision: meta?.precision ?? null,
  };
}

function normalizeTradeDateToPeriod(tradeDate: unknown): string | null {
  const text = String(tradeDate ?? '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const mm = Number(text.slice(4, 6));
  if (!Number.isFinite(year) || !Number.isFinite(mm)) return null;
  const quarter = mm <= 3 ? 1 : mm <= 6 ? 2 : mm <= 9 ? 3 : 4;
  return `${year}Q${quarter}`;
}

function tradeDateSortKey(tradeDate: unknown): number {
  const text = String(tradeDate ?? '').replace(/\D/g, '');
  return /^\d{8}$/.test(text) ? Number(text) : 0;
}

function buildQuarterLastValueMap(rows: RawRow[], valueKey: string): Record<string, number> {
  const sorted = [...rows].sort((a, b) => tradeDateSortKey(a.trade_date) - tradeDateSortKey(b.trade_date));
  const out: Record<string, number> = {};
  for (const r of sorted) {
    const p = normalizeTradeDateToPeriod(r.trade_date);
    if (!p) continue;
    const v = r[valueKey];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isNaN(n)) out[p] = n;
  }
  return out;
}


export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const stockCode = url.searchParams.get('stock') ?? url.searchParams.get('ts_code');
    const metric = url.searchParams.get('metric');
    const metricsParam = url.searchParams.get('metrics');
    const periodParam = url.searchParams.get('period');
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const periodsParam = url.searchParams.get('periods'); // comma-separated
    const yearsParam = url.searchParams.get('years');
    const series = url.searchParams.get('series') === 'true' || Boolean(fromParam || toParam || periodsParam);

    if (!stockCode) {
      return NextResponse.json({ error: 'Missing required query param: stock (or ts_code)' }, { status: 400 });
    }
    if (!metric && !metricsParam) {
      return NextResponse.json({ error: 'Missing required query param: metric or metrics' }, { status: 400 });
    }
    if (periodParam && !isValidPeriod(periodParam)) {
      return NextResponse.json({ error: 'Invalid period. Expected YYYYQ[1-4].' }, { status: 400 });
    }
    if (fromParam && !isValidPeriod(fromParam)) {
      return NextResponse.json({ error: 'Invalid from. Expected YYYYQ[1-4].' }, { status: 400 });
    }
    if (toParam && !isValidPeriod(toParam)) {
      return NextResponse.json({ error: 'Invalid to. Expected YYYYQ[1-4].' }, { status: 400 });
    }
    if (periodsParam) {
      const invalid = periodsParam
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .find((p) => !isValidPeriod(p));
      if (invalid) {
        return NextResponse.json({ error: `Invalid periods entry: ${invalid}. Expected YYYYQ[1-4].` }, { status: 400 });
      }
    }

    const [incomeRows, balanceRows, cashflowRows, dailyBasicRows] = await Promise.all([
      queryParquetRows(path.join(process.cwd(), 'temp/tuShare/income_vip_ss.parquet'), stockCode),
      // 使用按股票筛选后的 ss 文件；旧的 balanceSheet_vip.parquet 在部分股票上无 ts_code 对应行
      queryParquetRows(path.join(process.cwd(), 'temp/tuShare/balancesheet_vip_ss.parquet'), stockCode),
      queryParquetRows(path.join(process.cwd(), 'temp/tuShare/cashflow_vip_ss.parquet'), stockCode),
      queryParquetRows(path.join(process.cwd(), 'temp/tuShare/daily_basic_ss.parquet'), stockCode),
    ]);
    // console.log('incomeRows', incomeRows);
    console.log('balanceRows', balanceRows);
    // console.log('cashflowRows', cashflowRows);
    // console.log('dailyBasicRows', dailyBasicRows);
    const data = normalizeFinancialData(incomeRows, balanceRows, cashflowRows, dailyBasicRows);
    const available = allPeriods(data);
    if (available.length === 0) {
      return NextResponse.json({ error: `No financial rows found for stock ${stockCode}` }, { status: 404 });
    }
    const metricNames = metric
      ? [metric]
      : (metricsParam ?? '')
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean);
    
    console.log('metricNames', metricNames);
    

    const engine = createMetricEngine(metrics);
    const years = yearsParam == null ? null : Number(yearsParam);
    const params = years != null && Number.isFinite(years) ? { years } : undefined;

    if (!series) {
      const period = periodParam ?? latestPeriod(data);
      if (!period) {
        return NextResponse.json({ error: `No financial rows found for stock ${stockCode}` }, { status: 404 });
      }
      const values = engine.calculateMany(metricNames, { stockCode, period, data, params });
      const results = Object.fromEntries(metricNames.map((name) => [name, toResult(name, values[name] ?? null)]));
      return NextResponse.json({
        stock: stockCode,
        period,
        results,
        diagnostics: {
          availablePeriods: {
            income: Object.keys(data.income).sort(),
            balance: Object.keys(data.balance).sort(),
            cashflow: Object.keys(data.cashflow).sort(),
          },
        },
      });
    }

    const periods = periodsParam
      ? periodsParam
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
          .sort(comparePeriod)
      : filterPeriodsInRange(available, fromParam, toParam);

    const points = periods.map((period) => {
      const values = engine.calculateMany(metricNames, { stockCode, period, data, params });
      const row: Record<string, unknown> = { period };
      for (const name of metricNames) row[name] = values[name] ?? null;
      return row;
    });

    return NextResponse.json({
      stock: stockCode,
      periods,
      metrics: Object.fromEntries(metricNames.map((name) => [name, metrics[name]?.meta ?? null])),
      points,
      diagnostics: {
        availablePeriods: {
          income: Object.keys(data.income).sort(),
          balance: Object.keys(data.balance).sort(),
          cashflow: Object.keys(data.cashflow).sort(),
        },
      },
    });
  } catch (error) {
    console.error('[Metrics API] Failed to calculate metrics', error);
    return NextResponse.json(
      {
        error: 'Failed to calculate metrics',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
