'use client';

import { useState, useEffect } from 'react';
import DataGrid from '../components/DataGrid';
import BalanceSheetChart, { BREAKDOWN_FIELD_ORDER } from '../components/BalanceSheetChart';
import { Input } from '@/components/ui/input';

interface StockInfo {
  name: string;
  area: string;
  industry: string;
}

/** isShow=Y 的字段（默认显示），对应 balancesheet_vip.csv */
const BS_DEFAULT_SHOW = new Set([
  'ts_code', 'end_date', 'total_share', 'undistr_porfit',
  'money_cap', 'notes_receiv', 'accounts_receiv', 'inventories',
  'total_cur_assets', 'lt_eqt_invest', 'fix_assets', 'intan_assets', 'goodwill',
  'total_nca', 'total_assets',
  'lt_borr', 'st_borr', 'acct_payable',
  'total_cur_liab', 'total_ncl', 'total_liab',
  'minority_int', 'total_hldr_eqy_exc_min_int', 'total_hldr_eqy_inc_min_int',
  'total_liab_hldr_eqy',
  'accounts_receiv_bill', 'accounts_pay',
]);

const BS_DEFAULT_HIDDEN = new Set(
  [
    'ann_date', 'f_ann_date', 'report_type', 'comp_type', 'end_type',
    'cap_rese', 'surplus_rese', 'special_rese',
    'trad_asset', 'oth_receiv', 'prepayment', 'div_receiv', 'int_receiv',
    'amor_exp', 'nca_within_1y', 'sett_rsrv', 'loanto_oth_bank_fi',
    'premium_receiv', 'reinsur_receiv', 'reinsur_res_receiv', 'pur_resale_fa',
    'oth_cur_assets', 'fa_avail_for_sale', 'htm_invest', 'invest_real_estate',
    'time_deposits', 'oth_assets', 'lt_rec', 'cip', 'const_materials',
    'fixed_assets_disp', 'produc_bio_assets', 'oil_and_gas_assets', 'r_and_d',
    'lt_amor_exp', 'defer_tax_assets', 'decr_in_disbur', 'oth_nca',
    'cash_reser_cb', 'depos_in_oth_bfi', 'prec_metals', 'deriv_assets',
    'rr_reins_une_prem', 'rr_reins_outstd_cla', 'rr_reins_lins_liab',
    'rr_reins_lthins_liab', 'refund_depos', 'ph_pledge_loans', 'refund_cap_depos',
    'indep_acct_assets', 'client_depos', 'client_prov', 'transac_seat_fee',
    'invest_as_receiv',
    'cb_borr', 'depos_ib_deposits', 'loan_oth_bank', 'trading_fl', 'notes_payable',
    'adv_receipts', 'sold_for_repur_fa', 'comm_payable', 'payroll_payable',
    'taxes_payable', 'int_payable', 'div_payable', 'oth_payable', 'acc_exp',
    'deferred_inc', 'st_bonds_payable', 'payable_to_reinsurer', 'rsrv_insur_cont',
    'acting_trading_sec', 'acting_uw_sec', 'non_cur_liab_due_1y', 'oth_cur_liab',
    'bond_payable', 'lt_payable', 'specific_payables', 'estimated_liab',
    'defer_tax_liab', 'defer_inc_non_cur_liab', 'oth_ncl',
    'depos_oth_bfi', 'deriv_liab', 'depos', 'agency_bus_liab', 'oth_liab',
    'prem_receiv_adva', 'depos_received', 'ph_invest', 'reser_une_prem',
    'reser_outstd_claims', 'reser_lins_liab', 'reser_lthins_liab',
    'indept_acc_liab', 'pledge_borr', 'indem_payable', 'policy_div_payable',
    'treasury_share', 'ordin_risk_reser', 'forex_differ', 'invest_loss_unconf',
    'lt_payroll_payable', 'oth_comp_income', 'oth_eqt_tools', 'oth_eqt_tools_p_shr',
    'lending_funds', 'acc_receivable', 'st_fin_payable', 'payables',
    'hfs_assets', 'hfs_sales', 'cost_fin_assets', 'fair_value_fin_assets',
    'cip_total', 'oth_pay_total', 'long_pay_total', 'debt_invest',
    'oth_debt_invest', 'oth_eq_invest', 'oth_illiq_fin_assets', 'oth_eq_ppbond',
    'receiv_financing', 'use_right_assets', 'lease_liab',
    'contract_assets', 'contract_liab', 'oth_rcv_total', 'fix_assets_total',
    'update_flag',
  ]
);

