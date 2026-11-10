import { labelPercent, labelTimes, type LabeledNumber } from './scale.js';

function meanTail(values: Array<number | null>, n: number): number | null {
  const picked: number[] = [];
  for (let i = values.length - 1; i >= 0 && picked.length < n; i -= 1) {
    const value = values[i];
    if (value != null && Number.isFinite(value)) picked.push(value);
  }
  if (!picked.length) return null;
  return picked.reduce((sum, value) => sum + value, 0) / picked.length;
}

export type QualityWindows = { n12: number | null; n8: number | null; n4: number | null; current: number | null };

function windows(values: Array<number | null>): QualityWindows {
  return { n12: meanTail(values, 12), n8: meanTail(values, 8), n4: meanTail(values, 4), current: meanTail(values, 1) };
}

function labeled(row: { label: string; scale: 'percent' | 'times'; values: QualityWindows }): {
  label: string;
  unit: string;
  scale: 'percent' | 'times';
  n12: LabeledNumber;
  n8: LabeledNumber;
  n4: LabeledNumber;
  current: LabeledNumber;
} {
  const wrap = row.scale === 'percent' ? labelPercent : labelTimes;
  return {
    label: row.label,
    unit: row.scale === 'percent' ? '%' : 'times',
    scale: row.scale,
    n12: wrap(row.values.n12, row.label),
    n8: wrap(row.values.n8, row.label),
    n4: wrap(row.values.n4, row.label),
    current: wrap(row.values.current, row.label),
  };
}

/**
 * 对比页四列表。ROE、毛利率、净利率的引擎值是 ratio_0_1，这里乘 100 后标成 percent。
 * 周转率保持倍数。研/销/管是费用 TTM / 营收 TTM 的百分数。
 */
export function buildQualityTable(points: Array<Record<string, number | null>>): Array<ReturnType<typeof labeled>> {
  const pick = (name: string) => points.map((point) => point[name] ?? null);
  const ratioToPercent = (name: string) => pick(name).map((value) => (value == null ? null : value * 100));
  const expense = (name: string) =>
    points.map((point) => {
      const revenue = point.total_revenue_ttm;
      const expenseValue = point[name];
      if (revenue == null || revenue <= 0 || expenseValue == null) return null;
      return (expenseValue / revenue) * 100;
    });
  return [
    labeled({ label: 'ROE', scale: 'percent', values: windows(ratioToPercent('roe_dupont')) }),
    labeled({ label: '毛利率', scale: 'percent', values: windows(ratioToPercent('grossMargin_ttm')) }),
    labeled({ label: '净利', scale: 'percent', values: windows(ratioToPercent('netMargin_ttm')) }),
    labeled({ label: '周转', scale: 'times', values: windows(pick('totalAsset_turnover_ttm')) }),
    labeled({ label: '研', scale: 'percent', values: windows(expense('rd_exp_ttm')) }),
    labeled({ label: '销', scale: 'percent', values: windows(expense('sell_exp_ttm')) }),
    labeled({ label: '管', scale: 'percent', values: windows(expense('admin_exp_ttm')) }),
  ];
}
