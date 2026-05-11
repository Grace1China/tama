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
  /** cashflow_vip: 购建固定资产、无形资产和其他长期资产支付的现金（当年截至该季末累计，与报表披露一致） */
  c_pay_acq_const_fiolta: {
    meta: { label: '购建固定资产、无形资产和其他长期资产支付的现金(累计)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.cashflow[period]?.c_pay_acq_const_fiolta ?? null,
  },
  /** 单季：由当年累计递推 */
  c_pay_acq_const_fiolta_q: {
    meta: { label: '购建固定资产、无形资产和其他长期资产支付的现金(单季)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.cashflow[period]?.c_pay_acq_const_fiolta_q ?? null,
  },
  /** 近四个季度单季购建支出之和（与 n_cashflow_act_ttm 同一滚动口径） */
  c_pay_acq_const_fiolta_ttm: {
    meta: { label: '购建固定资产、无形资产和其他长期资产支付的现金(TTM)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => engine.calculate('c_pay_acq_const_fiolta_q', { stockCode, period: p, data }));
      if (values.some((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
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
  /** 近四个季度单季经营活动现金流净额之和；单季由当年累计在行内递推（normalize 时现金流须按 end_date 升序） */
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
  /** 与 route 资产负债表解析中的 trad_asset 一致（由 pickNumber 写入 balance） */
  trad_asset: {
    meta: { label: '交易性金融资产', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.trad_asset ?? null,
  },
  total_cash: {
    meta: { label: '总现金', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => {
      const moneyCap = asNumber(data.balance[period]?.money_cap);
      const tradAsset = asNumber(data.balance[period]?.trad_asset);
      const loansToOthBankFi = asNumber(data.balance[period]?.loanto_oth_bank_fi);
      if (moneyCap == null && tradAsset == null && loansToOthBankFi == null) return null;
      console.log('{ moneyCap, tradAsset, loansToOthBankFi }',{ moneyCap, tradAsset, loansToOthBankFi })
      return (moneyCap ?? 0) + (tradAsset ?? 0) + (loansToOthBankFi ?? 0);
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
    compute: ({ data, period }) => {
      const stBorr= data.balance[period]?.st_borr ?? null
      const loan_oth_bank = asNumber(data.balance[period]?.loan_oth_bank);
      if (stBorr == null && loan_oth_bank == null) return null;
      return (stBorr ?? 0) + (loan_oth_bank ?? 0);
    }
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
  /** 流动负债：应付短期债券（≤1 年），净负债有息部分需与 bond_payable 一并计入 */
  st_bonds_payable: {
    meta: { label: '应付短期债券', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.st_bonds_payable ?? null,
  },
  /** 非流动侧应付债券（>1 年）；源数据列名可为 bond_payable 或 bonds_payable，由 route 归一到 balance.bond_payable */
  bond_payable: {
    meta: { label: '应付债券(非流动)', unit: 'CNY', precision: 2 },
    compute: ({ data, period }) => data.balance[period]?.bond_payable ?? null,
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
  netMargin_ttm: {
    deps: ['n_income_attr_p_ttm', 'total_revenue_ttm'],
    meta: { label: '销售净利率(TTM)', unit: '%', precision: 6 },
    compute: ({ n_income_attr_p_ttm, total_revenue_ttm }) => {
      const ni = asNumber(n_income_attr_p_ttm);
      const tr = asNumber(total_revenue_ttm);
      if (ni == null || tr == null) return null;
      return safeDivide(ni, tr);
    },
  },
  totalAsset_turnover_ttm: {
    deps: ['total_revenue_ttm', 'total_assets'],
    meta: { label: '总资产周转率(TTM)', unit: 'times', precision: 4 },
    compute: ({ total_revenue_ttm,total_assets }) => {
      const tr = asNumber(total_revenue_ttm);
      const ta = asNumber(total_assets);
      if (tr == null || ta == null) return null;
      return safeDivide(tr, ta);
    },
  },
  equity_multiplier_ttm: {
    deps: ['total_assets', 'total_hldr_eqy_exc_min_int'],
    meta: { label: '权益乘数(TTM)', unit: 'times', precision: 4 },
    compute: ({ total_assets, total_hldr_eqy_exc_min_int }) => {
      const ta = asNumber(total_assets);
      const te = asNumber(total_hldr_eqy_exc_min_int);
      if (ta == null || te == null) return null;
      return safeDivide(ta, te);
    },
  },
  roe_dupont: {
    deps: ['netMargin_ttm', 'totalAsset_turnover_ttm','equity_multiplier_ttm'],
    meta: { label: 'roe_dupont', unit: '%', precision: 6 },
    compute: ({ netMargin_ttm, totalAsset_turnover_ttm,equity_multiplier_ttm }) => {
      const n = asNumber(netMargin_ttm);
      const t = asNumber(totalAsset_turnover_ttm);
      const e = asNumber(equity_multiplier_ttm);
      if (n == null || t == null || e == null) return null;
      return n*t*e
    },
  },

  roe: {
    deps: ['n_income_attr_p', 'total_hldr_eqy_exc_min_int'],
    meta: { label: 'ROE', unit: '%', precision: 6 },
    compute: ({ n_income_attr_p, total_hldr_eqy_exc_min_int }) => {
      const p = asNumber(n_income_attr_p);
      const e = asNumber(total_hldr_eqy_exc_min_int);
      return safeDivide(p, e);
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
  // /** dividend(按季度归档): cash_div_tax — 每股分红（税前） */
  // cash_div_tax: {
  //   meta: { label: '每股分红（税前）', unit: 'CNY', precision: 4 },
  //   compute: ({ data, period }) => data.dividend?.[period]?.cash_div_tax ?? null,
  // },
  // /** dividend(按季度归档): cash_div_tax — 每股分红（税前） */
  // cash_div_tax: {
  //   meta: { label: '每股分红（税前）', unit: 'CNY', precision: 4 },
  //   compute: ({ data, period }) => data.dividend?.[period]?.cash_div_tax ?? null,
  // },
  dividend_ttm:{
    meta: { label: '分红TTM(滚动四季度单季之和)', unit: 'CNY', precision: 2 },
    // compute: ({ data, period }) => data.balance[period]?.fix_assets ?? null,
    compute: ({ period, data, engine }) => {
      const periods = lastNQuarters(period, 4);
      const values = periods.map((p) => {
        const cashDivTax = asNumber(data.dividend?.[p]?.cash_div_tax ?? data.balance[p]?.cash_div_tax ?? null);
        const baseShare = asNumber(data.dividend?.[p]?.base_share ?? data.balance[p]?.base_share ?? null);
        if (cashDivTax == null || baseShare == null) return null;
        return cashDivTax * baseShare;
      });
      if (values.every((v) => v == null)) return null;
      return values.reduce<number>((sum, v) => sum + (v as number), 0);
    },
    // compute: ({ data, period }) => data.balance[period]?.fix_assets ?? null,
  },
  dividend_ttm_rate:{
    deps: ['dividend_ttm', 'total_mv'],
    meta: { label: '分红TTM率(滚动四季度单季之和/总市值)', unit: '%', precision: 2 },
    compute: ({ dividend_ttm, total_mv }) => {
      const d = asNumber(dividend_ttm);
      const t = asNumber(total_mv);
      if (d == null || t == null) return null;
      return safeDivide(d, t)
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
  // ==========================================
  // 1. 基础组件：自由现金流 (FCF)
  // ==========================================

  // 滚动 TTM：在同一 period 下用 engine 显式计算，避免误以为无报告期上下文
  fcff_ttm: {
    meta: { label: '企业自由现金流(TTM)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      const ocf = asNumber(engine.calculate('n_cashflow_act_ttm', { stockCode, period, data }));
      const capex = asNumber(engine.calculate('c_pay_acq_const_fiolta_ttm', { stockCode, period, data }));
      if (ocf == null || capex == null) return null;
      // FCF = 经营活动现金流量净额 TTM - 购建长期资产现金支出 TTM
      return ocf - capex;
    },
  },

  // ==========================================
  // 2. 基础组件：净负债 (Net Debt)
  // ==========================================

  net_debt: {
    meta: { label: '净负债', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine }) => {
      // 按 period 取各科期末值：有息负债（短借+长借+应付短期债券+应付债券非流动）-（货币资金 + 交易性金融资产）；trad_asset 为 route 归一字段
      const st = asNumber(engine.calculate('st_borr', { stockCode, period, data }));
      const lt = asNumber(engine.calculate('lt_borr', { stockCode, period, data }));
      const stBonds = asNumber(engine.calculate('st_bonds_payable', { stockCode, period, data }));
      const bondPayable = asNumber(engine.calculate('bond_payable', { stockCode, period, data }));
      const money = asNumber(engine.calculate('money_cap', { stockCode, period, data }));
      const trad = asNumber(data.balance[period]?.trad_asset);
      const totalDebt = (st ?? 0) + (lt ?? 0) + (stBonds ?? 0) + (bondPayable ?? 0);
      const totalCash = (money ?? 0) + (trad ?? 0);
      return totalDebt - totalCash;
    },
  },

  // ==========================================
  // 3 & 4. 核心引擎：DCF 股权价值计算
  // ==========================================

  // 以 fcff_ttm 为第 0 年现金流基数、同 period 资产负债表 net_debt 去杠杆
  dcf_equity_value_ttm: {
    meta: { label: 'DCF股权价值(TTM)', unit: 'CNY', precision: 2 },
    compute: ({ period, stockCode, data, engine, params }) => {
      const baseCtx = { stockCode, period, data, params };
      const fcf0 = asNumber(engine.calculate('fcff_ttm', baseCtx));
      const netDebt = asNumber(engine.calculate('net_debt', baseCtx)) ?? 0;

      if (fcf0 == null || fcf0 <= 0) {
        return null;
      }

      // --- 动态参数提取 (通过引擎的 params 传入，未传则给默认假设) ---
      const wacc = asNumber(params?.wacc) ?? 0.085;
      const g1 = asNumber(params?.stage1_growth) ?? 0.15;
      const g2 = asNumber(params?.terminal_growth) ?? 0.02;
      const projectionYears = asNumber(params?.projection_years) ?? 5;

      if (wacc <= g2) return null;

      let presentValueFCF = 0;
      let currentFCF = fcf0;

      for (let t = 1; t <= projectionYears; t++) {
        currentFCF *= (1 + g1);
        presentValueFCF += currentFCF / Math.pow(1 + wacc, t);
      }

      const terminalValue = (currentFCF * (1 + g2)) / (wacc - g2);
      const presentValueTV = terminalValue / Math.pow(1 + wacc, projectionYears);
      const ev = presentValueFCF + presentValueTV;
      return ev - netDebt;
    },
  },
};