const BS_COLUMN_ORDER = [
  'ts_code', 'ann_date', 'f_ann_date', 'end_date', 'report_type', 'comp_type', 'end_type',
  'total_share', 'cap_rese', 'undistr_porfit', 'surplus_rese', 'special_rese',
  'money_cap', 'trad_asset', 'notes_receiv', 'accounts_receiv', 'oth_receiv',
  'prepayment', 'div_receiv', 'int_receiv', 'inventories', 'amor_exp',
  'nca_within_1y', 'sett_rsrv', 'loanto_oth_bank_fi', 'premium_receiv',
  'reinsur_receiv', 'reinsur_res_receiv', 'pur_resale_fa', 'oth_cur_assets',
  'total_cur_assets',
  'fa_avail_for_sale', 'htm_invest', 'lt_eqt_invest', 'invest_real_estate',
  'time_deposits', 'oth_assets', 'lt_rec', 'fix_assets', 'cip', 'const_materials',
  'fixed_assets_disp', 'produc_bio_assets', 'oil_and_gas_assets', 'intan_assets',
  'r_and_d', 'goodwill', 'lt_amor_exp', 'defer_tax_assets', 'decr_in_disbur',
  'oth_nca', 'total_nca',
  'cash_reser_cb', 'depos_in_oth_bfi', 'prec_metals', 'deriv_assets',
  'rr_reins_une_prem', 'rr_reins_outstd_cla', 'rr_reins_lins_liab',
  'rr_reins_lthins_liab', 'refund_depos', 'ph_pledge_loans', 'refund_cap_depos',
  'indep_acct_assets', 'client_depos', 'client_prov', 'transac_seat_fee',
  'invest_as_receiv', 'total_assets',
  'lt_borr', 'st_borr', 'cb_borr', 'depos_ib_deposits', 'loan_oth_bank',
  'trading_fl', 'notes_payable', 'acct_payable', 'adv_receipts',
  'sold_for_repur_fa', 'comm_payable', 'payroll_payable', 'taxes_payable',
  'int_payable', 'div_payable', 'oth_payable', 'acc_exp', 'deferred_inc',
  'st_bonds_payable', 'payable_to_reinsurer', 'rsrv_insur_cont',
  'acting_trading_sec', 'acting_uw_sec', 'non_cur_liab_due_1y', 'oth_cur_liab',
  'total_cur_liab',
  'bond_payable', 'lt_payable', 'specific_payables', 'estimated_liab',
  'defer_tax_liab', 'defer_inc_non_cur_liab', 'oth_ncl', 'total_ncl',
  'depos_oth_bfi', 'deriv_liab', 'depos', 'agency_bus_liab', 'oth_liab',
  'prem_receiv_adva', 'depos_received', 'ph_invest', 'reser_une_prem',
  'reser_outstd_claims', 'reser_lins_liab', 'reser_lthins_liab',
  'indept_acc_liab', 'pledge_borr', 'indem_payable', 'policy_div_payable',
  'total_liab',
  'treasury_share', 'ordin_risk_reser', 'forex_differ', 'invest_loss_unconf',
  'minority_int', 'total_hldr_eqy_exc_min_int', 'total_hldr_eqy_inc_min_int',
  'total_liab_hldr_eqy',
  'lt_payroll_payable', 'oth_comp_income', 'oth_eqt_tools', 'oth_eqt_tools_p_shr',
  'lending_funds', 'acc_receivable', 'st_fin_payable', 'payables',
  'hfs_assets', 'hfs_sales', 'cost_fin_assets', 'fair_value_fin_assets',
  'cip_total', 'oth_pay_total', 'long_pay_total', 'debt_invest',
  'oth_debt_invest', 'oth_eq_invest', 'oth_illiq_fin_assets', 'oth_eq_ppbond',
  'receiv_financing', 'use_right_assets', 'lease_liab',
  'contract_assets', 'contract_liab', 'accounts_receiv_bill', 'accounts_pay',
  'oth_rcv_total', 'fix_assets_total', 'update_flag',
];

