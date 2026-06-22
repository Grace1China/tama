'use client';

import DataGrid from './DataGrid';

const REPORT_VALUE_MAPPINGS: Record<string, Record<string, string>> = {
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
};

/** 资产负债表弹框内默认隐藏的非核心列 */
const BS_MODAL_DEFAULT_HIDDEN = new Set([
  'ann_date', 'f_ann_date', 'report_type', 'comp_type', 'end_type', 'update_flag',
  'cap_rese', 'surplus_rese', 'special_rese', 'trad_asset', 'oth_receiv', 'prepayment',
  'div_receiv', 'int_receiv', 'amor_exp', 'nca_within_1y', 'sett_rsrv', 'loanto_oth_bank_fi',
  'premium_receiv', 'reinsur_receiv', 'reinsur_res_receiv', 'pur_resale_fa', 'oth_cur_assets',
  'fa_avail_for_sale', 'htm_invest', 'invest_real_estate', 'time_deposits', 'oth_assets',
  'lt_rec', 'cip', 'const_materials', 'fixed_assets_disp', 'produc_bio_assets', 'oil_and_gas_assets',
  'r_and_d', 'lt_amor_exp', 'defer_tax_assets', 'decr_in_disbur', 'oth_nca',
  'cash_reser_cb', 'depos_in_oth_bfi', 'prec_metals', 'deriv_assets',
  'cb_borr', 'depos_ib_deposits', 'loan_oth_bank', 'trading_fl', 'notes_payable',
  'adv_receipts', 'sold_for_repur_fa', 'comm_payable', 'int_payable', 'div_payable',
  'oth_payable', 'acc_exp', 'deferred_inc', 'st_bonds_payable', 'payable_to_reinsurer',
  'rsrv_insur_cont', 'acting_trading_sec', 'acting_uw_sec', 'non_cur_liab_due_1y', 'oth_cur_liab',
  'bond_payable', 'lt_payable', 'specific_payables', 'estimated_liab', 'defer_tax_liab',
  'defer_inc_non_cur_liab', 'oth_ncl', 'depos_oth_bfi', 'deriv_liab', 'depos', 'agency_bus_liab',
  'oth_liab', 'treasury_share', 'ordin_risk_reser', 'forex_differ', 'invest_loss_unconf',
  'lt_payroll_payable', 'oth_comp_income', 'oth_eqt_tools', 'oth_eqt_tools_p_shr',
  'lending_funds', 'acc_receivable', 'st_fin_payable', 'payables',
  'hfs_assets', 'hfs_sales', 'cost_fin_assets', 'fair_value_fin_assets',
  'cip_total', 'oth_pay_total', 'long_pay_total', 'debt_invest', 'oth_debt_invest',
  'oth_eq_invest', 'oth_illiq_fin_assets', 'oth_eq_ppbond', 'receiv_financing',
  'use_right_assets', 'lease_liab', 'contract_assets', 'contract_liab',
  'oth_rcv_total', 'fix_assets_total',
]);

const BS_YI_FIELDS = new Set([
  'total_share', 'undistr_porfit', 'money_cap', 'notes_receiv', 'accounts_receiv', 'inventories',
  'total_cur_assets', 'lt_eqt_invest', 'fix_assets', 'intan_assets', 'goodwill', 'total_nca',
  'total_assets', 'lt_borr', 'st_borr', 'acct_payable', 'total_cur_liab', 'total_ncl', 'total_liab',
  'minority_int', 'total_hldr_eqy_exc_min_int', 'total_hldr_eqy_inc_min_int', 'total_liab_hldr_eqy',
  'accounts_receiv_bill', 'accounts_pay',
]);

const INCOME_YI_FIELDS = new Set([
  'total_revenue', 'revenue', 'oper_cost', 'total_cogs', 'sell_exp', 'admin_exp', 'rd_exp',
  'fin_exp', 'n_income', 'n_income_attr_p', 'basic_eps', 'diluted_eps',
]);

const CASHFLOW_YI_FIELDS = new Set([
  'net_profit', 'c_fr_sale_sg', 'c_inf_fr_operate_a', 'c_paid_goods_s', 'c_paid_to_for_empl',
  'c_paid_for_taxes', 'st_cash_out_act', 'n_cashflow_act', 'stot_inflows_inv_act',
  'c_pay_acq_const_fiolta', 'c_paid_invest', 'stot_out_inv_act', 'n_cashflow_inv_act',
  'c_recp_borrow', 'stot_cash_in_fnc_act', 'free_cashflow', 'c_prepay_amt_borr',
  'c_pay_dist_dpcp_int_exp', 'stot_cashout_fnc_act', 'n_cash_flows_fnc_act',
  'n_incr_cash_cash_equ', 'c_cash_equ_beg_period', 'c_cash_equ_end_period',
]);

export type FinancialReportKind = 'balance' | 'income' | 'cashflow';

const REPORT_CONFIG: Record<
  FinancialReportKind,
  {
    title: string;
    category: string;
    apiPath: string;
    useServerPagination: boolean;
    extraQueryParams?: (code: string) => Record<string, string>;
    defaultHiddenFields?: Set<string>;
    yiFields: Set<string>;
  }
> = {
  balance: {
    title: '资产负债表（合并）',
    category: 'balanceSheet',
    apiPath: '/api/parq/balanceSheet',
    useServerPagination: false,
    defaultHiddenFields: BS_MODAL_DEFAULT_HIDDEN,
    yiFields: BS_YI_FIELDS,
  },
  income: {
    title: '利润表（合并）',
    category: 'income1',
    apiPath: '/api/parq/income1',
    useServerPagination: true,
    yiFields: INCOME_YI_FIELDS,
  },
  cashflow: {
    title: '现金流量表（合并）',
    category: 'cashflowStatement',
    apiPath: '/api/parq/cashflowStatement',
    useServerPagination: true,
    extraQueryParams: (code) => ({ ts_code: code, file: 'merged' }),
    yiFields: CASHFLOW_YI_FIELDS,
  },
};

export type StockFinancialStatementPanelProps = {
  tsCode: string;
  report: FinancialReportKind;
  active?: boolean;
};

/** 单张报表（合并），占满 tab 内容区 */
export function StockFinancialStatementPanel({
  tsCode,
  report,
  active = true,
}: StockFinancialStatementPanelProps) {
  if (!active || !tsCode.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        请选择有效证券代码
      </div>
    );
  }

  const code = tsCode.trim();
  const cfg = REPORT_CONFIG[report];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <DataGrid
        category={cfg.category}
        tabId={`stock_detail_modal_${report}`}
        title={cfg.title}
        tightChrome
        gridHeight="100%"
        useServerPagination={cfg.useServerPagination}
        apiPath={cfg.apiPath}
        extraQueryParams={cfg.extraQueryParams?.(code) ?? { ts_code: code }}
        defaultHiddenFields={cfg.defaultHiddenFields}
        valueMappings={REPORT_VALUE_MAPPINGS}
        yiFields={cfg.yiFields}
      />
    </div>
  );
}
