import { createMetricEngine, type FinancialData, type MetricValue } from '../metrics/engine.js';
import { metrics } from '../metrics/definitions.js';
import { isValidPeriod, parsePeriod } from '../metrics/period.js';
import { labelMetric } from './scale.js';
import { SafeError } from '../safety.js';

export const PAGE_SERIES_METRICS = [
  'total_revenue_ttm', 'n_income_attr_p_ttm', 'total_mv',
  'c_inf_fr_operate_a_ttm', 'n_cashflow_act_ttm',
  'oper_cost_ttm', 'grossMargin_ttm',
  'sell_exp_ttm', 'admin_exp_ttm', 'rd_exp_ttm',
  'total_hldr_eqy_exc_min_int',
  'dividend_ttm_rate',
  'mv_growth', 'revenue_growth', 'profit_growth', 'net_assets_growth',
  'netMargin_ttm', 'totalAsset_turnover_ttm', 'equity_multiplier_ttm', 'roe_dupont',
  'dcf_equity_value_ttm',
  'dcf_equity_value_ttm_growth_r',
  'dcf_equity_value_ttm_ni_growth_r',
  'dcf_equity_value_ttm_growth_ind',
  'dcf_equity_value_ttm_dividend',
  'dividend_ttm',
  'fcff_ttm', 'c_pay_acq_const_fiolta_ttm', 'net_debt',
  'st_borr', 'lt_borr', 'st_bonds_payable', 'bond_payable', 'money_cap', 'trad_asset',
];

function comparePeriod(a: string, b: string): number {
  const left = parsePeriod(a);
  const right = parsePeriod(b);
  if (left.year !== right.year) return left.year - right.year;
  return left.quarter - right.quarter;
}

function allPeriods(data: FinancialData): string[] {
  return [...new Set([
    ...Object.keys(data.income),
    ...Object.keys(data.balance),
    ...Object.keys(data.cashflow),
    ...Object.keys(data.dividend ?? {}),
    ...Object.keys(data.market ?? {}),
  ])].sort(comparePeriod);
}

function filterPeriods(periods: string[], from?: string | null, to?: string | null): string[] {
  return periods.filter((period) => {
    const current = parsePeriod(period);
    if (from) {
      const start = parsePeriod(from);
      if (current.year < start.year || (current.year === start.year && current.quarter < start.quarter)) return false;
    }
    if (to) {
      const end = parsePeriod(to);
      if (current.year > end.year || (current.year === end.year && current.quarter > end.quarter)) return false;
    }
    return true;
  });
}

export function buildMetricSeries(opts: {
  stockCode: string;
  data: FinancialData;
  metricNames: string[];
  from?: string | null;
  to?: string | null;
  years?: number | null;
  industryGrowthPct?: number | null;
}) {
  for (const name of opts.metricNames) {
    if (!metrics[name]) throw new SafeError('unknown_metric', `未知指标 ${name}`);
  }
  const from = opts.from ?? '2014Q1';
  const to = opts.to ?? '2026Q4';
  if (!isValidPeriod(from) || !isValidPeriod(to)) {
    throw new SafeError('bad_period', 'from/to 需要 YYYYQ[1-4]');
  }
  const available = allPeriods(opts.data);
  const periods = filterPeriods(available, from, to);
  const latest = available.length ? available[available.length - 1] : null;
  if (latest && comparePeriod(to, latest) > 0 && !periods.includes(to)) periods.push(to);

  const engine = createMetricEngine(metrics);
  const params: Record<string, unknown> = {};
  if (opts.years != null && Number.isFinite(opts.years)) params.years = opts.years;
  if (opts.industryGrowthPct != null && Number.isFinite(opts.industryGrowthPct)) {
    params.industry_growth_pct = opts.industryGrowthPct;
  }
  const engineParams = Object.keys(params).length ? params : undefined;

  const points = periods.map((period) => {
    const hasData = available.includes(period);
    const values = hasData
      ? engine.calculateMany(opts.metricNames, { stockCode: opts.stockCode, period, data: opts.data, params: engineParams })
      : Object.fromEntries(opts.metricNames.map((name) => [name, null as MetricValue]));
    const metricsOut: Record<string, ReturnType<typeof labelMetric>> = {};
    for (const name of opts.metricNames) metricsOut[name] = labelMetric(name, values[name] ?? null);
    return {
      period,
      missing: !hasData,
      metrics: metricsOut,
    };
  });

  return {
    stock: opts.stockCode,
    from,
    to,
    latest_period: latest,
    periods,
    points,
    note: latest && comparePeriod(to, latest) > 0 ? `${to} 晚于最新报告期 ${latest}，该期数值为 null。` : null,
  };
}