/** 表格列顺序：与细分图坐标字段同步，细分相关列靠前（ts_code/end_date 后紧跟 BREAKDOWN_FIELD_ORDER，再其余） */
const BS_COLUMN_ORDER_SYNC = (() => {
  const breakdownSet = new Set(BREAKDOWN_FIELD_ORDER);
  const orderSet = new Set(BS_COLUMN_ORDER);
  const breakdownInOrder = BREAKDOWN_FIELD_ORDER.filter((f) => orderSet.has(f));
  const rest = BS_COLUMN_ORDER.filter(
    (f) => f !== 'ts_code' && f !== 'end_date' && !breakdownSet.has(f),
  );
  return ['ts_code', 'end_date', ...breakdownInOrder, ...rest];
})();

/** 页签「细分」下的默认隐藏列：只显示 ts_code、end_date 与 BREAKDOWN_FIELD_ORDER，其余隐藏 */
const BS_DEFAULT_HIDDEN_BREAKDOWN = new Set(
  BS_COLUMN_ORDER_SYNC.filter(
    (f) => f !== 'ts_code' && f !== 'end_date' && !BREAKDOWN_FIELD_ORDER.includes(f),
  ),
);

const BS_FIELD_LABELS: Record<string, string> = {
  ts_code: 'TS股票代码', ann_date: '公告日期', f_ann_date: '实际公告日期',
  end_date: '报告期', report_type: '报表类型', comp_type: '公司类型',
  end_type: '报告期类型', total_share: '期末总股本', cap_rese: '资本公积金',
  undistr_porfit: '未分配利润', surplus_rese: '盈余公积金', special_rese: '专项储备',
  money_cap: '货币资金', trad_asset: '交易性金融资产', notes_receiv: '应收票据',
  accounts_receiv: '应收账款', oth_receiv: '其他应收款', prepayment: '预付款项',
  div_receiv: '应收股利', int_receiv: '应收利息', inventories: '存货',
  amor_exp: '待摊费用', nca_within_1y: '一年内到期的非流动资产',
  sett_rsrv: '结算备付金', loanto_oth_bank_fi: '拆出资金',
  premium_receiv: '应收保费', reinsur_receiv: '应收分保账款',
  reinsur_res_receiv: '应收分保合同准备金', pur_resale_fa: '买入返售金融资产',
  oth_cur_assets: '其他流动资产', total_cur_assets: '流动资产合计',
  fa_avail_for_sale: '可供出售金融资产', htm_invest: '持有至到期投资',
  lt_eqt_invest: '长期股权投资', invest_real_estate: '投资性房地产',
  time_deposits: '定期存款', oth_assets: '其他资产', lt_rec: '长期应收款',
  fix_assets: '固定资产', cip: '在建工程', const_materials: '工程物资',
  fixed_assets_disp: '固定资产清理', produc_bio_assets: '生产性生物资产',
  oil_and_gas_assets: '油气资产', intan_assets: '无形资产', r_and_d: '研发支出',
  goodwill: '商誉', lt_amor_exp: '长期待摊费用', defer_tax_assets: '递延所得税资产',
  decr_in_disbur: '发放贷款及垫款', oth_nca: '其他非流动资产',
  total_nca: '非流动资产合计', cash_reser_cb: '现金及存放中央银行款项',
  depos_in_oth_bfi: '存放同业和其它金融机构款项', prec_metals: '贵金属',
  deriv_assets: '衍生金融资产', rr_reins_une_prem: '应收分保未到期责任准备金',
  rr_reins_outstd_cla: '应收分保未决赔款准备金',
  rr_reins_lins_liab: '应收分保寿险责任准备金',
  rr_reins_lthins_liab: '应收分保长期健康险责任准备金',
  refund_depos: '存出保证金', ph_pledge_loans: '保户质押贷款',
  refund_cap_depos: '存出资本保证金', indep_acct_assets: '独立账户资产',
  client_depos: '客户资金存款', client_prov: '客户备付金',
  transac_seat_fee: '交易席位费', invest_as_receiv: '应收款项类投资',
  total_assets: '资产总计',
  lt_borr: '长期借款', st_borr: '短期借款', cb_borr: '向中央银行借款',
  depos_ib_deposits: '吸收存款及同业存放', loan_oth_bank: '拆入资金',
  trading_fl: '交易性金融负债', notes_payable: '应付票据', acct_payable: '应付账款',
  adv_receipts: '预收款项', sold_for_repur_fa: '卖出回购金融资产款',
  comm_payable: '应付手续费及佣金', payroll_payable: '应付职工薪酬',
  taxes_payable: '应交税费', int_payable: '应付利息', div_payable: '应付股利',
  oth_payable: '其他应付款', acc_exp: '预提费用', deferred_inc: '递延收益',
  st_bonds_payable: '应付短期债券', payable_to_reinsurer: '应付分保账款',
  rsrv_insur_cont: '保险合同准备金', acting_trading_sec: '代理买卖证券款',
  acting_uw_sec: '代理承销证券款', non_cur_liab_due_1y: '一年内到期的非流动负债',
  oth_cur_liab: '其他流动负债', total_cur_liab: '流动负债合计',
  bond_payable: '应付债券', lt_payable: '长期应付款',
  specific_payables: '专项应付款', estimated_liab: '预计负债',
  defer_tax_liab: '递延所得税负债', defer_inc_non_cur_liab: '递延收益-非流动负债',
  oth_ncl: '其他非流动负债', total_ncl: '非流动负债合计',
  depos_oth_bfi: '同业和其它金融机构存放款项', deriv_liab: '衍生金融负债',
  depos: '吸收存款', agency_bus_liab: '代理业务负债', oth_liab: '其他负债',
  prem_receiv_adva: '预收保费', depos_received: '存入保证金',
  ph_invest: '保户储金及投资款', reser_une_prem: '未到期责任准备金',
  reser_outstd_claims: '未决赔款准备金', reser_lins_liab: '寿险责任准备金',
  reser_lthins_liab: '长期健康险责任准备金', indept_acc_liab: '独立账户负债',
  pledge_borr: '质押借款', indem_payable: '应付赔付款',
  policy_div_payable: '应付保单红利', total_liab: '负债合计',
  treasury_share: '库存股', ordin_risk_reser: '一般风险准备',
  forex_differ: '外币报表折算差额', invest_loss_unconf: '未确认的投资损失',
  minority_int: '少数股东权益',
  total_hldr_eqy_exc_min_int: '股东权益合计(不含少数股东权益)',
  total_hldr_eqy_inc_min_int: '股东权益合计(含少数股东权益)',
  total_liab_hldr_eqy: '负债及股东权益总计',
  lt_payroll_payable: '长期应付职工薪酬', oth_comp_income: '其他综合收益',
  oth_eqt_tools: '其他权益工具', oth_eqt_tools_p_shr: '其他权益工具(优先股)',
  lending_funds: '融出资金', acc_receivable: '应收款项',
  st_fin_payable: '应付短期融资款', payables: '应付款项',
  hfs_assets: '持有待售的资产', hfs_sales: '持有待售的负债',
  cost_fin_assets: '以摊余成本计量的金融资产',
  fair_value_fin_assets: '以公允价值计量且其变动计入其他综合收益的金融资产',
  cip_total: '在建工程(合计)', oth_pay_total: '其他应付款(合计)',
  long_pay_total: '长期应付款(合计)', debt_invest: '债权投资',
  oth_debt_invest: '其他债权投资', oth_eq_invest: '其他权益工具投资',
  oth_illiq_fin_assets: '其他非流动金融资产', oth_eq_ppbond: '其他权益工具:永续债',
  receiv_financing: '应收款项融资', use_right_assets: '使用权资产',
  lease_liab: '租赁负债', contract_assets: '合同资产', contract_liab: '合同负债',
  accounts_receiv_bill: '应收票据及应收账款', accounts_pay: '应付票据及应付账款',
  oth_rcv_total: '其他应收款(合计)', fix_assets_total: '固定资产(合计)',
  update_flag: '更新标识',
};

