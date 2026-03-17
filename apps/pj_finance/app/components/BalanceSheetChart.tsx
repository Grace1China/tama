'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Cell,
  LabelList,
} from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface BalanceSheetChartProps {
  tsCode: string;
  apiPath?: string;
  /** 受控的当前页签，与 onTabChange 一起使用以同步下表列筛选 */
  activeTab?: string;
  /** 页签切换时回调，用于与表格按页签缓存列显示同步 */
  onTabChange?: (value: string) => void;
}

interface RawRecord {
  [key: string]: string | number | null;
}

interface YearlyRow {
  year: string;
  total_assets: number;
  total_liab: number;
  equity: number;
  assets_yoy: number | null;
  liab_yoy: number | null;
  equity_yoy: number | null;
}

/** 细分柱状图一项：名称、数值(元)、资产/负债 */
interface BreakdownItem {
  name: string;
  value: number;
  type: 'asset' | 'liab';
}

const BILLION = 1e8;

/** 细分图与下表列顺序同步：按图表中出现的顺序排列的原始字段（用于表格 columnOrder） */
export const BREAKDOWN_FIELD_ORDER: string[] = [
  'money_cap',
  'trad_asset',
  'time_deposits',
  'accounts_receiv_bill',
  'notes_receiv',
  'accounts_receiv',
  'prepayment',
  'inventories',
  'oth_cur_assets',
  'lt_eqt_invest',
  'invest_real_estate',
  'fa_avail_for_sale',
  'htm_invest',
  'debt_invest',
  'oth_debt_invest',
  'oth_eq_invest',
  'fix_assets_total',
  'fix_assets',
  'cip_total',
  'cip',
  'intan_assets',
  'goodwill',
  'r_and_d',
  'total_nca',
  'st_borr',
  'accounts_pay',
  'notes_payable',
  'acct_payable',
  'contract_liab',
  'payroll_payable',
  'taxes_payable',
  'oth_cur_liab',
  'lt_borr',
  'total_ncl',
];

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatYiYuan(val: number): string {
  return (val / BILLION).toFixed(2) + ' 亿';
}

