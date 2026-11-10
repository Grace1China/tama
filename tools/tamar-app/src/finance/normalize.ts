import type { FinancialData, MetricValue } from '../metrics/engine.js';
import { parsePeriod } from '../metrics/period.js';

type RawRow = Record<string, unknown>;

function toDateDigits(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10).replace(/-/g, '');
  }
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizeEndDateToPeriod(endDate: unknown): string | null {
  if (endDate == null) return null;
  const text = toDateDigits(endDate);
  if (!/^\d{8}$/.test(text)) return null;
  const year = text.slice(0, 4);
  const map: Record<string, string> = { '0331': 'Q1', '0630': 'Q2', '0930': 'Q3', '1231': 'Q4' };
  const quarter = map[text.slice(4)];
  return quarter ? `${year}${quarter}` : null;
}

function normalizeDividendEndDateToPeriod(endDate: unknown): string | null {
  if (endDate == null) return null;
  const text = toDateDigits(endDate);
  if (/^\d{4}$/.test(text)) return `${text}Q4`;
  return normalizeEndDateToPeriod(endDate);
}

function endDateSortKey(endDate: unknown): number {
  const text = toDateDigits(endDate);
  return /^\d{8}$/.test(text) ? Number(text) : 0;
}

function previousQuarterSameYear(period: string): string | null {
  const { year, quarter } = parsePeriod(period);
  if (quarter <= 1) return null;
  return `${year}Q${quarter - 1}`;
}

