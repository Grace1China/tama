'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import DataGrid, { type CSVData } from '../components/DataGrid';
import { formatDateYYMM } from '@/lib/dateFormat';
import Link from 'next/link';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell as RCell,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
  Line,
  LineChart,
  BarChart,
  Cell,
  LabelList,
  Legend,
} from 'recharts';

/* ─── types ─── */

type StockInfo = { name: string; area: string; industry: string };

type MetricChart = {
  x: string[];
  series: number[][];
  labels: string[];
  latest: string[];
  note?: string;
  _stats?: { mean: number; high: number; low: number };
};

type MetricKey =
  | 'rev_mv'
  | 'rev_cashflow'
  | 'cost_margin'
  | 'fee_revenue'
  | 'growth_summary'
  | 'growth_trend'
  | 'balance_structure'
  | 'biz_comp'
  | 'ps_valuation'
  | 'pe_valuation'
  | 'pb_valuation'
  | 'dupont';

type HoldingRow = {
  ts_code: string;
  name: string;
  pool: 'growth' | 'cashflow';
  quantity: number;
  cost_price: number;
  latest_close: number;
  market_value: number;
  weight_pct: number;
  pnl: number;
  pnl_pct: number;
  factor_score: number | null;
  loading: boolean;
  error?: string;
  charts: Record<MetricKey, MetricChart>;
};

type GridRow = {
  stock_basic: HoldingRow;
} & Record<string, any>;

/* ─── constants ─── */

const PIE_COLORS = ['#3b82f6', '#f97316', '#94a3b8'];

const METRIC_COLUMNS: Array<{ key: MetricKey; label: string }> = [
  { key: 'rev_mv', label: '营收和市值' },
  { key: 'rev_cashflow', label: '营收和现金流' },
  { key: 'cost_margin', label: '成本与毛利率' },
  { key: 'fee_revenue', label: '三费与营收' },
  { key: 'growth_summary', label: '综合增长率' },
  { key: 'growth_trend', label: '综合增长率趋势' },
  { key: 'balance_structure', label: '资产负债结构' },
  { key: 'biz_comp', label: '业务构成' },
  { key: 'ps_valuation', label: '市销率估值' },
  { key: 'pe_valuation', label: '滚动市盈率估值' },
  { key: 'pb_valuation', label: '市净率估值' },
  { key: 'dupont', label: '杜邦分析' },
];

/* ─── helpers ─── */

function parseNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDateNum(v: unknown): number {
  const raw = String(v ?? '').trim();
  if (!raw) return NaN;
  if (/^\d{8}$/.test(raw)) return Number(raw);
  const m1 = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return Number(`${m1[1]}${String(m1[2]).padStart(2, '0')}${String(m1[3]).padStart(2, '0')}`);
  return NaN;
}

function pickSeries(values: Array<number | null | undefined>, maxPoints = 52): number[] {
  const filtered = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (filtered.length <= maxPoints) return filtered;
  const picked: number[] = [];
  const step = (filtered.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) picked.push(filtered[Math.round(i * step)]);
  return picked;
}

function sampleWithLabels(values: number[], labels: string[], maxPoints = 52) {
  if (values.length <= maxPoints) return { values, labels };
  const sv: number[] = [];
  const sl: string[] = [];
  const step = (values.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round(i * step);
    sv.push(values[idx]);
    sl.push(labels[idx] ?? String(i + 1));
  }
  return { values: sv, labels: sl };
}