const BS_YI_FIELDS = new Set([
  'total_share', 'cap_rese', 'undistr_porfit', 'surplus_rese', 'special_rese',
  'money_cap', 'trad_asset', 'notes_receiv', 'accounts_receiv', 'oth_receiv',
  'prepayment', 'div_receiv', 'int_receiv', 'inventories', 'amor_exp',
  'nca_within_1y', 'sett_rsrv', 'loanto_oth_bank_fi', 'premium_receiv',
  'reinsur_receiv', 'reinsur_res_receiv', 'pur_resale_fa', 'oth_cur_assets',
  'total_cur_assets',
  'fa_avail_for_sale', 'htm_invest', 'lt_eqt_invest', 'invest_real_estate',
  'time_deposits', 'oth_assets', 'lt_rec', 'fix_assets', 'cip', 'const_materials',
  'fixed_assets_disp', 'produc_bio_assets', 'oil_and_gas_assets', 'intan_assets',
  'r_and_d', 'goodwill', 'lt_amor_exp', 'defer_tax_assets', 'decr_in_disbur',
  'oth_nca', 'total_nca',
  'cash_reser_cb', 'depos_in_oth_bfi', 'prec_metals', 'deriv_assets',
  'rr_reins_une_prem', 'rr_reins_outstd_cla', 'rr_reins_lins_liab',
  'rr_reins_lthins_liab', 'refund_depos', 'ph_pledge_loans', 'refund_cap_depos',
  'indep_acct_assets', 'client_depos', 'client_prov', 'transac_seat_fee',
  'invest_as_receiv', 'total_assets',
  'lt_borr', 'st_borr', 'cb_borr', 'depos_ib_deposits', 'loan_oth_bank',
  'trading_fl', 'notes_payable', 'acct_payable', 'adv_receipts',
  'sold_for_repur_fa', 'comm_payable', 'payroll_payable', 'taxes_payable',
  'int_payable', 'div_payable', 'oth_payable', 'acc_exp', 'deferred_inc',
  'st_bonds_payable', 'payable_to_reinsurer', 'rsrv_insur_cont',
  'acting_trading_sec', 'acting_uw_sec', 'non_cur_liab_due_1y', 'oth_cur_liab',
  'total_cur_liab',
  'bond_payable', 'lt_payable', 'specific_payables', 'estimated_liab',
  'defer_tax_liab', 'defer_inc_non_cur_liab', 'oth_ncl', 'total_ncl',
  'depos_oth_bfi', 'deriv_liab', 'depos', 'agency_bus_liab', 'oth_liab',
  'prem_receiv_adva', 'depos_received', 'ph_invest', 'reser_une_prem',
  'reser_outstd_claims', 'reser_lins_liab', 'reser_lthins_liab',
  'indept_acc_liab', 'pledge_borr', 'indem_payable', 'policy_div_payable',
  'total_liab',
  'treasury_share', 'ordin_risk_reser', 'forex_differ', 'invest_loss_unconf',
  'minority_int', 'total_hldr_eqy_exc_min_int', 'total_hldr_eqy_inc_min_int',
  'total_liab_hldr_eqy',
  'lt_payroll_payable', 'oth_comp_income', 'oth_eqt_tools', 'oth_eqt_tools_p_shr',
  'lending_funds', 'acc_receivable', 'st_fin_payable', 'payables',
  'hfs_assets', 'hfs_sales', 'cost_fin_assets', 'fair_value_fin_assets',
  'cip_total', 'oth_pay_total', 'long_pay_total', 'debt_invest',
  'oth_debt_invest', 'oth_eq_invest', 'oth_illiq_fin_assets', 'oth_eq_ppbond',
  'receiv_financing', 'use_right_assets', 'lease_liab',
  'contract_assets', 'contract_liab', 'accounts_receiv_bill', 'accounts_pay',
  'oth_rcv_total', 'fix_assets_total',
]);

