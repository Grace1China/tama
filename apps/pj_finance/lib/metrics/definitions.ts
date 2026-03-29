import type { MetricRegistry, MetricValue } from '@/lib/metrics/engine';
import { lastNQuarters, sameQuarterLastYear } from '@/lib/metrics/period';

function safeDivide(numerator: MetricValue, denominator: MetricValue): MetricValue {
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export const metrics: MetricRegistry = {
  total_revenue: {
    meta: { label: '营业总收入(累计)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.total_revenue ?? null,
  },
  total_cogs: {
    meta: { label: '营业总成本(累计)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.total_cogs ?? null,
  },
  /** 单季：由当年累计值递推（Q1=累计；Q2=Q2累计−Q1累计…） */
  total_revenue_q: {
    meta: { label: '营业总收入(单季)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.total_revenue_q ?? null,
  },
  total_cogs_q: {
    meta: { label: '营业总成本(单季)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.total_cogs_q ?? null,
  },
  oper_cost_q: {
    meta: { label: '营业成本(单季)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.oper_cost_q ?? null,
  },
  grossMargin: {
    deps: ['total_revenue', 'total_cogs'],
    meta: { label: '毛利率', unit: '%', precision: 6 },
    compute: ({ total_revenue, total_cogs }) => {
      if (total_revenue == null || total_cogs == null) return null;
      return safeDivide(total_revenue - total_cogs, total_revenue);
    },
  },
  n_income_attr_p: {
    meta: { label: '净利润(不含少数股东损益)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.n_income_attr_p ?? null,
  },
  n_cashflow_act: {
    meta: { label: '经营活动产生的现金流量净额', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.cashflow[period]?.n_cashflow_act ?? null,
  },
  /** 语义别名：与 n_income_attr_p / n_cashflow_act 同值，兼容旧 API 参数名 */
  netProfit: {
    deps: ['n_income_attr_p'],
    meta: { label: '净利润(不含少数股东损益)', unit: 'CNY', precision: 2 },
    compute: ({ n_income_attr_p }) => n_income_attr_p ?? null,
  },
  cashflow_act: {
    deps: ['n_cashflow_act'],
    meta: { label: '经营活动产生的现金流量净额', unit: 'CNY', precision: 2 },
    compute: ({ n_cashflow_act }) => n_cashflow_act ?? null,
  },
  total_hldr_eqy_exc_min_int: {
    meta: { label: '归母权益', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.total_hldr_eqy_exc_min_int ?? null,
  },
  roe: {
    deps: ['n_income_attr_p', 'total_hldr_eqy_exc_min_int'],
    meta: { label: 'ROE', unit: '%', precision: 6 },
    compute: ({ n_income_attr_p, total_hldr_eqy_exc_min_int }) =>
      safeDivide(n_income_attr_p, total_hldr_eqy_exc_min_int),
  },
  total_revenue_ttm: {
    meta: { label: '营收TTM(滚动四季度单季之和)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('total_revenue_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
  },
  total_cogs_ttm: {
    meta: { label: '成本TTM(滚动四季度单季之和)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('total_cogs_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
  },
  oper_cost_ttm: {
    meta: { label: '营业成本(TTM)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('oper_cost_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
  },
  grossMargin_ttm: {
    deps: ['total_revenue_ttm', 'oper_cost_ttm'],
    meta: { label: '毛利率(TTM)', unit: '%', precision: 6 },
    compute: ({ total_revenue_ttm, oper_cost_ttm }) => {
      if (total_revenue_ttm == null || oper_cost_ttm == null) return null;
      return safeDivide(total_revenue_ttm - oper_cost_ttm, total_revenue_ttm);
    },
  },
  total_revenue_yoy: {
    meta: { label: '营收同比', unit: '%', precision: 6 },
    compute: ({ period, stockCode, data, engine }) => {
      const current = engine.calculate('total_revenue', { stockCode, period, data });
      const lastYearPeriod = sameQuarterLastYear(period);
      const lastYear = engine.calculate('total_revenue', { stockCode, period: lastYearPeriod, data });
      if (current == null || lastYear == null || lastYear === 0) return null;
      return (current - lastYear) / lastYear;
    },
  },
};