function fmt(v: number | null, suffix = ''): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(2)}${suffix}`;
}

function emptyChart(note = '暂无数据'): MetricChart {
  return { x: [], series: [], labels: [], latest: [], note };
}

function emptyCharts(): Record<MetricKey, MetricChart> {
  return {
    rev_mv: emptyChart(), rev_cashflow: emptyChart(), cost_margin: emptyChart(),
    fee_revenue: emptyChart(), growth_summary: emptyChart(), growth_trend: emptyChart(),
    balance_structure: emptyChart(), biz_comp: emptyChart(), ps_valuation: emptyChart(),
    pe_valuation: emptyChart(), pb_valuation: emptyChart(), dupont: emptyChart(),
  };
}

async function fetchJson(url: string) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

function calcMeanStd(values: number[]) {
  if (!values.length) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

/* ─── build chart data for one holding (same logic as incomeContrast) ─── */

async function buildHoldingCharts(tsCode: string): Promise<Record<MetricKey, MetricChart>> {
  const charts = emptyCharts();
  try {
    const [
      incomeJson, dailyJson, cashflowJson, mainBizJson,
      costMarginJson, feeRevenueJson, growthSummaryJson,
      growthTrendJson, balanceJson, dupontJson,
    ] = await Promise.all([
      fetchJson(`/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_revenue_ttm,n_income_attr_p_ttm,total_mv&from=2014Q1&to=2026Q4`),
      fetchJson(`/api/parq/daily_basic?ts_code=${encodeURIComponent(tsCode)}&page=1&size=1000000&sortField=trade_date&sortDir=asc&start_date=20140101`),
      fetchJson(`/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_revenue_ttm,c_inf_fr_operate_a_ttm,n_income_attr_p_ttm,n_cashflow_act_ttm&from=2014Q1&to=2026Q4`),
      fetchJson(`/api/parq/finaMainbzVip?ts_code=${encodeURIComponent(tsCode)}&page=1&size=1000000&sortField=end_date&sortDir=asc&start_date=20140101`),
      fetchJson(`/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_revenue_ttm,oper_cost_ttm,grossMargin_ttm&from=2014Q1&to=2026Q4`),
      fetchJson(`/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_revenue_ttm,sell_exp_ttm,admin_exp_ttm,rd_exp_ttm&from=2014Q1&to=2026Q4`),
      fetchJson(`/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=mv_growth,revenue_growth,profit_growth,net_assets_growth&years=5`),
      fetchJson(`/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_mv,total_revenue_ttm,n_income_attr_p_ttm,total_hldr_eqy_exc_min_int,mv_growth,revenue_growth,profit_growth,net_assets_growth&years=5&from=2014Q1&to=2026Q4`),
      fetchJson(`/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_cash,prepayment,accounts_receiv,inventories,oth_cur_assets,lt_eqt_invest,fix_assets,intan_assets,oth_nca,st_borr,accounts_pay,contract_liab,payroll_taxes_payable,oth_cur_liab,lt_borr,oth_ncl`),
      fetchJson(`/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=netMargin_ttm,totalAsset_turnover_ttm,equity_multiplier_ttm,roe_dupont&from=2014Q1&to=2026Q4`),
    ]);

    const incomeRows = (Array.isArray(incomeJson?.points) ? incomeJson.points : [])
      .slice().sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
    const dailyRows = (Array.isArray(dailyJson?.data) ? dailyJson.data : [])
      .slice().sort((a: any, b: any) => parseDateNum(a?.trade_date) - parseDateNum(b?.trade_date));
    const cashflowRows = (Array.isArray(cashflowJson?.points) ? cashflowJson.points : [])
      .slice().sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));

    // rev_mv
    {
      type P = { x: string; rev: number; profit: number; mv: number };
      const allPts: P[] = incomeRows.map((r: any) => {
        const q = formatDateYYMM(r?.period);
        if (!q) return null;
        const rev = parseNum(r?.total_revenue_ttm);
        const profit = parseNum(r?.n_income_attr_p_ttm);
        const mv = parseNum(r?.total_mv);
        return { x: q, rev: rev == null ? NaN : rev / 1e8, profit: profit == null ? NaN : profit / 1e8, mv: mv == null ? NaN : mv / 1e4 };
      }).filter((p): p is P => p != null);
      charts.rev_mv = {
        x: allPts.map((p) => p.x), series: [allPts.map((p) => p.rev), allPts.map((p) => p.profit), allPts.map((p) => p.mv)],
        labels: ['TTM营收(亿)', 'TTM归母净利润(亿)', '总市值(亿)'],
        latest: [fmt(allPts.filter((p) => Number.isFinite(p.rev)).at(-1)?.rev ?? null, '亿'), fmt(allPts.filter((p) => Number.isFinite(p.profit)).at(-1)?.profit ?? null, '亿'), fmt(allPts.filter((p) => Number.isFinite(p.mv)).at(-1)?.mv ?? null, '亿')],
      };
    }

    // rev_cashflow
    charts.rev_cashflow = {
      x: sampleWithLabels(cashflowRows.map(() => 1), cashflowRows.map((r: any) => formatDateYYMM(r?.period))).labels,
      series: [
        pickSeries(cashflowRows.map((r: any) => { const n = parseNum(r?.total_revenue_ttm); return n == null ? null : n / 1e8; })),
        pickSeries(cashflowRows.map((r: any) => { const n = parseNum(r?.c_inf_fr_operate_a_ttm); return n == null ? null : n / 1e8; })),
        pickSeries(cashflowRows.map((r: any) => { const n = parseNum(r?.n_income_attr_p_ttm); return n == null ? null : n / 1e8; })),
        pickSeries(cashflowRows.map((r: any) => { const n = parseNum(r?.n_cashflow_act_ttm); return n == null ? null : n / 1e8; })),
      ],
      labels: ['TTM营收(亿)', 'TTM经营现金流入(亿)', 'TTM归母净利润(亿)', 'TTM经营现金流净额(亿)'],
      latest: [],
    };

    // cost_margin
    {
      const cmRows = (Array.isArray(costMarginJson?.points) ? costMarginJson.points : [])
        .slice().sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
      charts.cost_margin = {
        x: sampleWithLabels(cmRows.map(() => 1), cmRows.map((r: any) => formatDateYYMM(r?.period))).labels,
        series: [
          pickSeries(cmRows.map((r: any) => { const n = parseNum(r?.oper_cost_ttm); return n == null ? null : n / 1e8; })),
          pickSeries(cmRows.map((r: any) => { const n = parseNum(r?.total_revenue_ttm); return n == null ? null : n / 1e8; })),
          pickSeries(cmRows.map((r: any) => { const n = parseNum(r?.grossMargin_ttm); return n == null ? null : typeof n === 'number' ? n * 100 : null; })),
        ],
        labels: ['成本TTM(亿)', '营收TTM(亿)', '毛利率TTM%'],
        latest: [],
      };
    }

    // fee_revenue
    {
      const frRows = (Array.isArray(feeRevenueJson?.points) ? feeRevenueJson.points : [])
        .slice().sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
      charts.fee_revenue = {
        x: sampleWithLabels(frRows.map(() => 1), frRows.map((r: any) => formatDateYYMM(r?.period))).labels,
        series: [
          pickSeries(frRows.map((r: any) => { const n = parseNum(r?.total_revenue_ttm); return n == null ? null : n / 1e8; })),
          pickSeries(frRows.map((r: any) => { const n = parseNum(r?.sell_exp_ttm); return n == null ? null : n / 1e8; })),
          pickSeries(frRows.map((r: any) => { const n = parseNum(r?.admin_exp_ttm); return n == null ? null : n / 1e8; })),
          pickSeries(frRows.map((r: any) => { const n = parseNum(r?.rd_exp_ttm); return n == null ? null : n / 1e8; })),
        ],
        labels: ['营收TTM(亿)', '销售费TTM(亿)', '管理费TTM(亿)', '研发费TTM(亿)'],
        latest: [],
      };
    }

    // growth_summary
    {
      const pts = Array.isArray(growthSummaryJson?.points) ? growthSummaryJson.points : [];
      const latest = pts.at(-1) ?? {};
      const growthValues = [
        parseNum(latest?.mv_growth), parseNum(latest?.revenue_growth),
        parseNum(latest?.profit_growth), parseNum(latest?.net_assets_growth),
      ].map((v) => (v == null ? NaN : v));
      charts.growth_summary = {
        x: ['市值', '营收', '净利润', '净资产'],
        series: [growthValues],
        labels: ['5年CAGR%'],
        latest: growthValues.map((v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—')),
      };
    }

    // growth_trend
    {
      const gtRows = (Array.isArray(growthTrendJson?.points) ? growthTrendJson.points : [])
        .slice().sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
      const sampled = sampleWithLabels(gtRows.map(() => 1), gtRows.map((r: any) => formatDateYYMM(r?.period)));
      const idxArr = sampled.labels.map((lbl: string) => gtRows.findIndex((r: any) => formatDateYYMM(r?.period) === lbl)).filter((i: number) => i >= 0);
      const sp = idxArr.map((i: number) => gtRows[i]);
      charts.growth_trend = {
        x: sp.map((r: any) => formatDateYYMM(r?.period)),
        series: [
          sp.map((r: any) => { const n = parseNum(r?.n_income_attr_p_ttm); return n == null ? NaN : n / 1e8; }),
          sp.map((r: any) => { const n = parseNum(r?.total_revenue_ttm); return n == null ? NaN : n / 1e8; }),
          sp.map((r: any) => { const n = parseNum(r?.total_hldr_eqy_exc_min_int); return n == null ? NaN : n / 1e8; }),
          sp.map((r: any) => { const n = parseNum(r?.total_mv); return n == null ? NaN : n / 1e4; }),
          sp.map((r: any) => { const n = parseNum(r?.profit_growth); return n == null ? NaN : n; }),
          sp.map((r: any) => { const n = parseNum(r?.revenue_growth); return n == null ? NaN : n; }),
          sp.map((r: any) => { const n = parseNum(r?.net_assets_growth); return n == null ? NaN : n; }),
          sp.map((r: any) => { const n = parseNum(r?.mv_growth); return n == null ? NaN : n; }),
        ],
        labels: ['归母净利润TTM(亿)', '营收TTM(亿)', '归母所有者权益(亿)', '总市值(亿)', '利润5年CAGR', '营收5年CAGR', '净资产5年CAGR', '市值5年CAGR'],
        latest: [],
      };
    }

    // balance_structure
    {
      const bRows = (Array.isArray(balanceJson?.points) ? balanceJson.points : []);
      const latest = bRows.at(-1) ?? {};
      const items = [
        { key: 'total_cash', short: '现金', full: '现金及等价物' },
        { key: 'accounts_receiv', short: '应收', full: '应收账款' },
        { key: 'inventories', short: '存货', full: '存货' },
        { key: 'fix_assets', short: '固定', full: '固定资产' },
        { key: 'st_borr', short: '短借', full: '短期借款' },
        { key: 'accounts_pay', short: '应付', full: '应付账款' },
        { key: 'lt_borr', short: '长借', full: '长期借款' },
      ];
      const vals = items.map((it) => { const n = parseNum(latest?.[it.key]); return n == null ? NaN : n / 1e8; });
      charts.balance_structure = {
        x: items.map((it) => it.short),
        series: [vals],
        labels: items.map((it) => it.full),
        latest: vals.map((v) => fmt(v, '亿')),
      };
    }

    // biz_comp
    {
      const mainBizRows = (Array.isArray(mainBizJson?.data) ? mainBizJson.data : [])
        .slice().sort((a: any, b: any) => parseDateNum(a?.end_date) - parseDateNum(b?.end_date));
      const latest = mainBizRows.filter((r: any) => String(r?.bz_item ?? '').trim());
      const latestDate = latest.at(-1)?.end_date;
      const latestItems = latestDate ? latest.filter((r: any) => r?.end_date === latestDate) : [];
      const topItems: string[] = latestItems.sort((a: any, b: any) => (Number(b?.bz_sales ?? 0)) - (Number(a?.bz_sales ?? 0))).slice(0, 6).map((r: any) => String(r?.bz_item ?? ''));
      charts.biz_comp = {
        x: topItems,
        series: [topItems.map((item: string) => { const r = latestItems.find((x: any) => x?.bz_item === item); const n = parseNum(r?.bz_sales); return n == null ? NaN : n / 1e8; })],
        labels: ['营业收入(亿)'],
        latest: [],
      };
    }

    // valuation charts (ps/pe/pb)
    const buildValuationChart = (rawValues: Array<number | null>, label: string): MetricChart => {
      const sampled = sampleWithLabels(
        rawValues.map((v) => v ?? NaN),
        dailyRows.map((r: any) => formatDateYYMM(r?.trade_date)),
      );
      const validPairs = sampled.values.map((v: number, i: number) => ({ v, l: sampled.labels[i] })).filter((p) => Number.isFinite(p.v));
      const vals = validPairs.map((p) => p.v);
      const lbls = validPairs.map((p) => p.l);
      let stats1 = calcMeanStd(vals);
      if (!stats1) return emptyChart(`无${label}数据`);
      const cap = stats1.mean + 3 * stats1.std;
      const floor = stats1.mean - 3 * stats1.std;
      const cappedVals = vals.map((v) => Math.max(floor, Math.min(cap, v)));
      const stats2 = calcMeanStd(cappedVals);
      if (!stats2) return emptyChart(`无${label}数据`);
      const mean = stats2.mean;
      const high = mean + stats2.std;
      const low = mean - stats2.std;
      return {
        x: lbls, series: [cappedVals], labels: [label], latest: [fmt(cappedVals.at(-1) ?? null)],
        _stats: { mean, high, low },
      };
    };

    charts.ps_valuation = buildValuationChart(dailyRows.map((r: any) => parseNum(r?.ps_ttm) ?? parseNum(r?.ps)), 'PS/PS_TTM');
    charts.pe_valuation = buildValuationChart(dailyRows.map((r: any) => parseNum(r?.pe_ttm) ?? parseNum(r?.pe)), 'PE/PE_TTM');
    charts.pb_valuation = buildValuationChart(dailyRows.map((r: any) => parseNum(r?.pb)), 'PB');

    // dupont
    {
      const dpRows = (Array.isArray(dupontJson?.points) ? dupontJson.points : [])
        .slice().sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
      const toPct = (r: any, k: string) => { const n = parseNum(r?.[k]); return n == null ? NaN : n * 100; };
      const toVal = (r: any, k: string) => { const n = parseNum(r?.[k]); return n == null ? NaN : n; };
      const pts = dpRows.map((r: any) => ({
        x: formatDateYYMM(r?.period), turnover: toVal(r, 'totalAsset_turnover_ttm'),
        multiplier: toVal(r, 'equity_multiplier_ttm'), netMargin: toPct(r, 'netMargin_ttm'), roe: toPct(r, 'roe_dupont'),
      })).filter((p: any) => !!p.x);
      const sampled = sampleWithLabels(pts.map(() => 1), pts.map((p: any) => p.x));
      const idx = sampled.labels.map((lbl: string) => pts.findIndex((p: any) => p.x === lbl)).filter((i: number) => i >= 0);
      const sp = idx.map((i: number) => pts[i]);
      charts.dupont = {
        x: sp.map((p: any) => p.x),
        series: [sp.map((p: any) => p.turnover), sp.map((p: any) => p.multiplier), sp.map((p: any) => p.netMargin), sp.map((p: any) => p.roe)],
        labels: ['总资产周转率(TTM)', '权益乘数(TTM)', '销售净利率(TTM)%', '杜邦ROE%'],
        latest: [],
      };
    }
  } catch { /* charts stay empty */ }
  return charts;
}

/* ─── IncomeChartCell (same as incomeContrast) ─── */

const IncomeChartCell = memo(function IncomeChartCell({ metricKey, chart }: { metricKey: MetricKey; chart: MetricChart }) {
  if (!chart.x.length && chart.note) {
    return <div className="h-[190px] flex items-center justify-center text-xs text-gray-400">{chart.note}</div>;
  }
  if (!chart.x.length) return <div className="h-[190px] flex items-center justify-center text-xs text-gray-400">暂无数据</div>;

  const chartData = chart.x.map((label, i) => {
    const row: Record<string, any> = { xLabel: label };
    chart.series.forEach((s, si) => { row[`s${si}`] = s[i] ?? null; });
    return row;
  });

  const darkTooltip = metricKey === 'rev_cashflow' || metricKey === 'cost_margin' || metricKey === 'fee_revenue' || metricKey === 'growth_summary' || metricKey === 'growth_trend' || metricKey === 'dupont';

  const compactTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: darkTooltip ? '#1e293b' : '#fff', border: darkTooltip ? '1px solid #475569' : '1px solid #ddd', borderRadius: 3, padding: '3px 6px', fontSize: 10, lineHeight: '14px' }}>
        <div style={{ fontWeight: 600, marginBottom: 1, color: darkTooltip ? '#e2e8f0' : '#334155', WebkitTextStroke: '0.35px rgba(255,255,255,0.95)', textShadow: '0 1px 0 rgba(255,255,255,0.3)' }}>{label}</div>
        {payload.map((p: any, i: number) => {
          const n = Number(p.value);
          const suffix = /CAGR|毛利率|%/.test(p.name) ? '%' : /周转率|权益乘数/.test(p.name) ? '' : '亿';
          return (
            <div key={i} style={{ color: p.color, whiteSpace: 'nowrap', WebkitTextStroke: '0.35px rgba(255,255,255,0.95)', textShadow: '0 1px 0 rgba(255,255,255,0.3)' }}>
              {p.name}: {Number.isFinite(n) ? `${n.toFixed(2)}${suffix}` : '—'}
            </div>
          );
        })}
      </div>
    );
  };

  const formatYi = (v: any) => `${Number(v).toFixed(0)}亿`;
  const formatPct = (v: any) => `${Number(v).toFixed(0)}%`;

  // rev_mv
  if (metricKey === 'rev_mv') {
    const data = chartData.map((d) => ({ ...d, rev: d.s0, profit: d.s1, mv: d.s2 }));
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="right" dataKey="rev" barSize={3} fill="#1e40af" name={chart.labels[0]} />
            <Bar yAxisId="right" dataKey="profit" barSize={3} fill="#60a5fa" name={chart.labels[1]} />
            <Line yAxisId="left" type="monotone" dataKey="mv" stroke="#f97316" strokeWidth={2} dot={false} name={chart.labels[2]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // cost_margin
  if (metricKey === 'cost_margin') {
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} domain={['dataMin', 100]} tickFormatter={formatPct} />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="s0" barSize={3} fill="#1e40af" name={chart.labels[0]} />
            <Bar yAxisId="left" dataKey="s1" barSize={3} fill="#60a5fa" name={chart.labels[1]} />
            <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#f8fafc" strokeWidth={2} dot={false} name={chart.labels[2]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // fee_revenue
  if (metricKey === 'fee_revenue') {
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="s0" barSize={3} fill="#1e40af" name={chart.labels[0]} />
            <Line yAxisId="right" type="monotone" dataKey="s1" stroke="#f97316" strokeWidth={2} dot={false} name={chart.labels[1]} />
            <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#94a3b8" strokeWidth={1.5} dot={false} name={chart.labels[2]} />
            <Line yAxisId="right" type="monotone" dataKey="s3" stroke="#22d3ee" strokeWidth={2} dot={false} name={chart.labels[3]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // growth_summary
  if (metricKey === 'growth_summary') {
    const GROWTH_BAR_COLORS = ['#94a3b8', '#3b82f6', '#ef4444', '#22c55e'];
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatPct} />
            <Tooltip content={compactTooltip} />
            <Bar dataKey="s0" name="5年CAGR%">
              <LabelList dataKey="s0" position="top" fontSize={9} fill="#e2e8f0" formatter={(v: number) => Number.isFinite(v) ? `${v.toFixed(1)}%` : ''} />
              {chartData.map((_: any, i: number) => <Cell key={i} fill={GROWTH_BAR_COLORS[i % GROWTH_BAR_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // growth_trend
  if (metricKey === 'growth_trend') {
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <YAxis yAxisId="right" tick={{ fill: '#cbd5e1', fontSize: 10 }} width={44} orientation="right" tickFormatter={formatPct} />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="s0" barSize={2} fill="#ef4444" name={chart.labels[0] ?? '归母净利润TTM(亿)'} />
            <Bar yAxisId="left" dataKey="s1" barSize={2} fill="#3b82f6" name={chart.labels[1] ?? '营收TTM(亿)'} />
            <Bar yAxisId="left" dataKey="s2" barSize={2} fill="#22c55e" name={chart.labels[2] ?? '归母所有者权益(亿)'} />
            <Bar yAxisId="left" dataKey="s3" barSize={2} fill="#94a3b8" name={chart.labels[3] ?? '总市值(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s4" stroke="#fb7185" strokeWidth={2.5} dot={false} name={chart.labels[4] ?? '利润5年CAGR'} />
            <Line yAxisId="right" type="monotone" dataKey="s5" stroke="#60a5fa" strokeWidth={2} dot={false} name={chart.labels[5] ?? '营收5年CAGR'} />
            <Line yAxisId="right" type="monotone" dataKey="s6" stroke="#34d399" strokeWidth={2} dot={false} name={chart.labels[6] ?? '净资产5年CAGR'} />
            <Line yAxisId="right" type="monotone" dataKey="s7" stroke="#cbd5e1" strokeWidth={1.5} dot={false} name={chart.labels[7] ?? '市值5年CAGR'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // dupont
  if (metricKey === 'dupont') {
    const dupontData = chartData.map((d: any) => ({ ...d, turnover: d.s0, multiplier: d.s1, netMargin: d.s2, roe: d.s3 }));
    const fmtTimes = (v: any) => Number(v).toFixed(2);
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dupontData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={fmtTimes} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatPct} />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="turnover" barSize={3} fill="#3b82f6" opacity={0.85} name={chart.labels[0] ?? '总资产周转率(TTM)'} />
            <Bar yAxisId="left" dataKey="multiplier" barSize={3} fill="#22c55e" opacity={0.85} name={chart.labels[1] ?? '权益乘数(TTM)'} />
            <Line yAxisId="right" type="monotone" dataKey="netMargin" stroke="#f97316" strokeWidth={2} dot={false} name={chart.labels[2] ?? '销售净利率(TTM)%'} />
            <Line yAxisId="right" type="monotone" dataKey="roe" stroke="#ef4444" strokeWidth={2.5} dot={false} name={chart.labels[3] ?? '杜邦ROE%'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // valuation charts (ps/pe/pb)
  if (metricKey === 'ps_valuation' || metricKey === 'pe_valuation' || metricKey === 'pb_valuation') {
    const stats = chart._stats;
    const valuationData = chartData.map((d) => ({
      ...d, val: d.s0,
      ...(stats ? { _mean: stats.mean, _high: stats.high, _low: stats.low } : {}),
    }));
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={valuationData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} width={44} domain={['auto', 'auto']} />
            <Tooltip content={compactTooltip} />
            <Line type="monotone" dataKey="val" stroke="#2563eb" strokeWidth={1.5} dot={false} name={chart.labels[0] ?? 'Value'} />
            {stats && <Line type="monotone" dataKey="_mean" stroke="#facc15" strokeWidth={1.5} dot={false} name="均值" />}
            {stats && <Line type="monotone" dataKey="_high" stroke="#ef4444" strokeWidth={1.5} dot={false} name="高估线(+1σ)" />}
            {stats && <Line type="monotone" dataKey="_low" stroke="#111827" strokeWidth={1.5} dot={false} name="低估线(-1σ)" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // default fallback
  return (
    <div className="h-[190px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={44} tickFormatter={formatYi} />
          <YAxis yAxisId="right" tick={{ fontSize: 10 }} width={44} orientation="right" tickFormatter={formatPct} />
          <Tooltip content={compactTooltip} />
          <Bar yAxisId="left" dataKey="s0" barSize={3} fill="#38bdf8" name={chart.labels[0] ?? 'S1'} />
          {chart.series[1] && <Line yAxisId="left" type="monotone" dataKey="s1" stroke="#f97316" strokeWidth={2} dot={false} name={chart.labels[1] ?? 'S2'} />}
          {chart.series[2] && <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#f8fafc" strokeWidth={2} dot={false} name={chart.labels[2] ?? 'S3'} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}, (prev, next) => prev.metricKey === next.metricKey && prev.chart === next.chart);

/* ─── Main page ─── */

export default function HoldingsDashboard() {
  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cash, setCash] = useState(0);
  const [targetGrowth, setTargetGrowth] = useState(50);
  const [targetCashflow, setTargetCashflow] = useState(50);
  const [doneCount, setDoneCount] = useState(0);

  const rowsRef = useRef<HoldingRow[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushRows = useCallback(() => { setRows([...rowsRef.current]); }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/portfolio');
        const json = await res.json();
        const portfolio = json?.data;
        if (!portfolio || cancelled) return;

        setCash(portfolio.meta?.cash ?? 0);
        setTargetGrowth(portfolio.meta?.target_growth_pct ?? 50);
        setTargetCashflow(portfolio.meta?.target_cashflow_pct ?? 50);

        const holdings = portfolio.holdings ?? [];
        const tsCodes = holdings.map((h: any) => h.ts_code);

        // fetch latest close prices
        const priceMap: Record<string, number> = {};
        await Promise.all(
          tsCodes.map(async (code: string) => {
            try {
              const r = await fetch(`/api/parq/daily_basic?ts_code=${encodeURIComponent(code)}&page=1&size=1&sortField=trade_date&sortDir=desc`);
              const j = await r.json();
              const row = Array.isArray(j?.data) ? j.data[0] : null;
              const close = Number(row?.close);
              if (Number.isFinite(close)) priceMap[code] = close;
            } catch { /* skip */ }
          })
        );

        const totalMV = holdings.reduce((sum: number, h: any) => {
          const price = priceMap[h.ts_code] ?? h.cost_price;
          return sum + h.quantity * price;
        }, 0) + (portfolio.meta?.cash ?? 0);

        const initialRows: HoldingRow[] = holdings.map((h: any) => {
          const price = priceMap[h.ts_code] ?? h.cost_price;
          const mv = h.quantity * price;
          const cost = h.quantity * h.cost_price;
          return {
            ts_code: h.ts_code,
            name: h.name,
            pool: h.pool,
            quantity: h.quantity,
            cost_price: h.cost_price,
            latest_close: price,
            market_value: mv,
            weight_pct: totalMV > 0 ? (mv / totalMV) * 100 : 0,
            pnl: mv - cost,
            pnl_pct: cost > 0 ? ((mv - cost) / cost) * 100 : 0,
            factor_score: null,
            loading: true,
            charts: emptyCharts(),
          };
        });

        rowsRef.current = initialRows;
        if (!cancelled) setRows(initialRows);

        // load charts concurrently
        const CONCURRENCY = 5;
        const idx = { next: 0, done: 0 };
        const scheduleFlush = () => {
          if (flushTimerRef.current) return;
          flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            if (!cancelled) flushRows();
          }, 600);
        };
        const worker = async () => {
          while (idx.next < tsCodes.length && !cancelled) {
            const i = idx.next++;
            const code = tsCodes[i];
            const charts = await buildHoldingCharts(code);
            if (cancelled) break;
            rowsRef.current = rowsRef.current.map((r) =>
              r.ts_code === code ? { ...r, loading: false, charts } : r
            );
            idx.done++;
            if (!cancelled) setDoneCount(idx.done);
            scheduleFlush();
          }
        };
        const workers = Array.from({ length: Math.min(CONCURRENCY, tsCodes.length) }, () => worker());
        await Promise.all(workers);

        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
        if (!cancelled) { flushRows(); setLoading(false); }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    };
  }, [flushRows]);

  /* ─── derived data ─── */

  const totalMV = useMemo(() => rows.reduce((s, r) => s + r.market_value, 0), [rows]);
  const totalAssets = totalMV + cash;
  const growthMV = useMemo(() => rows.filter((r) => r.pool === 'growth').reduce((s, r) => s + r.market_value, 0), [rows]);
  const cashflowMV = useMemo(() => rows.filter((r) => r.pool === 'cashflow').reduce((s, r) => s + r.market_value, 0), [rows]);
  const growthPct = totalAssets > 0 ? (growthMV / totalAssets) * 100 : 0;
  const cashflowPct = totalAssets > 0 ? (cashflowMV / totalAssets) * 100 : 0;
  const cashPct = totalAssets > 0 ? (cash / totalAssets) * 100 : 0;

  const pieData = useMemo(() => [
    { name: '成长池', value: growthPct, target: targetGrowth },
    { name: '现金流池', value: cashflowPct, target: targetCashflow },
    { name: '现金', value: cashPct, target: 0 },
  ], [growthPct, cashflowPct, cashPct, targetGrowth, targetCashflow]);

  /* ─── grid data ─── */

  const HOLDING_COLS = [
    { key: 'pool', label: '资产池' },
    { key: 'weight_pct', label: '当前权重' },
    { key: 'pnl_info', label: '持仓盈亏' },
  ];
  const allColumns = ['stock_basic', ...HOLDING_COLS.map((c) => c.key), ...METRIC_COLUMNS.map((c) => c.key)];
  const fieldLabelMap = Object.fromEntries([
    ['stock_basic', '股票信息'],
    ...HOLDING_COLS.map((c) => [c.key, c.label]),
    ...METRIC_COLUMNS.map((c) => [c.key, c.label]),
  ]);

  const gridData = useMemo<CSVData>(() => {
    const headers = Object.values(fieldLabelMap);
    const data = rows.map((row) => {
      const metricData = Object.fromEntries(METRIC_COLUMNS.map((c) => [c.key, row.charts[c.key]]));
      return { stock_basic: row, pool: row, weight_pct: row, pnl_info: row, ...metricData };
    });
    return { category: 'holdings', filename: 'holdings', headers, originalHeaders: allColumns, data, totalRows: data.length };
  }, [rows, allColumns, fieldLabelMap]);

  const cellRenderers = useMemo(() => {
    const renderers: Record<string, (params: any) => any> = {};

    renderers.stock_basic = (params: any) => {
      const row = params?.value as HoldingRow | undefined;
      if (!row) return <div className="text-xs text-gray-400">—</div>;
      return (
        <div className="space-y-1 py-1">
          <div className="font-semibold text-gray-900">{row.ts_code}</div>
          <div className="text-sm text-gray-700">{row.name}</div>
          <div className="text-xs text-gray-500">数量: {row.quantity} 股</div>
          <div className="text-xs text-gray-500">成本: ¥{row.cost_price.toFixed(2)}</div>
          <div className="text-xs text-gray-500">现价: ¥{row.latest_close.toFixed(2)}</div>
          {row.loading && <div className="text-xs text-blue-500">图表加载中...</div>}
        </div>
      );
    };

    renderers.pool = (params: any) => {
      const row = params?.value as HoldingRow | undefined;
      if (!row) return null;
      const isGrowth = row.pool === 'growth';
      return (
        <div className="flex items-center justify-center h-full">
          <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${isGrowth ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
            {isGrowth ? '成长' : '现金流'}
          </span>
        </div>
      );
    };

    renderers.weight_pct = (params: any) => {
      const row = params?.value as HoldingRow | undefined;
      if (!row) return null;
      return (
        <div className="flex flex-col items-center justify-center h-full gap-1">
          <div className="text-lg font-bold text-gray-900">{row.weight_pct.toFixed(2)}%</div>
          <div className="text-xs text-gray-500">市值 ¥{(row.market_value / 1e4).toFixed(2)}万</div>
          <div className="w-full bg-gray-200 rounded-full h-2 max-w-[100px]">
            <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min(row.weight_pct * 2, 100)}%` }} />
          </div>
        </div>
      );
    };

    renderers.pnl_info = (params: any) => {
      const row = params?.value as HoldingRow | undefined;
      if (!row) return null;
      const positive = row.pnl >= 0;
      return (
        <div className="flex flex-col items-center justify-center h-full gap-0.5">
          <div className={`text-lg font-bold ${positive ? 'text-red-600' : 'text-green-600'}`}>
            {positive ? '+' : ''}{(row.pnl / 1e4).toFixed(2)}万
          </div>
          <div className={`text-sm font-medium ${positive ? 'text-red-500' : 'text-green-500'}`}>
            {positive ? '+' : ''}{row.pnl_pct.toFixed(2)}%
          </div>
          <div className="text-xs text-gray-400">总成本 ¥{((row.quantity * row.cost_price) / 1e4).toFixed(2)}万</div>
        </div>
      );
    };

    for (const c of METRIC_COLUMNS) {
      renderers[c.key] = (params: any) => {
        const chart = params?.value as MetricChart | undefined;
        return <IncomeChartCell metricKey={c.key} chart={chart ?? emptyChart()} />;
      };
    }

    return renderers;
  }, []);

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden space-y-4 p-4">
      {/* metrics cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500 mb-1">总资产净值</div>
          <div className="text-2xl font-bold text-gray-900">¥{(totalAssets / 1e4).toFixed(2)}<span className="text-sm font-normal text-gray-500"> 万</span></div>
          <div className="text-xs text-gray-400 mt-1">持仓市值 ¥{(totalMV / 1e4).toFixed(2)}万 + 现金 ¥{(cash / 1e4).toFixed(2)}万</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <div className="text-xs text-blue-600 mb-1">成长池占比</div>
          <div className="text-2xl font-bold text-blue-700">{growthPct.toFixed(1)}%</div>
          <div className="text-xs text-blue-400 mt-1">目标 {targetGrowth}%，偏离 {(growthPct - targetGrowth).toFixed(1)}%</div>
        </div>
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 shadow-sm">
          <div className="text-xs text-orange-600 mb-1">现金流池占比</div>
          <div className="text-2xl font-bold text-orange-700">{cashflowPct.toFixed(1)}%</div>
          <div className="text-xs text-orange-400 mt-1">目标 {targetCashflow}%，偏离 {(cashflowPct - targetCashflow).toFixed(1)}%</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 shadow-sm">
          <div className="text-xs text-gray-500 mb-1">持仓数量</div>
          <div className="text-2xl font-bold text-gray-900">{rows.length}<span className="text-sm font-normal text-gray-500"> 只</span></div>
          <div className="text-xs text-gray-400 mt-1">成长 {rows.filter((r) => r.pool === 'growth').length} / 现金流 {rows.filter((r) => r.pool === 'cashflow').length}</div>
        </div>
      </div>

      {/* pie charts: current vs target */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">大类资产配置 — 当前 vs 目标</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-500 text-center mb-1">当前配置</div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, value }: any) => `${name} ${value.toFixed(1)}%`}
                  labelLine
                  fontSize={11}
                >
                  {pieData.map((_, i) => <RCell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="text-xs text-gray-500 text-center mb-1">目标配置 ({targetGrowth}:{targetCashflow})</div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={[{ name: '成长池', value: targetGrowth }, { name: '现金流池', value: targetCashflow }]}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, value }: any) => `${name} ${value.toFixed(0)}%`}
                  labelLine
                  fontSize={11}
                >
                  <RCell fill={PIE_COLORS[0]} />
                  <RCell fill={PIE_COLORS[1]} />
                </Pie>
                <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* navigation to approval page */}
      <div className="flex items-center gap-3">
        <Link href="/approval">
          <Button variant="outline">查看调仓审批 →</Button>
        </Link>
        {loading && <span className="text-sm text-gray-500">图表加载中 {doneCount}/{rows.length}...</span>}
      </div>

      {/* holdings table with charts */}
      <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <DataGrid
          category="holdings"
          tabId="holdings_grid"
          title="持仓列表"
          localData={gridData}
          useServerPagination={false}
          columnOrder={allColumns}
          fieldLabelMap={fieldLabelMap}
          customCellRenderers={cellRenderers}
          rowHeight={240}
          gridHeight="72vh"
          uniformColumnWidth={360}
          pinnedLeftFields={['stock_basic']}
          getRowId={(params: any) => params.data?.stock_basic?.ts_code ?? String(params.rowIndex)}
        />
      </div>
    </div>
  );
}
