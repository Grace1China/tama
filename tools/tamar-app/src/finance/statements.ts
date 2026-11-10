export type StatementKind = 'balance' | 'income' | 'cashflow';

export function statementFileKey(kind: StatementKind): 'balance' | 'income' | 'cashflow' {
  return kind;
}

/**
 * 保留源行里的 null。现金流量表费用列维持 finan_exp，利润表维持 fin_exp。
 * Q1/Q3 的 net_profit 允许为空，不写成 0。
 */
export function presentStatement(kind: StatementKind, rows: Array<Record<string, unknown>>) {
  const expenseField = kind === 'cashflow' ? 'finan_exp' : kind === 'income' ? 'fin_exp' : null;
  const presented = rows.map((row) => {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === '__rn') continue;
      copy[key] = value === undefined ? null : value;
    }
    if (kind === 'cashflow' && Object.prototype.hasOwnProperty.call(row, 'net_profit')) {
      copy.net_profit = row.net_profit == null ? null : row.net_profit;
    }
    if (kind === 'income' && Object.prototype.hasOwnProperty.call(row, 'fin_exp')) {
      copy.fin_exp = row.fin_exp == null ? null : row.fin_exp;
    }
    if (kind === 'cashflow' && Object.prototype.hasOwnProperty.call(row, 'finan_exp')) {
      copy.finan_exp = row.finan_exp == null ? null : row.finan_exp;
    }
    return copy;
  });
  return {
    report: kind,
    source_file: kind === 'cashflow' ? 'tuShare/cashflow_vip_ss.parquet' : kind === 'income' ? 'tuShare/income_vip_ss.parquet' : 'tuShare/balancesheet_vip_ss.parquet',
    expense_field: expenseField,
    nulls_preserved: true,
    note:
      kind === 'cashflow'
        ? '现金流量表费用列是 finan_exp。利润表费用列是 fin_exp。Q1/Q3 的 net_profit 允许为 null，不补 0。'
        : kind === 'income'
          ? '利润表费用列是 fin_exp，与现金流量表的 finan_exp 不是同一列。'
          : '资产负债表按报告期返回，金额单位为源数据人民币元。',
    rows: presented,
  };
}