const BS_VALUE_MAPPINGS: Record<string, Record<string, string>> = {
  report_type: {
    '1': '1-合并报表',
    '2': '2-单季合并',
    '3': '3-调整单季合并表',
    '4': '4-调整合并报表',
    '5': '5-调整前合并报表',
    '6': '6-母公司报表',
    '7': '7-母公司单季表',
    '8': '8-母公司调整单季表',
    '9': '9-母公司调整表',
    '10': '10-母公司调整前报表',
    '11': '11-母公司调整前合并报表',
    '12': '12-母公司调整前报表',
  },
  comp_type: {
    '1': '1-一般工商业',
    '2': '2-银行',
    '3': '3-保险',
    '4': '4-证券',
  },
  end_type: {
    '1': '1-一季报',
    '2': '2-半年报',
    '3': '3-三季报',
    '4': '4-年报',
  },
};

export default function BalanceSheetPage() {
  const [groupByQuarter, setGroupByQuarter] = useState(false);
  const [selectedTsCode, setSelectedTsCode] = useState<string>('');
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
  /** 图表页签，用于与下表列筛选分页签缓存同步：trend=总趋势，breakdown=细分 */
  const [chartTab, setChartTab] = useState<'trend' | 'breakdown'>('trend');

  useEffect(() => {
    if (!selectedTsCode.trim()) {
      setStockInfo(null);
      return;
    }
    let cancelled = false;
    const fetchStockInfo = async () => {
      try {
        const res = await fetch(
          `/api/csv/stockList?ts_code=${encodeURIComponent(selectedTsCode.trim())}`,
        );
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (cancelled) return;
        const row = json.data?.[0];
        if (row) {
          setStockInfo({
            name: String(row.name ?? '').trim() || '—',
            area: String(row.area ?? '').trim() || '—',
            industry: String(row.industry ?? '').trim() || '—',
          });
        } else {
          setStockInfo(null);
        }
      } catch {
        if (!cancelled) setStockInfo(null);
      }
    };
    fetchStockInfo();
    return () => {
      cancelled = true;
    };
  }, [selectedTsCode]);

  return (
    <div className="space-y-6">
      {/* 控制面板 */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-white rounded-lg border border-gray-200">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="groupByQuarter"
            checked={groupByQuarter}
            onChange={(e) => setGroupByQuarter(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <label
            htmlFor="groupByQuarter"
            className="text-sm font-medium text-gray-700 cursor-pointer"
          >
            按季分组数据
          </label>
        </div>
        
        <div className="flex items-center gap-2">
          <label htmlFor="tsCode" className="text-sm font-medium text-gray-700">
            股票代码:
          </label>
          <Input
            id="tsCode"
            type="text"
            placeholder="例如: 000001.SZ"
            value={selectedTsCode}
            onChange={(e) => setSelectedTsCode(e.target.value)}
            className="w-40"
          />
        </div>

        {stockInfo && (
          <div className="flex flex-wrap items-center gap-3 ml-2 pl-4 border-l border-gray-200">
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <span className="font-medium text-gray-500">名称</span>
              <span className="font-medium text-gray-900">{stockInfo.name}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <span className="font-medium text-gray-500">所在地</span>
              <span className="text-gray-800">{stockInfo.area}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <span className="font-medium text-gray-500">行业</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-800">{stockInfo.industry}</span>
            </span>
          </div>
        )}
      </div>

      {/* 资产负债趋势图：页签与下表列筛选分页签缓存同步 */}
      {selectedTsCode && (
        <BalanceSheetChart
          tsCode={selectedTsCode}
          apiPath="/api/parq/balanceSheet"
          activeTab={chartTab}
          onTabChange={(value) => setChartTab(value === 'breakdown' ? 'breakdown' : 'trend')}
        />
      )}

      {/* 数据表格：按图表页签分页签缓存列显示，细分页签默认只显示 BREAKDOWN_FIELD_ORDER 相关列 */}
      <DataGrid 
        category="balanceSheet" 
        title="资产负债表"
        useServerPagination={false}
        apiPath="/api/parq/balanceSheet"
        extraQueryParams={{
          ...(groupByQuarter ? { groupByQuarter: true } : {}),
          ...(selectedTsCode ? { ts_code: selectedTsCode } : {}),
        }}
        columnOrder={BS_COLUMN_ORDER_SYNC}
        fieldLabelMap={BS_FIELD_LABELS}
        defaultHiddenFields={chartTab === 'breakdown' ? BS_DEFAULT_HIDDEN_BREAKDOWN : BS_DEFAULT_HIDDEN}
        tabId={chartTab === 'breakdown' ? 'breakdown' : undefined}
        valueMappings={BS_VALUE_MAPPINGS}
        yiFields={BS_YI_FIELDS}
      />
    </div>
  );
}