import type { MetricRegistry, MetricValue } from '@/lib/metrics/engine';
import { lastNQuarters, prevQuarter, sameQuarterLastYear } from '@/lib/metrics/period';

function safeDivide(numerator: MetricValue, denominator: MetricValue): MetricValue {
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function shiftSameQuarter(period: string, yearsBack: number): string {
  const m = period.match(/^(\d{4})Q([1-4])$/);
  if (!m) throw new Error(`Invalid period: ${period}`);
  const year = Number(m[1]);
  const q = m[2];
  return `${year - yearsBack}Q${q}`;
}

function cagrPct(current: MetricValue, past: MetricValue, years: number): MetricValue {
  if (current == null || past == null) return null;
  if (past === 0) return null;
  const ratio = current / past;
  if (!(ratio > 0)) return null;
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}

function asNumber(v: unknown): MetricValue {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export const metrics: MetricRegistry = {
  /** daily_basic(按季度归档): total_mv — 总市值（万元） */
  total_mv: {
    meta: { label: '总市值(季度末，万元)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.market?.[period]?.total_mv ?? null,
  },
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
  /** income_vip: sell_exp — 减:销售费用（当年累计，与利润表披露一致） */
  sell_exp: {
    meta: { label: '销售费用(累计)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.sell_exp ?? null,
  },
  /** income_vip: admin_exp — 减:管理费用 */
  admin_exp: {
    meta: { label: '管理费用(累计)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.admin_exp ?? null,
  },
  /** income_vip: rd_exp — 研发费用 */
  rd_exp: {
    meta: { label: '研发费用(累计)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.rd_exp ?? null,
  },
  sell_exp_q: {
    meta: { label: '销售费用(单季)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.sell_exp_q ?? null,
  },
  admin_exp_q: {
    meta: { label: '管理费用(单季)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.admin_exp_q ?? null,
  },
  rd_exp_q: {
    meta: { label: '研发费用(单季)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.rd_exp_q ?? null,
  },
  grossMargin: {
    deps: ['total_revenue', 'total_cogs'],
    meta: { label: '毛利率', unit: '%', precision: 6 },
    compute: ({ total_revenue, total_cogs }) => {
      const tr = asNumber(total_revenue);
      const tc = asNumber(total_cogs);
      if (tr == null || tc == null) return null;
      return safeDivide(tr - tc, tr);
    },
  },
  n_income_attr_p: {
    meta: { label: '净利润(不含少数股东损益)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.income[period]?.n_income_attr_p ?? null,
  },
  /** 单季：净利润(归母) 由当年累计递推 */
  n_income_attr_p_q: {
    meta: { label: '净利润(不含少数股东损益)(单季)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => (data.income[period]?.n_income_attr_p_q as number | null) ?? null,
  },
  n_cashflow_act: {
    meta: { label: '经营活动产生的现金流量净额', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.cashflow[period]?.n_cashflow_act ?? null,
  },
  n_cashflow_act_q: {
    meta: { label: '经营活动产生的现金流量净额(单季)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.cashflow[period]?.n_cashflow_act_q ?? null,
  },
  /** 语义别名：与 n_income_attr_p / n_cashflow_act 同值，兼容旧 API 参数名 */
  netProfit: {
    deps: ['n_income_attr_p'],
    meta: { label: '净利润(不含少数股东损益)', unit: 'CNY', precision: 2 },
    compute: ({ n_income_attr_p }) => asNumber(n_income_attr_p),
  },
  cashflow_act: {
    deps: ['n_cashflow_act'],
    meta: { label: '经营活动产生的现金流量净额', unit: 'CNY', precision: 2 },
    compute: ({ n_cashflow_act }) => asNumber(n_cashflow_act),
  },
  n_cashflow_act_ttm: {
    meta: { label: '经营活动产生的现金流量滚动净额', unit: 'CNY', precision: 2 },
    // compute: ({ n_cashflow_act }) => asNumber(n_cashflow_act),
    compute: ({ period, stockCode, data, engine }) => {
      // console.log({ period, stockCode, data })
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('n_cashflow_act_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
  },
  cashflow_act_ttm: {
    meta: { label: '经营活动产生的现金流量滚动净额', unit: 'CNY', precision: 2 },
    // compute: ({ n_cashflow_act }) => asNumber(n_cashflow_act),
    compute: ({ period, stockCode, data, engine }) => {
      // console.log({ period, stockCode, data })
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('n_cashflow_act_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
  },

  c_inf_fr_operate_a_q: {
    meta: { label: '经营活动现金流入小计', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.cashflow[period]?.c_inf_fr_operate_a_q ?? null,
  },
  c_inf_fr_operate_a_ttm: {
    meta: { label: '经营活动现金流入小计', unit: 'CNY', precision: 2 },
    // compute: ({ data, period }) => data.cashflow[period]?.c_inf_fr_operate_a_q ?? null,
    compute: ({ period, stockCode, data, engine }) => {
      // console.log({ period, stockCode, data })
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('c_inf_fr_operate_a_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
  },

  total_hldr_eqy_exc_min_int: {
    meta: { label: '归母权益', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.total_hldr_eqy_exc_min_int ?? null,
  },
  money_cap: {
    meta: { label: '货币资金', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.money_cap ?? null,
  },
  total_cash: {
    meta: { label: '总现金', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => {
      const moneyCap = asNumber(data.balance[period]?.money_cap);
      const tradAsset = asNumber(data.balance[period]?.trad_asset);
      if (moneyCap == null && tradAsset == null) return null;
      return (moneyCap ?? 0) + (tradAsset ?? 0);
    },
  },
  notes_receiv: {
    meta: { label: '应收票据', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.notes_receiv ?? null,
  },
  accounts_receiv: {
    meta: { label: '应收账款', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.accounts_receiv ?? null,
  },
  accounts_receiv_bill: {
    meta: { label: '应收票据及应收账款', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.accounts_receiv_bill ?? null,
  },
  prepayment: {
    meta: { label: '预付款项', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.prepayment ?? null,
  },
  accounts_receiv_total: {
    meta: { label: '应收款合计', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => {
      const accountsReceiv = asNumber(data.balance[period]?.accounts_receiv);
      const accountsReceivBill = asNumber(data.balance[period]?.accounts_receiv_bill);
      if (accountsReceiv == null && accountsReceivBill == null) return null;
      return (accountsReceiv ?? 0) + (accountsReceivBill ?? 0);
    },
  },
  inventories: {
    meta: { label: '存货', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.inventories ?? null,
  },
  oth_cur_assets: {
    meta: { label: '其他流动资产', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.oth_cur_assets ?? null,
  },
  oth_nca: {
    meta: { label: '其他非流动资产', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.oth_nca ?? null,
  },
  total_cur_assets: {
    meta: { label: '流动资产合计', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.total_cur_assets ?? null,
  },
  lt_eqt_invest: {
    meta: { label: '长期股权投资', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.lt_eqt_invest ?? null,
  },
  fix_assets: {
    meta: { label: '固定资产', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.fix_assets ?? null,
  },
  intan_assets: {
    meta: { label: '无形资产', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.intan_assets ?? null,
  },
  goodwill: {
    meta: { label: '商誉', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.goodwill ?? null,
  },
  total_nca: {
    meta: { label: '非流动资产合计', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.total_nca ?? null,
  },
  total_assets: {
    meta: { label: '资产总计', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.total_assets ?? null,
  },
  st_borr: {
    meta: { label: '短期借款', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.st_borr ?? null,
  },
  acct_payable: {
    meta: { label: '应付账款', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.acct_payable ?? null,
  },
  accounts_pay: {
    meta: { label: '应付票据及应付账款', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.accounts_pay ?? null,
  },
  contract_liab: {
    meta: { label: '合同负债', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.contract_liab ?? null,
  },
  payroll_taxes_payable: {
    meta: { label: '薪酬和税费', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => {
      const payrollPayable = asNumber(data.balance[period]?.payroll_payable);
      const taxesPayable = asNumber(data.balance[period]?.taxes_payable);
      if (payrollPayable == null && taxesPayable == null) return null;
      return (payrollPayable ?? 0) + (taxesPayable ?? 0);
    },
  },
  oth_cur_liab: {
    meta: { label: '其他流动负债', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.oth_cur_liab ?? null,
  },
  oth_ncl: {
    meta: { label: '其他非流动负债', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.oth_ncl ?? null,
  },
  total_cur_liab: {
    meta: { label: '流动负债合计', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.total_cur_liab ?? null,
  },
  lt_borr: {
    meta: { label: '长期借款', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.lt_borr ?? null,
  },
  total_ncl: {
    meta: { label: '非流动负债合计', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.total_ncl ?? null,
  },
  total_liab: {
    meta: { label: '负债合计', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.total_liab ?? null,
  },
  minority_int: {
    meta: { label: '少数股东权益', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.minority_int ?? null,
  },
  total_hldr_eqy_inc_min_int: {
    meta: { label: '股东权益合计(含少数股东权益)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.total_hldr_eqy_inc_min_int ?? null,
  },
  total_liab_hldr_eqy: {
    meta: { label: '负债及股东权益总计', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.total_liab_hldr_eqy ?? null,
  },
  /** 口径别名：净资产按季末值使用（非滚动求和） */
  // total_hldr_eqy_exc_min_int_ttm: {
  //   deps: ['total_hldr_eqy_exc_min_int'],
  //   meta: { label: '净资产(TTM口径=季末值)', unit: 'CNY', precision: 2 },
  //   compute: ({ total_hldr_eqy_exc_min_int }) => asNumber(total_hldr_eqy_exc_min_int),
  // },
  roe: {
    deps: ['n_income_attr_p', 'total_hldr_eqy_exc_min_int'],
    meta: { label: 'ROE', unit: '%', precision: 6 },
    compute: ({ n_income_attr_p, total_hldr_eqy_exc_min_int }) => {
      const p = asNumber(n_income_attr_p);
      const e = asNumber(total_hldr_eqy_exc_min_int);
      return safeDivide(p, e);
    },
  },
  total_revenue_ttm: {
    meta: { label: '营收TTM(滚动四季度单季之和)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      // console.log({ period, stockCode, data })
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
  n_income_attr_p_ttm: {
    meta: { label: '净利润TTM(滚动四季度单季之和)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('n_income_attr_p_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
  },
  sell_exp_ttm: {
    meta: { label: '销售费用(TTM)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('sell_exp_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
  },
  admin_exp_ttm: {
    meta: { label: '管理费用(TTM)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('admin_exp_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
  },
  rd_exp_ttm: {
    meta: { label: '研发费用(TTM)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('rd_exp_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
  },
  grossMargin_ttm: {
    deps: ['total_revenue_ttm', 'oper_cost_ttm'],
    meta: { label: '毛利率(TTM)', unit: '%', precision: 6 },
    compute: ({ total_revenue_ttm, oper_cost_ttm }) => {
      const tr = asNumber(total_revenue_ttm);
      const oc = asNumber(oper_cost_ttm);
      if (tr == null || oc == null) return null;
      return safeDivide(tr - oc, tr);
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

  /**
   * 近 N 年（默认 5）复合增长率（CAGR，%）。
   * 计算口径：取「最近一个财报季」的指标值 vs 往前 N 年同季度的指标值。
   * years 由 /api/metrics?years=5 传入。
   */
  mv_growth: {
    deps: ['total_mv'],
    meta: { label: '市值近N年复合增长率', unit: '%', precision: 2 },
    compute: ({ total_mv, period, params, engine, stockCode, data }) => {
      const years = Math.max(1, Math.floor(Number((params as any)?.years ?? 5)));
      const currentPeriod =
        asNumber(total_mv) != null
          ? String(period)
          : prevQuarter(String(period));
      const current = asNumber(
        currentPeriod === String(period)
          ? total_mv
          : engine.calculate('total_mv', { stockCode, period: currentPeriod, data, params })
      );
      const pastPeriod = shiftSameQuarter(currentPeriod, years);
      const past = engine.calculate('total_mv', { stockCode, period: pastPeriod, data, params });
      return cagrPct(current, asNumber(past), years);
    },
  },
  revenue_growth: {
    deps: ['total_revenue_ttm'],
    meta: { label: '营收近N年复合增长率', unit: '%', precision: 2 },
    compute: ({ total_revenue_ttm, period, params, engine, stockCode, data }) => {
      const years = Math.max(1, Math.floor(Number((params as any)?.years ?? 5)));
      const currentPeriod =
        asNumber(total_revenue_ttm) != null
          ? String(period)
          : prevQuarter(String(period));
      const current = asNumber(
        currentPeriod === String(period)
          ? total_revenue_ttm
          : engine.calculate('total_revenue_ttm', { stockCode, period: currentPeriod, data, params })
      );
      const pastPeriod = shiftSameQuarter(currentPeriod, years);
      const past = engine.calculate('total_revenue_ttm', { stockCode, period: pastPeriod, data, params });
      return cagrPct(current, asNumber(past), years);
    },
  },
  profit_growth: {
    deps: ['n_income_attr_p_ttm'],
    meta: { label: '利润近N年复合增长率', unit: '%', precision: 2 },
    compute: ({ n_income_attr_p_ttm, period, params, engine, stockCode, data }) => {
      const years = Math.max(1, Math.floor(Number((params as any)?.years ?? 5)));
      const currentPeriod =
        asNumber(n_income_attr_p_ttm) != null
          ? String(period)
          : prevQuarter(String(period));
      const current = asNumber(
        currentPeriod === String(period)
          ? n_income_attr_p_ttm
          : engine.calculate('n_income_attr_p_ttm', { stockCode, period: currentPeriod, data, params })
      );
      const pastPeriod = shiftSameQuarter(currentPeriod, years);
      const past = engine.calculate('n_income_attr_p_ttm', { stockCode, period: pastPeriod, data, params });
      return cagrPct(current, asNumber(past), years);
    },
  },
  net_assets_growth: {
    deps: ['total_hldr_eqy_exc_min_int'],
    meta: { label: '净资产近N年复合增长率', unit: '%', precision: 2 },
    compute: ({ total_hldr_eqy_exc_min_int, period, params, engine, stockCode, data }) => {
      const years = Math.max(1, Math.floor(Number((params as any)?.years ?? 5)));
      const currentPeriod =
        asNumber(total_hldr_eqy_exc_min_int) != null
          ? String(period)
          : prevQuarter(String(period));
      const current = asNumber(
        currentPeriod === String(period)
          ? total_hldr_eqy_exc_min_int
          : engine.calculate('total_hldr_eqy_exc_min_int', { stockCode, period: currentPeriod, data, params })
      );
      const pastPeriod = shiftSameQuarter(currentPeriod, years);
      const past = engine.calculate('total_hldr_eqy_exc_min_int', { stockCode, period: pastPeriod, data, params });
      // console.log('净资产近N年复合增长率',{ current, past, years });
      return cagrPct(current, asNumber(past), years);
    },
  },
};