function readQuarterField(
  quarterData: Record<string, Record<string, MetricValue>>,
  period: string,
  keys: string[],
): number | null {
  const slice = quarterData[period];
  if (!slice) return null;
  for (const key of keys) {
    const value = slice[key];
    if (value == null) continue;
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function mergeNonNullMetricRow(
  current: Record<string, MetricValue> | undefined,
  next: Record<string, MetricValue>,
): Record<string, MetricValue> {
  const merged: Record<string, MetricValue> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(next)) {
    if (value != null || merged[key] == null) merged[key] = value;
  }
  return merged;
}

function pickNumber(
  row: RawRow,
  keys: string[],
  opts?: { deaccumulateQuarterly?: boolean },
  ctx?: { income?: FinancialData['income']; cashflow?: FinancialData['cashflow']; period: string },
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
  const prev = previousQuarterSameYear(ctx.period);
  const source = ctx.income ?? ctx.cashflow;
  const prevYtd = source && prev ? readQuarterField(source, prev, keys) : null;
  if (quarter === 1) return current;
  if (prevYtd == null) return null;
  return current - prevYtd;
}

function tradeDateSortKey(tradeDate: unknown): number {
  const text = toDateDigits(tradeDate);
  return /^\d{8}$/.test(text) ? Number(text) : 0;
}

function normalizeTradeDateToPeriod(tradeDate: unknown): string | null {
  const text = toDateDigits(tradeDate);
  if (!/^\d{8}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const quarter = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `${year}Q${quarter}`;
}

function buildQuarterLastValueMap(rows: RawRow[], valueKey: string): Record<string, number> {
  const sorted = [...rows].sort((a, b) => tradeDateSortKey(a.trade_date) - tradeDateSortKey(b.trade_date));
  const out: Record<string, number> = {};
  for (const row of sorted) {
    const period = normalizeTradeDateToPeriod(row.trade_date);
    if (!period) continue;
    const value = row[valueKey];
    if (value == null) continue;
    const n = Number(value);
    if (!Number.isNaN(n)) out[period] = n;
  }
  return out;
}

/** 与 /api/metrics 相同的累计转单季和季度归档。 */
export function normalizeFinancialData(
  incomeRows: RawRow[],
  balanceRows: RawRow[],
  cashflowRows: RawRow[],
  dailyBasicRows: RawRow[],
  dividendRows: RawRow[],
): FinancialData {
  const data: FinancialData = { income: {}, balance: {}, cashflow: {}, dividend: {}, market: {} };
  const incomeSorted = [...incomeRows].sort((a, b) => endDateSortKey(a.end_date) - endDateSortKey(b.end_date));
  for (const row of incomeSorted) {
    const period = normalizeEndDateToPeriod(row.end_date);
    if (!period) continue;
    data.income[period] = {
      total_revenue: pickNumber(row, ['total_revenue']),
      total_cogs: pickNumber(row, ['total_cogs']),
      oper_cost: pickNumber(row, ['oper_cost']),
      n_income_attr_p: pickNumber(row, ['n_income_attr_p']),
      sell_exp: pickNumber(row, ['sell_exp']),
      admin_exp: pickNumber(row, ['admin_exp']),
      rd_exp: pickNumber(row, ['rd_exp']),
      total_revenue_q: pickNumber(row, ['total_revenue'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      total_cogs_q: pickNumber(row, ['total_cogs'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      oper_cost_q: pickNumber(row, ['oper_cost'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      n_income_attr_p_q: pickNumber(row, ['n_income_attr_p'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      sell_exp_q: pickNumber(row, ['sell_exp'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      admin_exp_q: pickNumber(row, ['admin_exp'], { deaccumulateQuarterly: true }, { income: data.income, period }),
      rd_exp_q: pickNumber(row, ['rd_exp'], { deaccumulateQuarterly: true }, { income: data.income, period }),
    };
  }

  for (const row of balanceRows) {
    const period = normalizeEndDateToPeriod(row.end_date);
    if (!period) continue;
    data.balance[period] = mergeNonNullMetricRow(data.balance[period], {
      money_cap: pickNumber(row, ['money_cap']),
      trad_asset: pickNumber(row, ['trad_asset']),
      notes_receiv: pickNumber(row, ['notes_receiv']),
      accounts_receiv: pickNumber(row, ['accounts_receiv']),
      accounts_receiv_bill: pickNumber(row, ['accounts_receiv_bill']),
      prepayment: pickNumber(row, ['prepayment']),
      inventories: pickNumber(row, ['inventories']),
      oth_cur_assets: pickNumber(row, ['oth_cur_assets']),
      oth_nca: pickNumber(row, ['oth_nca']),
      total_cur_assets: pickNumber(row, ['total_cur_assets']),
      lt_eqt_invest: pickNumber(row, ['lt_eqt_invest']),
      fix_assets: pickNumber(row, ['fix_assets']),
      intan_assets: pickNumber(row, ['intan_assets']),
      goodwill: pickNumber(row, ['goodwill']),
      total_nca: pickNumber(row, ['total_nca']),
      total_assets: pickNumber(row, ['total_assets']),
      st_borr: pickNumber(row, ['st_borr']),
      acct_payable: pickNumber(row, ['acct_payable']),
      accounts_pay: pickNumber(row, ['accounts_pay']),
      contract_liab: pickNumber(row, ['contract_liab']),
      payroll_payable: pickNumber(row, ['payroll_payable']),
      taxes_payable: pickNumber(row, ['taxes_payable']),
      oth_cur_liab: pickNumber(row, ['oth_cur_liab']),
      total_cur_liab: pickNumber(row, ['total_cur_liab']),
      lt_borr: pickNumber(row, ['lt_borr']),
      st_bonds_payable: pickNumber(row, ['st_bonds_payable']),
      bond_payable: pickNumber(row, ['bond_payable', 'bonds_payable']),
      total_ncl: pickNumber(row, ['total_ncl']),
      oth_ncl: pickNumber(row, ['oth_ncl']),
      total_liab: pickNumber(row, ['total_liab']),
      minority_int: pickNumber(row, ['minority_int']),
      total_hldr_eqy_exc_min_int: pickNumber(row, ['total_hldr_eqy_exc_min_int']),
      total_liab_hldr_eqy: pickNumber(row, ['total_liab_hldr_eqy']),
      loanto_oth_bank_fi: pickNumber(row, ['loanto_oth_bank_fi']),
      loan_oth_bank: pickNumber(row, ['loan_oth_bank']),
    });
  }

  const cashflowSorted = [...cashflowRows].sort((a, b) => endDateSortKey(a.end_date) - endDateSortKey(b.end_date));
  for (const row of cashflowSorted) {
    const period = normalizeEndDateToPeriod(row.end_date);
    if (!period) continue;
    data.cashflow[period] = {
      n_cashflow_act: pickNumber(row, ['n_cashflow_act']),
      n_cashflow_act_q: pickNumber(row, ['n_cashflow_act'], { deaccumulateQuarterly: true }, { cashflow: data.cashflow, period }),
      c_inf_fr_operate_a: pickNumber(row, ['c_inf_fr_operate_a']),
      c_inf_fr_operate_a_q: pickNumber(row, ['c_inf_fr_operate_a'], { deaccumulateQuarterly: true }, { cashflow: data.cashflow, period }),
      c_pay_acq_const_fiolta: pickNumber(row, ['c_pay_acq_const_fiolta']),
      c_pay_acq_const_fiolta_q: pickNumber(row, ['c_pay_acq_const_fiolta'], { deaccumulateQuarterly: true }, { cashflow: data.cashflow, period }),
    };
  }

  const mvByPeriod = buildQuarterLastValueMap(dailyBasicRows, 'total_mv');
  for (const [period, totalMv] of Object.entries(mvByPeriod)) {
    data.market![period] = { total_mv: totalMv };
  }
  const dividendSorted = [...dividendRows].sort((a, b) => endDateSortKey(a.end_date) - endDateSortKey(b.end_date));
  for (const row of dividendSorted) {
    const period = normalizeDividendEndDateToPeriod(row.end_date);
    if (!period) continue;
    data.dividend![period] = {
      cash_div_tax: pickNumber(row, ['cash_div_tax']),
      base_share: pickNumber(row, ['base_share']),
    };
  }

  const periods = new Set<string>([
    ...Object.keys(data.income),
    ...Object.keys(data.balance),
    ...Object.keys(data.cashflow),
    ...Object.keys(data.dividend ?? {}),
    ...Object.keys(data.market ?? {}),
  ]);
  const sorted = [...periods].sort();
  let lastMv: number | undefined;
  for (const period of sorted) {
    const current = data.market?.[period]?.total_mv;
    if (current != null) lastMv = current as number;
    else if (lastMv != null) data.market![period] = { total_mv: lastMv };
  }
  return data;
}