export default function BalanceSheetChart({
  tsCode,
  apiPath = '/api/parq/balanceSheet',
  activeTab: activeTabProp,
  onTabChange,
}: BalanceSheetChartProps) {
  const [internalTab, setInternalTab] = useState('trend');
  const activeTab = activeTabProp ?? internalTab;
  const handleTabChange = (value: string) => {
    setInternalTab(value);
    onTabChange?.(value);
  };
  const [rawData, setRawData] = useState<RawRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tsCode) {
      setRawData([]);
      return;
    }
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `${apiPath}?ts_code=${encodeURIComponent(
          tsCode,
        )}&page=1&size=10000&sortField=end_date&sortDir=asc&getAllDates=true`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setRawData(json.data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [tsCode, apiPath]);

  // 先按 ts_code + end_date + report_type 去重，保留 update_flag=1 的记录
  const dedupedData = useMemo(() => {
    if (!rawData.length) return [];
    const key = (r: RawRecord) => `${r.ts_code}_${r.end_date}_${r.report_type}`;
    const hasUpdated = new Set<string>();
    for (const row of rawData) {
      if (Number(row.update_flag) === 1) hasUpdated.add(key(row));
    }
    return rawData.filter((row) => {
      if (Number(row.update_flag) === 0 && hasUpdated.has(key(row))) return false;
      return true;
    });
  }, [rawData]);

  const yearlyData: YearlyRow[] = useMemo(() => {
    if (!dedupedData.length) return [];

    const parseYearMonth = (d: string): { year: string; month: number } => {
      const raw = d?.trim();
      if (!raw) return { year: '', month: 0 };
      const dt = new Date(raw.replace(/-/g, '/'));
      if (isNaN(dt.getTime())) return { year: '', month: 0 };
      const year = String(dt.getFullYear());
      const month = dt.getMonth() + 1; // 1-12
      return { year, month };
    };

    const yearMap = new Map<string, { total_assets: number; total_liab: number; equity: number }>();

    // 优先：report_type=1（合并报表）且 (end_type = 4 年报 或 end_date 为 12 月)
    for (const row of dedupedData) {
      if (String(row.report_type) !== '1') continue;
      const { year, month } = parseYearMonth(String(row.end_date ?? ''));
      const endType = String(row.end_type ?? '');
      if (!year || year.length !== 4) continue;
      if (!(endType === '4' || month === 12)) continue;

      const totalAssets = toNum(row.total_assets);
      const totalLiab = toNum(row.total_liab);
      const equity =
        toNum(row.total_hldr_eqy_exc_min_int) ||
        toNum(row.total_hldr_eqy_inc_min_int) ||
        totalAssets - totalLiab;

      yearMap.set(year, { total_assets: totalAssets, total_liab: totalLiab, equity });
    }

    // 若上述没有数据：退而求其次，所有记录里挑年报（end_type=4 或 12 月），不管 report_type
    if (yearMap.size === 0) {
      for (const row of dedupedData) {
        const { year, month } = parseYearMonth(String(row.end_date ?? ''));
        const endType = String(row.end_type ?? '');
        if (!year || year.length !== 4) continue;
        if (!(endType === '4' || month === 12)) continue;
        if (yearMap.has(year)) continue;

        const totalAssets = toNum(row.total_assets);
        const totalLiab = toNum(row.total_liab);
        const equity =
          toNum(row.total_hldr_eqy_exc_min_int) ||
          toNum(row.total_hldr_eqy_inc_min_int) ||
          totalAssets - totalLiab;

        yearMap.set(year, { total_assets: totalAssets, total_liab: totalLiab, equity });
      }
    }

    // 再不行：每年取一条最近的记录（不再强制年报）
    if (yearMap.size === 0) {
      for (const row of dedupedData) {
        const { year } = parseYearMonth(String(row.end_date ?? ''));
        if (!year || year.length !== 4) continue;
        if (yearMap.has(year)) continue;

        const totalAssets = toNum(row.total_assets);
        const totalLiab = toNum(row.total_liab);
        const equity =
          toNum(row.total_hldr_eqy_exc_min_int) ||
          toNum(row.total_hldr_eqy_inc_min_int) ||
          totalAssets - totalLiab;

        yearMap.set(year, { total_assets: totalAssets, total_liab: totalLiab, equity });
      }
    }

    const base = Array.from(yearMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, vals]) => ({ year, ...vals }));

    // 计算逐年同比变化率（%）
    const result: YearlyRow[] = [];
    for (let i = 0; i < base.length; i++) {
      const cur = base[i];
      const prev = i > 0 ? base[i - 1] : null;
      const assets_yoy =
        prev && prev.total_assets !== 0
          ? ((cur.total_assets - prev.total_assets) / prev.total_assets) * 100
          : null;
      const liab_yoy =
        prev && prev.total_liab !== 0
          ? ((cur.total_liab - prev.total_liab) / prev.total_liab) * 100
          : null;
      const equity_yoy =
        prev && prev.equity !== 0
          ? ((cur.equity - prev.equity) / prev.equity) * 100
          : null;
      result.push({
        year: cur.year,
        total_assets: cur.total_assets,
        total_liab: cur.total_liab,
        equity: cur.equity,
        assets_yoy,
        liab_yoy,
        equity_yoy,
      });
    }

    return result;
  }, [dedupedData]);

  // 年报行按年份：用于细分页签按年展示
  const annualRowsByYear = useMemo(() => {
    if (!dedupedData.length) return new Map<string, RawRecord>();
    const parseYearMonth = (d: string): { year: string; month: number } => {
      const raw = d?.trim();
      if (!raw) return { year: '', month: 0 };
      const dt = new Date(raw.replace(/-/g, '/'));
      if (isNaN(dt.getTime())) return { year: '', month: 0 };
      return { year: String(dt.getFullYear()), month: dt.getMonth() + 1 };
    };
    const map = new Map<string, RawRecord>();
    for (const row of dedupedData) {
      if (String(row.report_type) !== '1') continue;
      const { year, month } = parseYearMonth(String(row.end_date ?? ''));
      const endType = String(row.end_type ?? '');
      if (!year || year.length !== 4) continue;
      if (!(endType === '4' || month === 12)) continue;
      map.set(year, row);
    }
    if (map.size === 0) {
      for (const row of dedupedData) {
        const { year, month } = parseYearMonth(String(row.end_date ?? ''));
        const endType = String(row.end_type ?? '');
        if (!year || year.length !== 4) continue;
        if (!(endType === '4' || month === 12)) continue;
        if (!map.has(year)) map.set(year, row);
      }
    }
    if (map.size === 0) {
      for (const row of dedupedData) {
        const { year } = parseYearMonth(String(row.end_date ?? ''));
        if (!year || year.length !== 4) continue;
        if (!map.has(year)) map.set(year, row);
      }
    }
    return map;
  }, [dedupedData]);

  const breakdownYears = useMemo(
    () => Array.from(annualRowsByYear.keys()).sort((a, b) => b.localeCompare(a)),
    [annualRowsByYear],
  );

  const [breakdownYear, setBreakdownYear] = useState<string>('');
  const selectedBreakdownYear = breakdownYear || breakdownYears[0] || '';

  const breakdownData: BreakdownItem[] = useMemo(() => {
    const row = annualRowsByYear.get(selectedBreakdownYear);
    if (!row) return [];

    const v = (key: string) => toNum(row[key]);

    const assetItems: BreakdownItem[] = [
      { name: '现金理财', value: v('money_cap') + v('trad_asset') + v('time_deposits'), type: 'asset' },
      {
        name: '应收账款',
        value: v('accounts_receiv_bill') || v('notes_receiv') + v('accounts_receiv'),
        type: 'asset',
      },
      { name: '预付账款', value: v('prepayment'), type: 'asset' },
      { name: '存货', value: v('inventories'), type: 'asset' },
      { name: '其他流动', value: v('oth_cur_assets'), type: 'asset' },
      {
        name: '长期投资',
        value:
          v('lt_eqt_invest') +
          v('invest_real_estate') +
          v('fa_avail_for_sale') +
          v('htm_invest') +
          v('debt_invest') +
          v('oth_debt_invest') +
          v('oth_eq_invest'),
        type: 'asset',
      },
      {
        name: '固定+在建',
        value: (v('fix_assets_total') || v('fix_assets')) + (v('cip_total') || v('cip')),
        type: 'asset',
      },
      {
        name: '无形&商誉',
        value: v('intan_assets') + v('goodwill') + v('r_and_d'),
        type: 'asset',
      },
    ];
    const otherNca =
      v('total_nca') -
      (v('lt_eqt_invest') +
        v('invest_real_estate') +
        v('fa_avail_for_sale') +
        v('htm_invest') +
        v('debt_invest') +
        v('oth_debt_invest') +
        v('oth_eq_invest') +
        (v('fix_assets_total') || v('fix_assets')) +
        (v('cip_total') || v('cip')) +
        v('intan_assets') +
        v('goodwill') +
        v('r_and_d'));
    assetItems.push({ name: '其他固定', value: Math.max(0, otherNca), type: 'asset' });

    const liabItems: BreakdownItem[] = [
      { name: '短期借款', value: v('st_borr'), type: 'liab' },
      {
        name: '应付账款',
        value: v('accounts_pay') || v('notes_payable') + v('acct_payable'),
        type: 'liab',
      },
      { name: '合同负债', value: v('contract_liab'), type: 'liab' },
      { name: '薪酬&税务', value: v('payroll_payable') + v('taxes_payable'), type: 'liab' },
      { name: '其他流动', value: v('oth_cur_liab'), type: 'liab' },
      { name: '长期借款', value: v('lt_borr'), type: 'liab' },
      {
        name: '其他长期',
        value: Math.max(0, v('total_ncl') - v('lt_borr')),
        type: 'liab',
      },
    ];

    // 合同负债等关键项即使为 0 也显示，便于与下表列一致
    const alwaysShowNames = new Set(['合同负债']);
    return [...assetItems, ...liabItems].filter(
      (i) => i.value > 0 || alwaysShowNames.has(i.name),
    );
  }, [annualRowsByYear, selectedBreakdownYear]);

  useEffect(() => {
    if (breakdownYears.length > 0 && !breakdownYear) setBreakdownYear(breakdownYears[0]);
  }, [breakdownYears, breakdownYear]);

  if (!tsCode) return null;
  if (loading) return <div className="text-gray-500 text-sm py-4">图表加载中...</div>;
  if (error) return <div className="text-red-500 text-sm py-4">图表加载失败: {error}</div>;
  if (yearlyData.length === 0) return <div className="text-gray-400 text-sm py-4">暂无图表数据</div>;

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList>
        <TabsTrigger value="trend">总趋势</TabsTrigger>
        <TabsTrigger value="breakdown">细分</TabsTrigger>
      </TabsList>

      <TabsContent value="trend">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            总资产 / 负债 / 净资产 逐年变化（年报数据，单位：亿元）
          </h3>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={yearlyData} margin={{ top: 5, right: 40, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => (v / BILLION).toFixed(0)}
                label={{
                  value: '亿元',
                  angle: -90,
                  position: 'insideLeft',
                  offset: -5,
                  style: { fontSize: 12 },
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                label={{
                  value: '同比 (%)',
                  angle: 90,
                  position: 'insideRight',
                  offset: -5,
                  style: { fontSize: 12 },
                }}
              />
              <Tooltip
                formatter={(value: any, name: string, props: any) => {
                  const key = props.dataKey as string;
                  if (key.endsWith('_yoy')) {
                    if (value == null) return ['-', name];
                    return [`${(value as number).toFixed(2)}%`, name];
                  }
                  return [formatYiYuan(value as number), name];
                }}
              />
              <Legend />
              <Bar
                yAxisId="left"
                dataKey="total_assets"
                name="总资产"
                fill="#4F83CC"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                yAxisId="left"
                dataKey="total_liab"
                name="负债"
                fill="#E57373"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                yAxisId="left"
                dataKey="equity"
                name="净资产"
                fill="#66BB6A"
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="assets_yoy"
                name="总资产同比"
                stroke="#1565C0"
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="liab_yoy"
                name="负债同比"
                stroke="#C62828"
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="equity_yoy"
                name="净资产同比"
                stroke="#2E7D32"
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </TabsContent>

      <TabsContent value="breakdown">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h3 className="text-sm font-medium text-gray-700">
              {tsCode} {selectedBreakdownYear} 资产负债表（单位：亿元）
            </h3>
            {breakdownYears.length > 1 && (
              <select
                value={selectedBreakdownYear}
                onChange={(e) => setBreakdownYear(e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
              >
                {breakdownYears.map((y) => (
                  <option key={y} value={y}>
                    {y}年
                  </option>
                ))}
              </select>
            )}
          </div>
          {breakdownData.length === 0 ? (
            <div className="text-gray-400 text-sm py-8">暂无细分数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <BarChart
                data={breakdownData}
                margin={{ top: 28, right: 24, left: 20, bottom: 80 }}
                barCategoryGap={24}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={70}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(n: number) => (n / BILLION).toFixed(0)}
                  label={{
                    value: '亿元',
                    angle: -90,
                    position: 'insideLeft',
                    offset: -5,
                    style: { fontSize: 12 },
                  }}
                />
                <Tooltip
                  formatter={(value: number) => [formatYiYuan(value), '金额']}
                  labelFormatter={(label) => label}
                />
                <Legend
                  payload={[
                    { value: '资产', type: 'square', color: '#4F83CC' },
                    { value: '负债', type: 'square', color: '#E57373' },
                  ]}
                />
                <Bar
                  dataKey="value"
                  name="金额"
                  radius={[2, 2, 0, 0]}
                  minPointSize={4}
                  barSize={24}
                >
                  {breakdownData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.type === 'asset' ? '#4F83CC' : '#E57373'}
                    />
                  ))}
                  <LabelList
                    position="top"
                    formatter={(value: number) => (value / BILLION).toFixed(2)}
                    style={{ fontSize: 10 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}