'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DataGrid, { type CSVData } from '../components/DataGrid';
import { CninfoStockRecentInfoModal } from '../components/CninfoStockRecentInfoModal';
import { formatDateYYMM } from '@/lib/dateFormat';
import { ChevronDown, X } from 'lucide-react';
import {
  ResponsiveContainer,
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
  ReferenceLine,
} from 'recharts';

type StockInfo = {
  name: string;
  area: string;
  industry: string;
};

type MetricChart = {
  x: string[];
  series: number[][];
  labels: string[];
  latest: string[];
  note?: string;
  _stats?: { mean: number; high: number; low: number };
  history?: Array<{ period: string; values: number[] }>;
};

type MetricKey =
  | 'rev_mv'
  | 'rev_cashflow'
  | 'cost_margin'
  | 'fee_revenue'
  | 'dividend_yield'
  | 'growth_summary'
  | 'growth_trend'
  | 'balance_structure'
  | 'biz_comp'
  | 'ps_valuation'
  | 'pe_valuation'
  | 'pb_valuation'
  | 'dupont'
  | 'forecast_signal';

type ContrastRow = {
  tsCode: string;
  loading: boolean;
  error?: string;
  stockInfo: StockInfo | null;
  charts: Record<MetricKey, MetricChart>;
};

/** 固定列「热点概念」单元格状态（定期报告标题 + LLM 归纳） */
type HotConceptsCellState = { state: 'loading' } | { state: 'ready'; summary: string } | { state: 'error'; err: string };

/** 附带热点：更新走 displayGridData，避免 customCellRenderers 随热点变化触发整表 columnDefs 重建（闪动） */
type StockBasicGridValue = ContrastRow & { __hotConcepts?: HotConceptsCellState };

type ContrastGridRow = {
  pin_top: string;
  stock_basic: StockBasicGridValue;
} & Record<MetricKey, MetricChart>;

const COLORS = ['#2563eb', '#ef4444', '#16a34a', '#f59e0b', '#7c3aed', '#0ea5e9'];
const BALANCE_FULL_LABELS: Record<string, string> = {
  '现': '现金', '预': '预付款', '应': '应收账款', '存': '存货',
  '他流': '其他流动资产', '长投': '长期股权投资', '固资': '固定资产',
  '无形': '无形资产', '非流': '其他非流动资产', '短借': '短期借款',
  '应付': '应付账款', '合同': '合同负债', '薪税': '薪酬及税费',
  '他流负': '其他流动负债', '长借': '长期借款', '长负': '其他非流动负债',
};

const METRIC_COLUMNS: Array<{ key: MetricKey; label: string }> = [
  { key: 'rev_mv', label: '营收和市值' },
  { key: 'rev_cashflow', label: '营收和现金流' },
  { key: 'cost_margin', label: '成本与毛利率' },
  { key: 'fee_revenue', label: '三费与营收' },
  { key: 'dividend_yield', label: '股息率' },
  { key: 'growth_summary', label: '综合增长率' },
  { key: 'growth_trend', label: '综合增长率趋势' },
  { key: 'balance_structure', label: '资产负债结构' },
  { key: 'biz_comp', label: '业务构成' },
  { key: 'ps_valuation', label: '市销率估值' },
  { key: 'pe_valuation', label: '滚动市盈率估值' },
  { key: 'pb_valuation', label: '市净率估值' },
  { key: 'dupont', label: '杜邦分析' },
  { key: 'forecast_signal', label: '预测列(三表信号)' },
];

const PINNED_CODES_STORAGE_KEY = 'incomeContrast:pinnedCodes';

function readPinnedCodesFromStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const raw = window.localStorage.getItem(PINNED_CODES_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as unknown;
    const source: unknown[] = [];
    if (Array.isArray(parsed)) {
      source.push(...parsed);
    } else if (parsed && typeof parsed === 'object') {
      // Backward-compatible: flatten old format { industryKey: string[] }.
      for (const value of Object.values(parsed as Record<string, unknown>)) {
        if (Array.isArray(value)) source.push(...value);
      }
    } else {
      return new Set<string>();
    }
    const next = new Set<string>();
    for (const code of source) {
      const s = String(code ?? '').trim().toUpperCase();
      if (/^\d{6}\.(SZ|SH|BJ)$/.test(s)) next.add(s);
    }
    return next;
  } catch {
    return new Set<string>();
  }
}

function writePinnedCodesToStorage(pinnedCodes: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const values = [...pinnedCodes].map((code) => String(code ?? '').trim().toUpperCase()).filter((code) => /^\d{6}\.(SZ|SH|BJ)$/.test(code));
    window.localStorage.setItem(PINNED_CODES_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Ignore storage errors to avoid blocking interaction.
  }
}

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function parseDateNum(v: unknown): number {
  const raw = String(v ?? '').trim();
  if (!raw) return NaN;
  if (/^\d{8}$/.test(raw)) return Number(raw);
  const m1 = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return Number(`${m1[1]}${String(m1[2]).padStart(2, '0')}${String(m1[3]).padStart(2, '0')}`);
  const m2 = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m2) return Number(`${m2[1]}${String(m2[2]).padStart(2, '0')}${String(m2[3]).padStart(2, '0')}`);
  const dt = new Date(raw.replace(/-/g, '/'));
  if (Number.isNaN(dt.getTime())) return NaN;
  const y = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return Number(`${y}${mm}${dd}`);
}

function parseQuarterPeriod(v: unknown): { year: number; quarter: number } | null {
  const raw = String(v ?? '').trim().toUpperCase();
  const m = raw.match(/^(\d{4})Q([1-4])$/);
  if (!m) return null;
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

function shiftQuarterPeriod(period: string, yearsBack: number): string | null {
  const p = parseQuarterPeriod(period);
  if (!p) return null;
  return `${p.year - yearsBack}Q${p.quarter}`;
}

function buildCodesKey(list: string[]): string {
  return list.map((code) => String(code ?? '').trim().toUpperCase()).join('|');
}

function pickSeries(values: Array<number | null | undefined>, maxPoints = 52): number[] {
  const filtered = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (filtered.length <= maxPoints) return filtered;
  const picked: number[] = [];
  const step = (filtered.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    picked.push(filtered[Math.round(i * step)]);
  }
  return picked;
}

function sampleWithLabels(values: number[], labels: string[], maxPoints = 52): { values: number[]; labels: string[] } {
  if (values.length <= maxPoints) return { values, labels };
  const sampledValues: number[] = [];
  const sampledLabels: string[] = [];
  const step = (values.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round(i * step);
    sampledValues.push(values[idx]);
    sampledLabels.push(labels[idx] ?? String(i + 1));
  }
  return { values: sampledValues, labels: sampledLabels };
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
    rev_mv: emptyChart(),
    rev_cashflow: emptyChart(),
    cost_margin: emptyChart(),
    fee_revenue: emptyChart(),
    dividend_yield: emptyChart(),
    growth_summary: emptyChart(),
    growth_trend: emptyChart(),
    balance_structure: emptyChart(),
    biz_comp: emptyChart(),
    ps_valuation: emptyChart(),
    pe_valuation: emptyChart(),
    pb_valuation: emptyChart(),
    dupont: emptyChart(),
    forecast_signal: emptyChart(),
  };
}

function calcMeanStd(values: number[]): { mean: number; std: number } | null {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const IncomeChartCell = memo(function IncomeChartCell({
  chart,
  metricKey,
  onOpenBalanceHistory,
  balanceHistoryTitle,
}: {
  chart: MetricChart;
  metricKey: MetricKey;
  onOpenBalanceHistory?: (chart: MetricChart, title: string) => void;
  balanceHistoryTitle?: string;
}) {
  const all = chart.series.flat().filter((v) => Number.isFinite(v));
  if (!all.length) return <div className="text-xs text-gray-400">{chart.note ?? '暂无数据'}</div>;
  const len = Math.max(...chart.series.map((s) => s.length), chart.x.length);
  const chartData = Array.from({ length: len }, (_, i) => {
    const row: Record<string, any> = { idx: i + 1 };
    row.xLabel = chart.x[i] ?? String(i + 1);
    chart.series.forEach((s, si) => {
      row[`s${si}`] = s[i] ?? null;
    });
    return row;
  });
  // console.log('chartData',metricKey,chartData);
  const darkTooltip =
    metricKey === 'rev_cashflow' ||
    metricKey === 'cost_margin' ||
    metricKey === 'fee_revenue' ||
    metricKey === 'growth_summary' ||
    metricKey === 'growth_trend' ||
    metricKey === 'dupont' ||
    metricKey === 'forecast_signal';
  const valuationTooltip =
    metricKey === 'ps_valuation' ||
    metricKey === 'pe_valuation' ||
    metricKey === 'pb_valuation';
  const compactTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div
        style={{
          background: darkTooltip ? '#1e293b' : '#fff',
          border: darkTooltip ? '1px solid #475569' : '1px solid #ddd',
          borderRadius: 3,
          padding: '3px 6px',
          fontSize: 10,
          lineHeight: '14px',
        }}
      >
        <div
          style={{
            fontWeight: 600,
            marginBottom: 1,
            color: darkTooltip ? '#e2e8f0' : '#334155',
            WebkitTextStroke: '0.35px rgba(255,255,255,0.95)',
            textShadow: '0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          {label}
        </div>
        {payload.map((p: any, i: number) => {
          const n = Number(p.value);
          const suffix = valuationTooltip
            ? '倍'
            : /CAGR|毛利率|%|得分|增速/.test(p.name)
              ? '%'
              : /周转率|权益乘数/.test(p.name)
                ? ''
                : '亿';
          return (
            <div
              key={i}
              style={{
                color: p.color,
                whiteSpace: 'nowrap',
                WebkitTextStroke: '0.35px rgba(255,255,255,0.95)',
                textShadow: '0 1px 0 rgba(255,255,255,0.3)',
              }}
            >
              {p.name}:{' '}
              {Number.isFinite(n) ? (
                <>
                  {n.toFixed(2)}
                  {suffix ? <span style={{ color: suffix === '倍' ? '#111827' : undefined }}>{suffix}</span> : null}
                </>
              ) : '—'}
            </div>
          );
        })}
      </div>
    );
  };
  const formatYi = (v: any) => `${Number(v).toFixed(0)}亿`;
  const formatPct = (v: any) => `${Number(v).toFixed(1)}%`;

  if (metricKey === 'rev_mv') {
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10, fill: '#82ca9d' }}
              width={52}
              tickFormatter={formatYi}
              label={{ value: '市值(亿)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#82ca9d' } }}
            />
            <YAxis
              yAxisId="right"
              tick={{ fontSize: 10, fill: '#3b82f6' }}
              width={52}
              orientation="right"
              tickFormatter={formatYi}
              label={{ value: '营收(蓝)/利润(红)(亿)', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#3b82f6' } }}
            />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="right" dataKey="s0" barSize={3} fill="#3b82f6" name={chart.labels[0] ?? 'TTM营收(亿)'} />
            <Bar yAxisId="right" dataKey="s1" barSize={3} fill="#ef4444" name={chart.labels[1] ?? 'TTM归母净利润(亿)'} />
            <Line yAxisId="left" type="monotone" dataKey="s2" stroke="#82ca9d" strokeWidth={2} dot={false} name={chart.labels[2] ?? '总市值(亿)'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'rev_cashflow') {
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              yAxisId="left"
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              width={52}
              tickFormatter={formatYi}
              label={{ value: '营收/现金流入(亿)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8', fontSize: 10 } }}
            />
            <YAxis
              yAxisId="right"
              tick={{ fill: '#cbd5e1', fontSize: 10 }}
              width={52}
              orientation="right"
              tickFormatter={formatYi}
              label={{ value: '利润/现金流净额(亿)', angle: 90, position: 'insideRight', style: { fill: '#cbd5e1', fontSize: 10 } }}
            />
            <Tooltip content={compactTooltip} />
            <Line yAxisId="left" type="monotone" dataKey="s0" stroke="#1e40af" strokeWidth={2} dot={false} name={chart.labels[0] ?? '滚动总营收 TTM'} />
            <Line yAxisId="left" type="monotone" dataKey="s1" stroke="#60a5fa" strokeWidth={2} dot={false} name={chart.labels[1] ?? '经营现金流入 TTM'} />
            <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#9a3412" strokeWidth={2} dot={false} name={chart.labels[2] ?? '归母净利润 TTM'} />
            <Line yAxisId="right" type="monotone" dataKey="s3" stroke="#fb923c" strokeWidth={2} dot={false} name={chart.labels[3] ?? '经营现金流净额 TTM'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'biz_comp') {
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <Tooltip content={compactTooltip} />
            {chart.series.map((_, idx) => (
              <Line key={idx} type="monotone" dataKey={`s${idx}`} stroke={COLORS[idx % COLORS.length]} strokeWidth={2} dot={false} name={chart.labels[idx] ?? `S${idx + 1}`} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'dividend_yield') {
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={formatPct} />
            <Tooltip content={compactTooltip} />
            <Line type="monotone" dataKey="s0" stroke="#22c55e" strokeWidth={2.5} dot={false} name={chart.labels[0] ?? '股息率TTM(%)'} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'ps_valuation' || metricKey === 'pe_valuation' || metricKey === 'pb_valuation') {
    const vStats = chart._stats;
    const valuationData = chartData.map((d: Record<string, any>) => ({
      ...d,
      ...(vStats ? { _mean: vStats.mean, _high: vStats.high, _low: vStats.low } : {}),
    }));
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={valuationData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={(v: any) => Number(v).toFixed(1)} />
            <Tooltip content={compactTooltip} />
            <Line type="monotone" dataKey="s0" stroke={COLORS[0]} strokeWidth={2} dot={false} name={chart.labels[0] ?? 'S1'} />
            {vStats && (
              <>
                <Line type="monotone" dataKey="_mean" stroke="#facc15" strokeWidth={1.5} dot={false} name="均值" />
                <Line type="monotone" dataKey="_high" stroke="#ef4444" strokeWidth={1.5} dot={false} name="高估线(均值+1σ)" />
                <Line type="monotone" dataKey="_low" stroke="#111827" strokeWidth={1.5} dot={false} name="低估线(均值-1σ)" />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'cost_margin') {
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <YAxis
              yAxisId="right"
              tick={{ fill: '#cbd5e1', fontSize: 10 }}
              width={44}
              orientation="right"
              domain={['dataMin', 100]}
              tickFormatter={formatPct}
            />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="s0" barSize={3} fill="#38bdf8" name={chart.labels[0] ?? '营收TTM(亿)'} />
            <Bar yAxisId="left" dataKey="s1" barSize={3} fill="#f97316" name={chart.labels[1] ?? '成本TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#f8fafc" strokeWidth={2} dot={false} name={chart.labels[2] ?? '毛利率TTM(%)'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'fee_revenue') {
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatYi} />
            <YAxis yAxisId="right" tick={{ fill: '#cbd5e1', fontSize: 10 }} width={44} orientation="right" tickFormatter={formatYi} />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="s0" barSize={3} fill="#38bdf8" name={chart.labels[0] ?? '营收TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s1" stroke="#fb923c" strokeWidth={2} dot={false} name={chart.labels[1] ?? '销售费TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#94a3b8" strokeWidth={2} dot={false} name={chart.labels[2] ?? '管理费TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s3" stroke="#f43f5e" strokeWidth={2.5} dot={false} name={chart.labels[3] ?? '研发费TTM(亿)'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'growth_summary') {
    const GROWTH_BAR_COLORS = ['#94a3b8', '#3b82f6', '#ef4444', '#22c55e'];
    const bars = (chart.series[0] ?? []).map((v, idx) => ({ idx: chart.x[idx] ?? String(idx + 1), value: v }));
    const periodText = chart.note?.trim();
    const growthXAxisTick = (props: any) => {
      const { x, y, payload } = props;
      const idx = bars.findIndex((b) => String(b.idx) === String(payload?.value));
      const c = GROWTH_BAR_COLORS[idx >= 0 ? idx % GROWTH_BAR_COLORS.length : 0];
      return (
        <text
          x={x}
          y={y}
          dy={16}
          textAnchor="end"
          fill={c}
          fontSize={10}
          transform={`rotate(-90, ${x}, ${y})`}
        >
          {payload?.value}
        </text>
      );
    };
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        {periodText && <div className="px-1 pb-1 text-[10px] text-slate-300">期间: {periodText}</div>}
        <div className={periodText ? 'h-[calc(100%-18px)]' : 'h-full'}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 16, right: 8, left: 0, bottom: 14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="idx" tick={growthXAxisTick} interval={0} height={50} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={formatPct} />
              <Tooltip content={compactTooltip} />
              <Bar dataKey="value" name={chart.labels[0] ?? '数值'}>
                {bars.map((_, idx) => (
                  <Cell key={idx} fill={GROWTH_BAR_COLORS[idx % GROWTH_BAR_COLORS.length]} />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '')}
                  style={{ fill: '#e2e8f0', fontSize: 9, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (metricKey === 'balance_structure') {
    const bars = (chart.series[0] ?? []).map((v, idx) => ({ idx: chart.x[idx] ?? chart.labels[idx] ?? String(idx + 1), value: v }));
    const periodText = chart.note?.trim();
    const historyPeriods = (chart.history ?? []).slice().reverse();
    const balanceTooltip = ({ active, payload, label }: any) => {
      if (!active || !payload?.length) return null;
      const fullLabel = BALANCE_FULL_LABELS[label] ?? label;
      return (
        <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 3, padding: '3px 6px', fontSize: 10, lineHeight: '14px' }}>
          <div style={{ fontWeight: 600, marginBottom: 1, color: '#334155' }}>{fullLabel}</div>
          {payload.map((p: any, i: number) => (
            <div key={i} style={{ color: p.color, whiteSpace: 'nowrap' }}>
              {p.name}: {Number.isFinite(Number(p.value)) ? `${Number(p.value).toFixed(2)}亿` : '—'}
            </div>
          ))}
        </div>
      );
    };
    return (
      <>
      <div className="h-[190px] w-full">
        <div className="relative z-10 flex items-center justify-between px-1 pb-1">
          <div className="text-[10px] text-gray-500">{periodText ? `期间: ${periodText}` : '期间: —'}</div>
          <button
            type="button"
            className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenBalanceHistory?.(chart, balanceHistoryTitle ?? '资产负债结构历史');
            }}
            disabled={historyPeriods.length === 0}
            title={historyPeriods.length === 0 ? '暂无历史数据' : '查看最近3年历史'}
          >
            历史
          </button>
        </div>
        <div className="h-[calc(100%-18px)]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 6, right: 8, left: 0, bottom: 14 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="idx" tick={{ fontSize: 10 }} interval={0} angle={-90} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={formatYi} />
              <Tooltip content={balanceTooltip} />
              <Bar dataKey="value" name={chart.labels[0] ?? '数值'}>
                {bars.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      </>
    );
  }

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

  if (metricKey === 'dupont') {
    const dupontData = chartData.map((d: any) => ({
      ...d,
      turnover: d.s0,
      multiplier: d.s1,
      netMargin: d.s2,
      roe: d.s3,
    }));
    const fmtTimes = (v: any) => Number(v).toFixed(2);
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dupontData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="xLabel" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} tickFormatter={fmtTimes} label={{ value: '次', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 9 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} width={44} domain={[-2, 'auto']} tickFormatter={formatPct} label={{ value: '%', angle: 90, position: 'insideRight', fill: '#94a3b8', fontSize: 9 }} />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="left" dataKey="turnover" barSize={3} fill="#3b82f6" opacity={0.85} name={chart.labels[0] ?? '总资产周转率(TTM)'} />
            <Bar yAxisId="left" dataKey="multiplier" barSize={3} fill="#22c55e" opacity={0.85} name={chart.labels[1] ?? '权益乘数(TTM)'} />
            <Line yAxisId="right" type="monotone" dataKey="netMargin" stroke="#f97316" strokeWidth={2} dot={false} name={chart.labels[2] ?? '销售净利率(TTM)%'} />
            <Line yAxisId="right" type="monotone" dataKey="roe" stroke="#ef4444" strokeWidth={2.5} dot={false} name={chart.labels[3] ?? '杜邦ROE%'} />
            <ReferenceLine yAxisId="right" y={0} stroke="#6b7280" strokeWidth={2} />
            <ReferenceLine yAxisId="right" y={10} stroke="#c0c0c0" strokeWidth={1.5} />
            <ReferenceLine yAxisId="right" y={15} stroke="#facc15" strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'forecast_signal') {
    const scoreLabels = ['利润表', '资产负债', '现金流', '综合'];
    const scoreValues = scoreLabels.map((_, idx) => chart.series[0]?.[idx] ?? NaN);
    const growthPct = chart.series[0]?.[4] ?? NaN;
    const nextProfitYi = chart.series[0]?.[5] ?? NaN;
    const scoreData = scoreLabels.map((name, idx) => ({ name, value: scoreValues[idx] }));
    const scoreColor = (v: number) => (v >= 70 ? '#22c55e' : v >= 50 ? '#f59e0b' : '#ef4444');
    return (
      <div className="h-[190px] w-full rounded-md border border-slate-700 bg-slate-900 p-1 text-slate-100">
        <div className="grid grid-cols-2 gap-1 px-1 pb-1 text-[10px]">
          <div>预测净利增速: <span className="font-semibold">{Number.isFinite(growthPct) ? `${growthPct.toFixed(1)}%` : '—'}</span></div>
          <div>预测净利润: <span className="font-semibold">{Number.isFinite(nextProfitYi) ? `${nextProfitYi.toFixed(2)}亿` : '—'}</span></div>
        </div>
        {chart.note && <div className="px-1 pb-1 text-[10px] text-slate-300">{chart.note}</div>}
        <div className={chart.note ? 'h-[calc(100%-48px)]' : 'h-[calc(100%-32px)]'}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={scoreData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} interval={0} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={30} domain={[0, 100]} />
              <Tooltip content={compactTooltip} />
              <Bar dataKey="value" name="信号得分(0-100)">
                {scoreData.map((d, idx) => (
                  <Cell key={idx} fill={scoreColor(d.value)} />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v: number) => (Number.isFinite(v) ? v.toFixed(0) : '')}
                  style={{ fill: '#e2e8f0', fontSize: 9, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

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
          {chart.series[3] && <Line yAxisId="right" type="monotone" dataKey="s3" stroke="#ef4444" strokeWidth={2} dot={false} name={chart.labels[3] ?? 'S4'} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}, (prev, next) => {
  if (prev.metricKey !== next.metricKey) return false;
  if (prev.chart !== next.chart) return false;
  if ((prev.chart.history?.length ?? 0) !== (next.chart.history?.length ?? 0)) return false;
  if (prev.balanceHistoryTitle !== next.balanceHistoryTitle) return false;
  if (prev.onOpenBalanceHistory !== next.onOpenBalanceHistory) return false;
  return true;
});

type SwTreeNode = {
  indexCode: string;
  industryCode: string;
  parentCode: string;
  name: string;
  level: 'L1' | 'L2' | 'L3';
  memberCount: number;
  children: SwTreeNode[];
};

type TreeSelection = {
  kind: 'node';
  level: 'L1' | 'L2' | 'L3';
  name: string;
  indexCode: string;
  memberCount: number;
};

function swNodeKey(node: SwTreeNode): string {
  return `${node.level}-${node.industryCode}-${node.indexCode}`;
}

export default function IncomeContrastPage() {
  const [inputText, setInputText] = useState('603983.SH, 600519.SH');
  const [codes, setCodes] = useState<string[]>([]);
  const [rows, setRows] = useState<ContrastRow[]>([]);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  // industry tree state
  const [swTree, setSwTree] = useState<SwTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeLoadError, setTreeLoadError] = useState<string | null>(null);
  const [treeNodeLoading, setTreeNodeLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [treeSelection, setTreeSelection] = useState<TreeSelection | null>(null);
  const [treeFilter, setTreeFilter] = useState('');
  const [memberMatchedNodeCodes, setMemberMatchedNodeCodes] = useState<Set<string>>(new Set());
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [treePaneWidth, setTreePaneWidth] = useState(320);
  const dragSplitRef = useRef<{ startX: number; startW: number } | null>(null);

  // metric filter state
  const [filterExpr, setFilterExpr] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [pinnedCodes, setPinnedCodes] = useState<Set<string>>(new Set());
  const [autoPinByRoeTargetKey, setAutoPinByRoeTargetKey] = useState<string | null>(null);
  const [balanceHistoryModal, setBalanceHistoryModal] = useState<{ title: string; chart: MetricChart } | null>(null);
  const openBalanceHistoryModal = useCallback((chartPayload: MetricChart, title: string) => {
    setBalanceHistoryModal({ title, chart: chartPayload });
  }, []);

  /** 巨潮 p_info3085 最近公开信息弹窗：点击证券代码打开 */
  const [cninfoRecentTsCode, setCninfoRecentTsCode] = useState<string | null>(null);
  const closeCninfoRecentModal = useCallback(() => setCninfoRecentTsCode(null), []);
  const openCninfoRecentModal = useCallback((tsCode: string) => {
    const c = String(tsCode ?? '').trim().toUpperCase();
    if (c) setCninfoRecentTsCode(c);
  }, []);

  /** 基于定期报告标题归纳的热点概念（键为 tsCode 大写） */
  const [hotConceptsByCode, setHotConceptsByCode] = useState<Record<string, HotConceptsCellState>>({});
  const hotConceptsRequestedRef = useRef<Set<string>>(new Set());
  const codesKeyForHotConcepts = useMemo(() => buildCodesKey(codes), [codes]);

  /** 顶部控制区（代码输入、指标过滤）展开/收起，收起后下方分栏占满剩余高度 */
  const [controlPanelExpanded, setControlPanelExpanded] = useState(true);

  // load sw tree once
  useEffect(() => {
    setTreeLoading(true);
    setTreeLoadError(null);
    fetch('/api/parq/sw2021/tree')
      .then((r) => r.json())
      .then((json) => {
        const tree = Array.isArray(json?.tree) ? (json.tree as SwTreeNode[]) : [];
        setSwTree(tree);
        setExpandedNodes(new Set(tree.map((n) => swNodeKey(n))));
      })
      .catch((e) => {
        setTreeLoadError(e instanceof Error ? e.message : '加载申万分类失败');
      })
      .finally(() => setTreeLoading(false));
  }, []);

  useEffect(() => {
    const q = treeFilter.trim();
    if (!q) {
      setMemberMatchedNodeCodes(new Set());
      setMemberSearchLoading(false);
      return;
    }
    let cancelled = false;
    setMemberSearchLoading(true);
    const id = setTimeout(() => {
      fetch(`/api/parq/sw2021/search-members?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return;
          const arr = Array.isArray(json?.nodeCodes) ? json.nodeCodes : [];
          const next = new Set<string>();
          for (const code of arr) {
            const s = String(code ?? '').trim().toUpperCase();
            if (s) next.add(s);
          }
          setMemberMatchedNodeCodes(next);
        })
        .catch(() => {
          if (!cancelled) setMemberMatchedNodeCodes(new Set());
        })
        .finally(() => {
          if (!cancelled) setMemberSearchLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [treeFilter]);

  const industryTree = useMemo(() => {
    const filter = treeFilter.toLowerCase();
    const walk = (nodes: SwTreeNode[]): SwTreeNode[] =>
      nodes
        .map((n) => {
          const children = walk(n.children ?? []);
          if (!filter) return { ...n, children };
          const matched =
            n.name.toLowerCase().includes(filter) ||
            n.indexCode.toLowerCase().includes(filter) ||
            n.level.toLowerCase().includes(filter);
          const stockMatched = memberMatchedNodeCodes.has(String(n.indexCode ?? '').toUpperCase());
          if (matched || stockMatched || children.length > 0) return { ...n, children };
          return null;
        })
        .filter((n): n is SwTreeNode => n != null);
    return walk(swTree);
  }, [swTree, treeFilter, memberMatchedNodeCodes]);

  const fetchNodeStockCodes = useCallback(async (node: SwTreeNode): Promise<string[]> => {
    const size = 500;
    let page = 1;
    let totalRows = 0;
    const set = new Set<string>();

    while (true) {
      const query = new URLSearchParams({
        level: node.level,
        code: node.indexCode,
        page: String(page),
        size: String(size),
      });
      const res = await fetch(`/api/parq/sw2021/members?${query.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      totalRows = Number(json?.totalRows ?? 0);
      for (const r of data) {
        const code = String(r?.ts_code ?? '').trim().toUpperCase();
        if (/^\d{6}\.(SZ|SH|BJ)$/.test(code)) set.add(code);
      }
      if (page * size >= totalRows || data.length === 0) break;
      page += 1;
    }
    return [...set].sort();
  }, []);

  const applyTreeCodes = useCallback((nextCodes: string[], sel: TreeSelection) => {
    setTreeSelection(sel);
    setInputText(nextCodes.join(', '));
    setCodes(nextCodes);
    setAutoPinByRoeTargetKey(nextCodes.length ? buildCodesKey(nextCodes) : null);
  }, []);

  const onSelectNode = useCallback(
    async (node: SwTreeNode) => {
      const sel: TreeSelection = {
        kind: 'node',
        level: node.level,
        name: node.name,
        indexCode: node.indexCode,
        memberCount: node.memberCount,
      };
      setTreeSelection(sel);
      setTreeNodeLoading(true);
      try {
        const next = await fetchNodeStockCodes(node);
        applyTreeCodes(next, sel);
      } catch {
        applyTreeCodes([], sel);
      } finally {
        setTreeNodeLoading(false);
      }
    },
    [applyTreeCodes, fetchNodeStockCodes]
  );

  // 左右分栏拖动
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragSplitRef.current) return;
      const dx = e.clientX - dragSplitRef.current.startX;
      const maxW = typeof window !== 'undefined' ? window.innerWidth * 0.55 : 800;
      const w = Math.min(Math.max(dragSplitRef.current.startW + dx, 200), maxW);
      setTreePaneWidth(w);
    };
    const onUp = () => {
      dragSplitRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startSplitDrag = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragSplitRef.current = { startX: e.clientX, startW: treePaneWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [treePaneWidth]);

  const progressText = useMemo(() => {
    if (!codes.length) return '未开始';
    if (!running) return `完成 ${doneCount}/${codes.length}`;
    return `加载中 ${doneCount}/${codes.length}`;
  }, [codes.length, doneCount, running]);

  const renderTreeNode = useCallback((node: SwTreeNode, depth = 0): React.ReactNode => {
    const key = swNodeKey(node);
    const hasChildren = (node.children?.length ?? 0) > 0;
    const expanded = expandedNodes.has(key);
    const selected = treeSelection?.kind === 'node' && treeSelection.indexCode === node.indexCode;

    return (
      <div key={key}>
        <div
          className={`flex items-stretch rounded-md mb-0.5 ${selected ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}
          style={{ marginLeft: `${depth * 10}px` }}
        >
          <button
            type="button"
            className="w-7 shrink-0 flex items-center justify-center text-gray-400 hover:bg-gray-100 rounded-l-md"
            aria-label={expanded ? '折叠' : '展开'}
            disabled={!hasChildren}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!hasChildren) return;
              setExpandedNodes((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
          >
            {hasChildren ? (expanded ? '▼' : '▶') : '·'}
          </button>
          <button
            type="button"
            className="flex-1 text-left px-2 py-1.5 text-sm text-gray-800 hover:bg-gray-50/80 rounded-r-md truncate"
            onClick={() => { void onSelectNode(node); }}
            title={`${node.name} ${node.indexCode}`}
          >
            <span className="font-medium">{node.name}</span>
            <span className="text-xs text-gray-400 ml-1">{node.indexCode}</span>
            <span className="text-xs text-gray-400 ml-1">({node.memberCount})</span>
          </button>
        </div>
        {hasChildren && expanded && (
          <div className="space-y-0.5">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }, [expandedNodes, onSelectNode, treeSelection]);

  const columnOrder = useMemo(
    () => ['pin_top', 'stock_basic', ...METRIC_COLUMNS.map((c) => c.key)],
    []
  );

  const toggleRowPin = useCallback((tsCode: string, checked: boolean) => {
    setPinnedCodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(tsCode);
      else next.delete(tsCode);
      return next;
    });
  }, []);

  const cellRenderers = useMemo(() => {
    const pinRenderer = (params: any) => {
      const tsCode = String(params?.data?.stock_basic?.tsCode ?? params?.value ?? '').toUpperCase();
      if (!tsCode) return null;
      const checked = pinnedCodes.has(tsCode);
      return (
        <div className="flex h-full items-start justify-center pt-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => toggleRowPin(tsCode, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`${tsCode} 置顶`}
            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </div>
      );
    };

    const stockRenderer = (params: any) => {
      const row = params?.value as StockBasicGridValue | undefined;
      if (!row) return <div className="text-xs text-gray-400">—</div>;
      const hot = row.__hotConcepts;
      return (
        <div className="space-y-1 py-1">
          <button
            type="button"
            className="block w-full text-left font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
            onClick={(e) => {
              e.stopPropagation();
              openCninfoRecentModal(row.tsCode);
            }}
          >
            {row.tsCode}
          </button>
          {row.loading ? (
            <div className="text-xs text-gray-500">加载中...</div>
          ) : row.error ? (
            <div className="text-xs text-red-500">{row.error}</div>
          ) : row.stockInfo ? (
            <>
              <div className="text-xs text-gray-700">名称: {row.stockInfo.name}</div>
              <div className="text-xs text-gray-700">所在地: {row.stockInfo.area}</div>
              <div className="text-xs text-gray-700">行业: {row.stockInfo.industry}</div>
            </>
          ) : (
            <div className="text-xs text-gray-500">无股票信息</div>
          )}
          {!row.loading &&
            (hot?.state === 'loading' ? (
              <div className="text-[11px] text-gray-500">热点概念：归纳中…</div>
            ) : hot?.state === 'error' ? (
              <div className="text-[11px] text-amber-800" title={hot.err}>
                热点：{hot.err.length > 48 ? `${hot.err.slice(0, 48)}…` : hot.err}
              </div>
            ) : hot?.state === 'ready' ? (
              <div className="text-[11px] leading-snug text-violet-950" title={hot.summary}>
                热点：{hot.summary || '—'}
              </div>
            ) : null)}
        </div>
      );
    };

    const renderers: Record<string, (params: any) => any> = {
      pin_top: pinRenderer,
      stock_basic: stockRenderer,
    };
    for (const c of METRIC_COLUMNS) {
      renderers[c.key] = (params: any) => {
        const chart = params?.value as MetricChart | undefined;
        const row = params?.data?.stock_basic as ContrastRow | undefined;
        const rowTitle = row?.stockInfo?.name
          ? `${row.tsCode} ${row.stockInfo.name} 资产负债结构历史（最近3年，12期）`
          : `${row?.tsCode ?? ''} 资产负债结构历史（最近3年，12期）`;
        return (
          <IncomeChartCell
            metricKey={c.key}
            chart={chart ?? emptyChart()}
            balanceHistoryTitle={rowTitle}
            onOpenBalanceHistory={c.key === 'balance_structure' ? openBalanceHistoryModal : undefined}
          />
        );
      };
    }
    return renderers;
    // 热点不进依赖：由行数据 __hotConcepts（displayGridData）刷新，避免每只股票 loading/ready 都换 renderers 引用导致 DataGrid 整表重建列
  }, [pinnedCodes, toggleRowPin, openBalanceHistoryModal, openCninfoRecentModal]);

  const rowsRef = useRef<ContrastRow[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CONCURRENCY = 5;
  const FLUSH_INTERVAL_MS = 600;

  const flushRows = useCallback(() => {
    setRows([...rowsRef.current]);
  }, []);

  useEffect(() => {
    if (!codes.length) {
      rowsRef.current = [];
      setRows([]);
      setDoneCount(0);
      return;
    }
    let cancelled = false;

    const initialRows = codes.map((tsCode) => ({
      tsCode,
      loading: true,
      stockInfo: null,
      charts: emptyCharts(),
    }));
    rowsRef.current = initialRows;
    setRows(initialRows);
    setRunning(true);
    setDoneCount(0);

    const codeIdx = { next: 0, done: 0 };

    const scheduleFlush = () => {
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        if (!cancelled) flushRows();
      }, FLUSH_INTERVAL_MS);
    };

    const processNext = async (): Promise<void> => {
      while (codeIdx.next < codes.length && !cancelled) {
        const i = codeIdx.next++;
        const tsCode = codes[i];
        const row = await buildContrastRow(tsCode);
        if (cancelled) break;
        rowsRef.current = rowsRef.current.map((r) => (r.tsCode === tsCode ? row : r));
        codeIdx.done++;
        if (!cancelled) setDoneCount(codeIdx.done);
        scheduleFlush();
      }
    };

    const run = async () => {
      const workers = Array.from({ length: Math.min(CONCURRENCY, codes.length) }, () => processNext());
      await Promise.all(workers);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (!cancelled) {
        flushRows();
        setRunning(false);
      }
    };
    run();

    return () => {
      cancelled = true;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setRunning(false);
    };
  }, [codes, flushRows]);

  /** 对比股票集合变化时清空热点请求记录与结果 */
  useEffect(() => {
    hotConceptsRequestedRef.current.clear();
    setHotConceptsByCode({});
  }, [codesKeyForHotConcepts]);

  /** 行加载完成后按代码请求热点归纳（结果写入 displayGridData.__hotConcepts，不触发 cellRenderers 重建） */
  useEffect(() => {
    const ready = rows.filter((r) => !r.loading);
    for (const row of ready) {
      const code = row.tsCode.trim().toUpperCase();
      if (hotConceptsRequestedRef.current.has(code)) continue;
      hotConceptsRequestedRef.current.add(code);
      setHotConceptsByCode((prev) => ({ ...prev, [code]: { state: 'loading' } }));
      void fetch('/api/hot-concepts/from-disclosures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsCode: code }),
      })
        .then(async (res) => {
          const j = (await res.json().catch(() => ({}))) as { error?: string; summary?: string };
          if (!res.ok) {
            const err = typeof j?.error === 'string' ? j.error : `HTTP ${res.status}`;
            setHotConceptsByCode((p) => ({ ...p, [code]: { state: 'error', err } }));
            return;
          }
          const summary = typeof j?.summary === 'string' ? j.summary.trim() : '';
          setHotConceptsByCode((p) => ({ ...p, [code]: { state: 'ready', summary } }));
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          setHotConceptsByCode((p) => ({ ...p, [code]: { state: 'error', err: msg } }));
        });
    }
  }, [rows]);

  // metric filter: evaluate expression against latest metrics
  const { filteredRows, filterErr } = useMemo(() => {
    if (!filterExpr.trim()) return { filteredRows: rows, filterErr: null as string | null };
    try {
      const expr = filterExpr.trim();
      const lastFinite = (series: number[]) => { for (let i = series.length - 1; i >= 0; i--) if (Number.isFinite(series[i])) return series[i]; return null; };
      const filtered = rows.filter((row) => {
        const ctx: Record<string, number | null> = {};
        const revMv = row.charts.rev_mv;
        const costM = row.charts.cost_margin;
        const fee = row.charts.fee_revenue;
        const dy = row.charts.dividend_yield;
        const gs = row.charts.growth_summary;
        const dp = row.charts.dupont;
        ctx['营收'] = ctx['revenue'] = revMv.series[0] ? lastFinite(revMv.series[0]) : null;
        ctx['利润'] = ctx['profit'] = revMv.series[1] ? lastFinite(revMv.series[1]) : null;
        ctx['市值'] = ctx['mv'] = revMv.series[2] ? lastFinite(revMv.series[2]) : null;
        ctx['毛利率'] = costM.series[2] ? lastFinite(costM.series[2]) : null;
        ctx['销售费率'] = fee.series[1] && fee.series[0] ? (() => { const s = lastFinite(fee.series[1]); const r = lastFinite(fee.series[0]); return s != null && r != null && r !== 0 ? (s / r) * 100 : null; })() : null;
        ctx['研发费率'] = fee.series[3] && fee.series[0] ? (() => { const s = lastFinite(fee.series[3]); const r = lastFinite(fee.series[0]); return s != null && r != null && r !== 0 ? (s / r) * 100 : null; })() : null;
        ctx['股息率'] = ctx['dividendYield'] = dy.series[0] ? lastFinite(dy.series[0]) : null;
        ctx['市值CAGR'] = gs.series[0]?.[0] ?? null;
        ctx['营收CAGR'] = gs.series[0]?.[1] ?? null;
        ctx['利润CAGR'] = gs.series[0]?.[2] ?? null;
        ctx['净资产CAGR'] = gs.series[0]?.[3] ?? null;
        ctx['周转率'] = ctx['turnover'] = dp.series[0] ? lastFinite(dp.series[0]) : null;
        ctx['权益乘数'] = ctx['multiplier'] = dp.series[1] ? lastFinite(dp.series[1]) : null;
        ctx['净利率'] = ctx['netMargin'] = dp.series[2] ? lastFinite(dp.series[2]) : null;
        ctx['ROE'] = ctx['roe'] = dp.series[3] ? lastFinite(dp.series[3]) : null;
        const fs = row.charts.forecast_signal;
        ctx['预测得分'] = ctx['forecastScore'] = fs.series[0]?.[3] ?? null;
        ctx['预测净利增速'] = ctx['forecastProfitGrowth'] = fs.series[0]?.[4] ?? null;
        ctx['预测净利润'] = ctx['forecastProfit'] = fs.series[0]?.[5] ?? null;
        const keys = Object.keys(ctx);
        const vals = keys.map((k) => ctx[k] ?? NaN);
        const fn = new Function(...keys, `"use strict"; return (${expr});`);
        return !!fn(...vals);
      });
      return { filteredRows: filtered, filterErr: null as string | null };
    } catch (e) {
      return { filteredRows: rows, filterErr: e instanceof Error ? e.message : '表达式错误' };
    }
  }, [rows, filterExpr]);

  useEffect(() => { setFilterError(filterErr); }, [filterErr]);

  useEffect(() => {
    setPinnedCodes(readPinnedCodesFromStorage());
  }, []);

  useEffect(() => {
    writePinnedCodesToStorage(pinnedCodes);
  }, [pinnedCodes]);

  useEffect(() => {
    if (!balanceHistoryModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBalanceHistoryModal(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [balanceHistoryModal]);

  useEffect(() => {
    if (!autoPinByRoeTargetKey) return;
    if (buildCodesKey(codes) !== autoPinByRoeTargetKey) return;

    if (codes.length === 0) {
      setAutoPinByRoeTargetKey(null);
      return;
    }

    const targetSet = new Set(codes.map((c) => c.toUpperCase()));
    const targetRows = rows.filter((r) => targetSet.has(r.tsCode.toUpperCase()));
    const allReady = targetRows.length === targetSet.size && targetRows.every((r) => !r.loading);
    if (!allReady) return;

    const lastFinite = (series: number[]) => {
      for (let i = series.length - 1; i >= 0; i -= 1) {
        if (Number.isFinite(series[i])) return series[i];
      }
      return null;
    };

    const picked = targetRows
      .map((row) => {
        const roeSeries = row.charts.dupont.series[3] ?? [];
        const roePct = lastFinite(roeSeries);
        return roePct != null && roePct >= 10 ? row.tsCode.toUpperCase() : null;
      })
      .filter((code): code is string => code != null);

    if (picked.length > 0) {
      setPinnedCodes((prev) => {
        const next = new Set(prev);
        for (const code of picked) next.add(code);
        return next;
      });
    }
    setAutoPinByRoeTargetKey(null);
  }, [autoPinByRoeTargetKey, codes, rows]);

  const startCompare = () => {
    const parsed = Array.from(
      new Set(
        inputText
          .split(/[,\n，]+/)
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^\d{6}\.(SZ|SH|BJ)$/.test(s))
      )
    );
    setCodes(parsed);
    setAutoPinByRoeTargetKey(parsed.length ? buildCodesKey(parsed) : null);
  };

  const orderedFilteredRows = useMemo(() => {
    if (pinnedCodes.size === 0) return filteredRows;
    const pinned: ContrastRow[] = [];
    const normal: ContrastRow[] = [];
    for (const row of filteredRows) {
      if (pinnedCodes.has(row.tsCode.toUpperCase())) pinned.push(row);
      else normal.push(row);
    }
    return [...pinned, ...normal];
  }, [filteredRows, pinnedCodes]);

  /** 股票集合或置顶集合变化时让 AG Grid 去掉列排序，否则「置顶 / ROE 自动置顶」的行序会被排序状态盖住 */
  const gridClientSortResetKey = useMemo(() => {
    const pinPart = [...pinnedCodes].map((c) => String(c).trim().toUpperCase()).sort().join('|');
    return `${buildCodesKey(codes)}#${pinPart}`;
  }, [codes, pinnedCodes]);

  // grid uses filteredRows
  const displayGridData = useMemo<CSVData>(() => {
    const headers = ['置顶', '股票基本信息', ...METRIC_COLUMNS.map((c) => c.label)];
    const data: ContrastGridRow[] = orderedFilteredRows.map((row) => {
      const code = row.tsCode.trim().toUpperCase();
      const metricData = Object.fromEntries(METRIC_COLUMNS.map((c) => [c.key, row.charts[c.key]])) as Record<MetricKey, MetricChart>;
      return { pin_top: row.tsCode.toUpperCase(), stock_basic: { ...row, __hotConcepts: hotConceptsByCode[code] }, ...metricData };
    });
    return { category: 'incomeContrast', filename: 'incomeContrast', headers, originalHeaders: columnOrder, data, totalRows: data.length };
  }, [orderedFilteredRows, columnOrder, hotConceptsByCode]);

  return (
    <div className="box-border flex max-h-full min-h-0 min-w-0 max-w-full flex-1 basis-0 flex-col gap-4 overflow-hidden p-4">
      {/* control panel — 可折叠 */}
      <div className="w-full max-w-full shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <button
          type="button"
          onClick={() => setControlPanelExpanded((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50/90"
          aria-expanded={controlPanelExpanded}
          aria-controls="income-contrast-control-panel"
          id="income-contrast-control-panel-toggle"
        >
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-gray-500 transition-transform duration-200 ${controlPanelExpanded ? '' : '-rotate-90'}`}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-900">条件</h2>
            {!controlPanelExpanded && (
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {progressText}
                {codes.length > 0 ? ` · ${codes.length} 只股票` : ''}
                {filterExpr.trim() && !filterError ? ` · 过滤 ${filteredRows.length}/${rows.length}` : ''}
              </p>
            )}
          </div>
        </button>
        {controlPanelExpanded && (
          <div
            id="income-contrast-control-panel"
            role="region"
            aria-labelledby="income-contrast-control-panel-toggle"
            className="space-y-3 border-t border-gray-100 px-4 pb-4 pt-2"
          >
            <p className="text-sm text-gray-600">
              左侧行业树点击枝干（一级/二级行业）或叶子（个股）即可在右侧加载对比；亦可手动输入代码后点「开始对比」。指标过滤作用于右侧已加载数据。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="例如: 603983.SH, 600519.SH, 000001.SZ"
                className="min-w-[24rem] flex-1"
              />
              <Button onClick={startCompare} disabled={running}>
                {running ? '加载中...' : '开始对比'}
              </Button>
              <span className="text-sm text-gray-500">{progressText}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500 shrink-0">指标过滤:</span>
              <Input
                value={filterExpr}
                onChange={(e) => setFilterExpr(e.target.value)}
                placeholder="例: 毛利率 > 30 && 利润CAGR > 10 && ROE > 15"
                className="min-w-[28rem] flex-1 font-mono text-sm"
              />
              {filterExpr.trim() && (
                <span className="text-xs text-gray-500">
                  {filterError ? <span className="text-red-500">{filterError}</span> : `${filteredRows.length}/${rows.length} 条匹配`}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400">
              可用变量: 营收, 利润, 市值 (亿) | 毛利率, 净利率, ROE, 股息率 (%) | 周转率, 权益乘数 (次) | 营收CAGR, 利润CAGR, 净资产CAGR, 市值CAGR (%) | 销售费率, 研发费率 (%)
            </div>
            <div className="text-xs text-gray-400">
              预测变量: 预测得分(0-100), 预测净利增速(%), 预测净利润(亿)
            </div>
          </div>
        )}
      </div>

      {/* 左侧行业树 + 可拖动分隔条 + 右侧表格：限高避免树展开撑高整页，滚动在左右栏内部 */}
      <div className="flex min-h-0 min-w-0 max-h-full w-full flex-1 basis-0 flex-row overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div
          className="flex min-h-0 max-h-full min-w-0 shrink-0 flex-col self-stretch overflow-hidden border-r border-gray-100 bg-white"
          style={{ width: treePaneWidth }}
        >
          <div className="p-3 border-b border-gray-100 shrink-0 space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">申万行业分类</h3>
            <Input
              value={treeFilter}
              onChange={(e) => setTreeFilter(e.target.value)}
              placeholder="搜索行业/指数/股票名称/股票代码"
              className="text-sm"
            />
            {treeFilter.trim() && memberSearchLoading && (
              <div className="text-[11px] text-gray-400">正在匹配股票名称/代码...</div>
            )}
            {treeSelection && (
              <div className="text-xs text-gray-500 leading-relaxed">
                已选 {treeSelection.level}「{treeSelection.name}」({treeSelection.indexCode}) — 预计 {treeSelection.memberCount} 只股票
                {treeNodeLoading ? '，正在加载成分...' : ''}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
            {industryTree.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-6">
                {treeLoading ? '加载分类树中...' : treeLoadError ? treeLoadError : '无匹配结果'}
              </div>
            ) : (
              industryTree.map((n) => renderTreeNode(n))
            )}
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整左右宽度"
          onMouseDown={startSplitDrag}
          className="w-1.5 shrink-0 cursor-col-resize bg-gray-100 hover:bg-sky-300 active:bg-sky-400 border-x border-gray-200 transition-colors"
        />

        <div className="flex min-h-0 min-w-0 max-h-full flex-1 basis-0 flex-col overflow-hidden bg-white">
          {codes.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-gray-400">
              在左侧点击一级行业、二级行业或个股，右侧将加载对应股票对比；也可在上方输入代码后点「开始对比」。
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 max-h-full flex-1 basis-0 overflow-x-auto">
              <DataGrid
                category="incomeContrast"
                tabId="incomeContrast_grid"
                title="利润对比"
                tightChrome
                localData={displayGridData}
                useServerPagination={false}
                columnOrder={columnOrder}
                fieldLabelMap={Object.fromEntries([
                  ['pin_top', '置顶'],
                  ['stock_basic', '股票基本信息'],
                  ...METRIC_COLUMNS.map((c) => [c.key, c.label]),
                ])}
                customCellRenderers={cellRenderers}
                rowHeight={240}
                gridHeight="100%"
                uniformColumnWidth={360}
                columnWidthByField={{ pin_top: 72, stock_basic: 228 }}
                pinnedLeftFields={['pin_top', 'stock_basic']}
                clientSortResetKey={gridClientSortResetKey}
                getRowId={(params: any) => params.data?.stock_basic?.tsCode ?? String(params.rowIndex)}
              />
            </div>
          )}
        </div>
      </div>

      <CninfoStockRecentInfoModal
        open={cninfoRecentTsCode != null}
        tsCode={cninfoRecentTsCode ?? ''}
        onClose={closeCninfoRecentModal}
      />

      {balanceHistoryModal &&
        createPortal(
          <div className="fixed inset-0 z-[1400] flex h-screen w-screen flex-col bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="text-sm font-semibold text-gray-900">{balanceHistoryModal.title}</div>
              <button
                type="button"
                onClick={() => setBalanceHistoryModal(null)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="关闭历史弹窗"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(balanceHistoryModal.chart.history ?? []).slice().reverse().map((item) => {
                  const miniBars = item.values.map((v, idx) => ({
                    idx: balanceHistoryModal.chart.x[idx] ?? String(idx + 1),
                    value: v,
                  }));
                  const balanceTooltip = ({ active, payload, label }: any) => {
                    if (!active || !payload?.length) return null;
                    const fullLabel = BALANCE_FULL_LABELS[label] ?? label;
                    return (
                      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 3, padding: '3px 6px', fontSize: 10, lineHeight: '14px' }}>
                        <div style={{ fontWeight: 600, marginBottom: 1, color: '#334155' }}>{fullLabel}</div>
                        {payload.map((p: any, i: number) => (
                          <div key={i} style={{ color: p.color, whiteSpace: 'nowrap' }}>
                            {p.name}: {Number.isFinite(Number(p.value)) ? `${Number(p.value).toFixed(2)}亿` : '—'}
                          </div>
                        ))}
                      </div>
                    );
                  };
                  return (
                    <div key={item.period} className="rounded border border-gray-200 p-2">
                      <div className="mb-1 text-xs font-medium text-gray-700">{item.period}</div>
                      <div className="h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={miniBars} margin={{ top: 6, right: 8, left: 0, bottom: 14 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="idx" tick={{ fontSize: 9 }} interval={0} angle={-90} textAnchor="end" height={46} />
                            <YAxis tick={{ fontSize: 9 }} width={38} tickFormatter={(v: any) => `${Number(v).toFixed(0)}亿`} />
                            <Tooltip content={balanceTooltip} />
                            <Bar dataKey="value" name="资产负债结构(亿)">
                              {miniBars.map((_, idx) => (
                                <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                              ))}
                              <LabelList
                                dataKey="value"
                                position="top"
                                formatter={(v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}亿` : '')}
                                style={{ fill: '#334155', fontSize: 9, fontWeight: 600 }}
                              />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="border-t border-gray-200 px-4 py-2">
              <button
                type="button"
                onClick={() => setBalanceHistoryModal(null)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                关闭
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/** All time-series metric names merged into one API call */
const ALL_SERIES_METRICS = [
  'total_revenue_ttm', 'n_income_attr_p_ttm', 'total_mv',
  'c_inf_fr_operate_a_ttm', 'n_cashflow_act_ttm',
  'oper_cost_ttm', 'grossMargin_ttm',
  'sell_exp_ttm', 'admin_exp_ttm', 'rd_exp_ttm',
  'total_hldr_eqy_exc_min_int',
  'dividend_ttm_rate',
  'mv_growth', 'revenue_growth', 'profit_growth', 'net_assets_growth',
  'netMargin_ttm', 'totalAsset_turnover_ttm', 'equity_multiplier_ttm', 'roe_dupont',
].join(',');

/** Single-period snapshot metrics (balance structure) */
const BALANCE_METRICS = [
  'total_cash', 'prepayment', 'accounts_receiv', 'inventories',
  'oth_cur_assets', 'lt_eqt_invest', 'fix_assets', 'intan_assets', 'oth_nca',
  'st_borr', 'accounts_pay', 'contract_liab', 'payroll_taxes_payable',
  'oth_cur_liab', 'lt_borr', 'oth_ncl',
].join(',');

async function buildContrastRow(tsCode: string): Promise<ContrastRow> {
  const charts = emptyCharts();
  try {
    const enc = encodeURIComponent(tsCode);
    const [stockJson, allMetricsJson, balanceJson, dailyJson, mainBizJson] = await Promise.all([
      fetchJson(`/api/csv/stockList?ts_code=${enc}`),
      fetchJson(`/api/metrics?stock=${enc}&metrics=${ALL_SERIES_METRICS}&from=2014Q1&to=2026Q4&years=5`),
      fetchJson(`/api/metrics?stock=${enc}&metrics=${BALANCE_METRICS}&from=2014Q1&to=2026Q4`),
      fetchJson(`/api/parq/daily_basic?ts_code=${enc}&page=1&size=1000000&sortField=trade_date&sortDir=asc&start_date=20140101`),
      fetchJson(`/api/parq/finaMainbzVip?ts_code=${enc}&page=1&size=1000000&sortField=end_date&sortDir=asc&start_date=20140101`),
    ]);

    const stockRow = Array.isArray(stockJson?.data) ? stockJson.data[0] : null;
    const stockInfo: StockInfo | null = stockRow
      ? {
          name: String(stockRow?.name ?? '').trim() || '—',
          area: String(stockRow?.area ?? '').trim() || '—',
          industry: String(stockRow?.industry ?? '').trim() || '—',
        }
      : null;

    const pts = (Array.isArray(allMetricsJson?.points) ? allMetricsJson.points : [])
      .slice()
      .sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
    const dailyRows = (Array.isArray(dailyJson?.data) ? dailyJson.data : [])
      .slice()
      .sort((a: any, b: any) => parseDateNum(a?.trade_date) - parseDateNum(b?.trade_date));
    const mainBizRows = (Array.isArray(mainBizJson?.data) ? mainBizJson.data : [])
      .slice()
      .sort((a: any, b: any) => parseDateNum(a?.end_date) - parseDateNum(b?.end_date));

    const toYi = (r: any, k: string) => { const n = parseNum(r?.[k]); return n == null ? null : n / 1e8; };
    const toYiMv = (r: any) => { const n = parseNum(r?.total_mv); return n == null ? null : n / 1e4; };
    const toPct = (r: any, k: string) => { const n = parseNum(r?.[k]); return n == null ? null : n * 100; };
    const toVal = (r: any, k: string) => parseNum(r?.[k]);
    const labels = pts.map((r: any) => formatDateYYMM(r?.period));
    const sampled = sampleWithLabels(pts.map(() => 1), labels);
    const sampledIdx = sampled.labels.map((lbl: string) => pts.findIndex((r: any) => formatDateYYMM(r?.period) === lbl)).filter((i: number) => i >= 0);
    const sp = sampledIdx.map((i: number) => pts[i]);
    const spLabels = sampledIdx.map((i: number) => labels[i]);

    // rev_mv (all points, no sampling for this chart)
    {
      type RevMvPt = { x: string; rev: number; profit: number; mv: number };
      const allPts: RevMvPt[] = pts.map((r: any) => {
        const q = formatDateYYMM(r?.period);
        if (!q) return null;
        const rev = parseNum(r?.total_revenue_ttm);
        const profit = parseNum(r?.n_income_attr_p_ttm);
        const mv = parseNum(r?.total_mv);
        return { x: q, rev: rev == null ? NaN : rev / 1e8, profit: profit == null ? NaN : profit / 1e8, mv: mv == null ? NaN : mv / 1e4 };
      }).filter((p: RevMvPt | null): p is RevMvPt => p != null);

      charts.rev_mv = {
        x: allPts.map((p) => p.x),
        series: [allPts.map((p) => p.rev), allPts.map((p) => p.profit), allPts.map((p) => p.mv)],
        labels: ['TTM营收(亿)', 'TTM归母净利润(亿)', '总市值(亿)'],
        latest: [
          fmt(allPts.filter((p) => Number.isFinite(p.rev)).at(-1)?.rev ?? null, '亿'),
          fmt(allPts.filter((p) => Number.isFinite(p.profit)).at(-1)?.profit ?? null, '亿'),
          fmt(allPts.filter((p) => Number.isFinite(p.mv)).at(-1)?.mv ?? null, '亿'),
        ],
      };
    }

    // rev_cashflow
    charts.rev_cashflow = {
      x: spLabels,
      series: [
        sp.map((r: any) => toYi(r, 'total_revenue_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'c_inf_fr_operate_a_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'n_income_attr_p_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'n_cashflow_act_ttm') ?? NaN),
      ],
      labels: ['营收TTM(亿)', '经营现金流TTM(亿)', '净利润TTM(亿)', '经营现金流净额TTM(亿)'],
      latest: [
        fmt(toYi(pts.at(-1), 'total_revenue_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'c_inf_fr_operate_a_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'n_income_attr_p_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'n_cashflow_act_ttm'), '亿'),
      ],
    };

    // cost_margin
    charts.cost_margin = {
      x: spLabels,
      series: [
        sp.map((r: any) => toYi(r, 'total_revenue_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'oper_cost_ttm') ?? NaN),
        sp.map((r: any) => toPct(r, 'grossMargin_ttm') ?? NaN),
      ],
      labels: ['营收TTM(亿)', '成本TTM(亿)', '毛利率TTM(%)'],
      latest: [
        fmt(toYi(pts.at(-1), 'total_revenue_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'oper_cost_ttm'), '亿'),
        fmt(toPct(pts.at(-1), 'grossMargin_ttm'), '%'),
      ],
    };

    // fee_revenue
    charts.fee_revenue = {
      x: spLabels,
      series: [
        sp.map((r: any) => toYi(r, 'total_revenue_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'sell_exp_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'admin_exp_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'rd_exp_ttm') ?? NaN),
      ],
      labels: ['营收TTM(亿)', '销售费TTM(亿)', '管理费TTM(亿)', '研发费TTM(亿)'],
      latest: [
        fmt(toYi(pts.at(-1), 'total_revenue_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'sell_exp_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'admin_exp_ttm'), '亿'),
        fmt(toYi(pts.at(-1), 'rd_exp_ttm'), '亿'),
      ],
    };

    // dividend_yield
    charts.dividend_yield = {
      x: spLabels,
      series: [sp.map((r: any) => toPct(r, 'dividend_ttm_rate') ?? NaN)],
      labels: ['股息率TTM(%)'],
      latest: [fmt(toPct(pts.at(-1), 'dividend_ttm_rate'), '%')],
    };

    // growth_summary (single anchor period + fallback year window: 5y -> 1y)
    {
      const periodMap = new Map<string, any>();
      for (const r of pts) {
        const p = String(r?.period ?? '').trim();
        if (p) periodMap.set(p, r);
      }
      const growthKeys = ['total_mv', 'total_revenue_ttm', 'n_income_attr_p_ttm', 'total_hldr_eqy_exc_min_int'] as const;
      const anchorPoint = pts
        .slice()
        .reverse()
        .find((r: any) => growthKeys.every((k) => parseNum(r?.[k]) != null))
        ?? pts
          .slice()
          .reverse()
          .find((r: any) => growthKeys.some((k) => parseNum(r?.[k]) != null))
        ?? pts.at(-1);
      const anchorPeriod = String(anchorPoint?.period ?? '').trim();

      const calcFallbackCagr = (currentKey: string): { value: number | null; years: number | null } => {
        const cur = parseNum(anchorPoint?.[currentKey]);
        if (cur == null || cur <= 0 || !anchorPeriod) return { value: null, years: null };
        for (let years = 5; years >= 1; years--) {
          const pastPeriod = shiftQuarterPeriod(anchorPeriod, years);
          if (!pastPeriod) continue;
          const pastRow = periodMap.get(pastPeriod);
          const past = parseNum(pastRow?.[currentKey]);
          if (past == null || past <= 0) continue;
          const ratio = cur / past;
          if (!(ratio > 0)) continue;
          return { value: (Math.pow(ratio, 1 / years) - 1) * 100, years };
        }
        return { value: null, years: null };
      };

      const mv = calcFallbackCagr('total_mv');
      const rev = calcFallbackCagr('total_revenue_ttm');
      const prof = calcFallbackCagr('n_income_attr_p_ttm');
      const eqy = calcFallbackCagr('total_hldr_eqy_exc_min_int');
      const growthValuesRaw: Array<number | null> = [mv.value, rev.value, prof.value, eqy.value];
      const growthValues = growthValuesRaw.map((v) => (v == null ? NaN : v));
      const yearNote = `市值${mv.years ?? '-'}年 / 营收${rev.years ?? '-'}年 / 利润${prof.years ?? '-'}年 / 净资产${eqy.years ?? '-'}年`;
      charts.growth_summary = {
        x: ['市值', '营收', '净利润', '净资产'],
        series: [growthValues],
        labels: [`市值/营收/净利润/净资产 CAGR(%)${anchorPeriod ? ` @ ${anchorPeriod}` : ''}`],
        latest: [growthValuesRaw.map((v) => fmt(v, '%')).join(' | ')],
        note: anchorPeriod ? `${anchorPeriod} · ${yearNote}` : undefined,
      };
    }

    // growth_trend
    charts.growth_trend = {
      x: spLabels,
      series: [
        sp.map((r: any) => toYi(r, 'n_income_attr_p_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'total_revenue_ttm') ?? NaN),
        sp.map((r: any) => toYi(r, 'total_hldr_eqy_exc_min_int') ?? NaN),
        sp.map((r: any) => toYiMv(r) ?? NaN),
        sp.map((r: any) => toVal(r, 'profit_growth') ?? 0),
        sp.map((r: any) => toVal(r, 'revenue_growth') ?? 0),
        sp.map((r: any) => toVal(r, 'net_assets_growth') ?? 0),
        sp.map((r: any) => toVal(r, 'mv_growth') ?? 0),
      ],
      labels: [
        '归母净利润TTM(亿)', '营收TTM(亿)', '归母所有者权益(亿)', '总市值(亿)',
        '利润5年CAGR', '营收5年CAGR', '净资产5年CAGR', '市值5年CAGR',
      ],
      latest: [
        fmt(toVal(pts.at(-1), 'profit_growth'), '%'), fmt(toVal(pts.at(-1), 'revenue_growth'), '%'),
        fmt(toVal(pts.at(-1), 'net_assets_growth'), '%'), fmt(toVal(pts.at(-1), 'mv_growth'), '%'),
      ],
    };

    // balance_structure (single-period snapshot): choose latest period with non-null balance values
    const balanceKeys = [
      'total_cash', 'prepayment', 'accounts_receiv', 'inventories', 'oth_cur_assets',
      'lt_eqt_invest', 'fix_assets', 'intan_assets', 'oth_nca',
      'st_borr', 'accounts_pay', 'contract_liab', 'payroll_taxes_payable', 'oth_cur_liab', 'lt_borr', 'oth_ncl',
    ];
    const balancePoints = (Array.isArray(balanceJson?.points) ? balanceJson.points : [])
      .slice()
      .sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
    const latestBalancePoint = balancePoints
      .slice()
      .reverse()
      .find((p: any) => balanceKeys.some((k) => parseNum(p?.[k]) != null));
    const balanceResults = balanceJson?.results ?? {};
    const balanceSource = latestBalancePoint ?? Object.fromEntries(balanceKeys.map((k) => [k, balanceResults?.[k]?.value ?? null]));
    const balanceVals = balanceKeys.map((k) => (parseNum((balanceSource as any)?.[k]) ?? 0) / 1e8);
    const balanceHistory = balancePoints
      .filter((p: any) => balanceKeys.some((k) => parseNum(p?.[k]) != null))
      .slice(-12)
      .map((p: any) => ({
        period: String(p?.period ?? ''),
        values: balanceKeys.map((k) => (parseNum(p?.[k]) ?? 0) / 1e8),
      }));
    charts.balance_structure = {
      x: ['现', '预', '应', '存', '他流', '长投', '固资', '无形', '非流', '短借', '应付', '合同', '薪税', '他流负', '长借', '长负'],
      series: [balanceVals],
      labels: ['资产负债结构(亿)'],
      latest: [fmt(balanceVals.reduce((acc, v) => acc + v, 0), '亿(合计)')],
      note: latestBalancePoint?.period ? `@ ${String(latestBalancePoint.period)}` : undefined,
      history: balanceHistory,
    };

    // biz_comp
    {
      const latestDateNum = Math.max(
        ...mainBizRows.map((r: any) => parseDateNum(r?.end_date)).filter((n: number) => Number.isFinite(n)), -Infinity,
      );
      const latestDateRows = mainBizRows.filter((r: any) => parseDateNum(r?.end_date) === latestDateNum);
      const topItems: string[] = latestDateRows
        .map((r: any) => ({ item: String(r?.bz_item ?? ''), sales: parseNum(r?.bz_sales) ?? 0 }))
        .sort((a: any, b: any) => b.sales - a.sales).slice(0, 4)
        .map((x: any) => x.item).filter(Boolean);

      const byDate = new Map<string, Record<string, number>>();
      for (const row of mainBizRows) {
        const d = String(row?.end_date ?? '').trim();
        const item = String(row?.bz_item ?? '').trim();
        const sales = parseNum(row?.bz_sales);
        if (!d || !item || sales == null) continue;
        if (!byDate.has(d)) byDate.set(d, {});
        byDate.get(d)![item] = (byDate.get(d)![item] ?? 0) + sales / 1e8;
      }
      const dates = [...byDate.keys()].sort((a, b) => parseDateNum(a) - parseDateNum(b));
      const bizSeries = topItems.map((item: string) => pickSeries(dates.map((d) => byDate.get(d)?.[item] ?? 0)));
      charts.biz_comp = {
        x: sampleWithLabels(dates.map((d) => parseDateNum(d)), dates.map((d) => formatDateYYMM(d))).labels,
        series: bizSeries, labels: topItems.length ? topItems : ['主营业务'],
        latest: topItems.map((item: string) => fmt(dates.length ? byDate.get(dates.at(-1)!)?.[item] ?? null : null, '亿')),
        note: topItems.length ? undefined : '暂无主营业务构成',
      };
    }

    // valuation charts (ps/pe/pb) — from daily_basic
    const buildValuationChart = (rawValues: Array<number | null>, label: string): MetricChart => {
      const dailyLabels = dailyRows.map((r: any) => formatDateYYMM(r?.trade_date));
      const paired: { val: number; lbl: string }[] = [];
      for (let i = 0; i < rawValues.length; i++) {
        const v = rawValues[i];
        if (typeof v === 'number' && Number.isFinite(v)) paired.push({ val: v, lbl: dailyLabels[i] ?? String(i + 1) });
      }
      if (!paired.length) return { ...emptyChart('暂无数据'), labels: [label] };
      const maxP = 24;
      let s = paired;
      if (paired.length > maxP) { const step = (paired.length - 1) / (maxP - 1); s = Array.from({ length: maxP }, (_, i) => paired[Math.round(i * step)]); }
      const vals = s.map((p) => p.val);
      const firstStats = calcMeanStd(vals);
      if (!firstStats) return { x: s.map((p) => p.lbl), series: [vals], labels: [label], latest: [fmt(vals.at(-1) ?? null)] };
      const upperCap = firstStats.mean + firstStats.std + 1;
      const lowerCap = firstStats.mean - firstStats.std - 1;
      const capped = vals.map((v) => Math.max(lowerCap, Math.min(upperCap, v)));
      const stats = calcMeanStd(capped) ?? firstStats;
      return { x: s.map((p) => p.lbl), series: [capped], labels: [label], latest: [fmt(capped.at(-1) ?? null)], _stats: { mean: stats.mean, high: stats.mean + stats.std, low: stats.mean - stats.std } };
    };
    charts.ps_valuation = buildValuationChart(dailyRows.map((r: any) => parseNum(r?.ps_ttm) ?? parseNum(r?.ps)), 'PS/PS_TTM');
    charts.pe_valuation = buildValuationChart(dailyRows.map((r: any) => parseNum(r?.pe_ttm) ?? parseNum(r?.pe)), 'PE/PE_TTM');
    charts.pb_valuation = buildValuationChart(dailyRows.map((r: any) => parseNum(r?.pb)), 'PB');

    // dupont
    {
      const dpPts = sp.map((r: any) => ({
        x: formatDateYYMM(r?.period),
        turnover: toVal(r, 'totalAsset_turnover_ttm') ?? NaN,
        multiplier: toVal(r, 'equity_multiplier_ttm') ?? NaN,
        netMargin: (toPct(r, 'netMargin_ttm')) ?? NaN,
        roe: (toPct(r, 'roe_dupont')) ?? NaN,
      })).filter((p: any) => !!p.x);
      charts.dupont = {
        x: dpPts.map((p: any) => p.x),
        series: [dpPts.map((p: any) => p.turnover), dpPts.map((p: any) => p.multiplier), dpPts.map((p: any) => p.netMargin), dpPts.map((p: any) => p.roe)],
        labels: ['总资产周转率(TTM)', '权益乘数(TTM)', '销售净利率(TTM)%', '杜邦ROE%'],
        latest: [
          (() => { const v = dpPts.filter((p: any) => Number.isFinite(p.turnover)).at(-1)?.turnover; return v == null ? '—' : v.toFixed(3); })(),
          (() => { const v = dpPts.filter((p: any) => Number.isFinite(p.multiplier)).at(-1)?.multiplier; return v == null ? '—' : v.toFixed(3); })(),
          (() => { const v = dpPts.filter((p: any) => Number.isFinite(p.netMargin)).at(-1)?.netMargin; return v == null ? '—' : `${v.toFixed(2)}%`; })(),
          (() => { const v = dpPts.filter((p: any) => Number.isFinite(p.roe)).at(-1)?.roe; return v == null ? '—' : `${v.toFixed(2)}%`; })(),
        ],
      };
    }

    // forecast_signal: 从利润表、资产负债表、现金流三类信号合成预测值
    {
      const latestPoint = pts.at(-1);
      const latestPeriod = String(latestPoint?.period ?? '').trim();
      const prevYearPeriod = latestPeriod ? shiftQuarterPeriod(latestPeriod, 1) : null;
      const prevYearPoint = prevYearPeriod ? pts.find((p: any) => String(p?.period ?? '').trim() === prevYearPeriod) : null;

      const revYi = toYi(latestPoint, 'total_revenue_ttm');
      const profitYi = toYi(latestPoint, 'n_income_attr_p_ttm');
      const grossMarginPct = toPct(latestPoint, 'grossMargin_ttm');
      const netMarginPct = toPct(latestPoint, 'netMargin_ttm');
      const opInYi = toYi(latestPoint, 'c_inf_fr_operate_a_ttm');
      const opNetYi = toYi(latestPoint, 'n_cashflow_act_ttm');

      const sellYi = toYi(latestPoint, 'sell_exp_ttm');
      const adminYi = toYi(latestPoint, 'admin_exp_ttm');
      const rdYi = toYi(latestPoint, 'rd_exp_ttm');
      const feeRatePct = revYi != null && revYi !== 0
        ? (((sellYi ?? 0) + (adminYi ?? 0) + (rdYi ?? 0)) / revYi) * 100
        : null;

      const revenueGrowthPct = toVal(latestPoint, 'revenue_growth');
      const profitGrowthPct5y = toVal(latestPoint, 'profit_growth');
      const prevProfitYi = toYi(prevYearPoint, 'n_income_attr_p_ttm');
      const yoyProfitPct = profitYi != null && prevProfitYi != null && prevProfitYi !== 0
        ? ((profitYi - prevProfitYi) / Math.abs(prevProfitYi)) * 100
        : null;

      const scoreFromRange = (value: number | null, min: number, max: number): number | null => {
        if (value == null || !Number.isFinite(value)) return null;
        if (max <= min) return null;
        const ratio = (value - min) / (max - min);
        return clamp(ratio * 100, 0, 100);
      };
      const scoreFromInverseRange = (value: number | null, min: number, max: number): number | null => {
        if (value == null || !Number.isFinite(value)) return null;
        return 100 - (scoreFromRange(value, min, max) ?? 50);
      };
      const avgScore = (arr: Array<number | null>, fallback = 50): number => {
        const vals = arr.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        if (!vals.length) return fallback;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      };

      // 利润表信号
      const profitSignal = avgScore([
        scoreFromRange(revenueGrowthPct, -10, 30),
        scoreFromRange(grossMarginPct, 10, 50),
        scoreFromInverseRange(feeRatePct, 8, 35),
        scoreFromRange(netMarginPct, 3, 20),
      ]);

      // 资产负债表信号（使用可得的领先项）
      const contractLiabYi = (parseNum((balanceSource as any)?.contract_liab) ?? NaN) / 1e8;
      const receivYi = (parseNum((balanceSource as any)?.accounts_receiv) ?? NaN) / 1e8;
      const inventoryYi = (parseNum((balanceSource as any)?.inventories) ?? NaN) / 1e8;
      const payablesYi = (parseNum((balanceSource as any)?.accounts_pay) ?? NaN) / 1e8;
      const contractLiabRatioPct = revYi != null && revYi !== 0 && Number.isFinite(contractLiabYi) ? (contractLiabYi / revYi) * 100 : null;
      const receivRatioPct = revYi != null && revYi !== 0 && Number.isFinite(receivYi) ? (receivYi / revYi) * 100 : null;
      const inventoryRatioPct = revYi != null && revYi !== 0 && Number.isFinite(inventoryYi) ? (inventoryYi / revYi) * 100 : null;
      const payableCoveragePct = Number.isFinite(payablesYi) && Number.isFinite(inventoryYi) && inventoryYi > 0 ? (payablesYi / inventoryYi) * 100 : null;
      const balanceSignal = avgScore([
        scoreFromRange(contractLiabRatioPct, 2, 20),
        scoreFromInverseRange(receivRatioPct, 8, 45),
        scoreFromInverseRange(inventoryRatioPct, 8, 55),
        scoreFromRange(payableCoveragePct, 30, 100),
      ]);

      // 现金流信号（验证营收/利润含金量）
      const inflowCoveragePct = revYi != null && revYi !== 0 && opInYi != null ? (opInYi / revYi) * 100 : null;
      const cfoMarginPct = revYi != null && revYi !== 0 && opNetYi != null ? (opNetYi / revYi) * 100 : null;
      const profitCashRatioPct = profitYi != null && profitYi !== 0 && opNetYi != null ? (opNetYi / profitYi) * 100 : null;
      const cashflowSignal = avgScore([
        scoreFromRange(inflowCoveragePct, 70, 110),
        scoreFromRange(cfoMarginPct, 2, 18),
        scoreFromRange(profitCashRatioPct, 50, 150),
      ]);

      const overallScoreRaw = profitSignal * 0.5 + balanceSignal * 0.2 + cashflowSignal * 0.3;
      const overallScore = clamp(overallScoreRaw, 0, 100);

      const baseGrowthCandidates = [yoyProfitPct, revenueGrowthPct, profitGrowthPct5y].filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v)
      );
      const baseGrowth = baseGrowthCandidates.length
        ? baseGrowthCandidates.reduce((a, b) => a + b, 0) / baseGrowthCandidates.length
        : 8;

      const scoreAdjustGrowth = (overallScore - 50) * 0.5;
      const predictedGrowthPct = clamp(baseGrowth * 0.55 + scoreAdjustGrowth, -35, 45);
      const predictedProfitYi = profitYi != null ? profitYi * (1 + predictedGrowthPct / 100) : null;

      charts.forecast_signal = {
        x: ['利润表', '资产负债', '现金流', '综合', '预测增速', '预测净利润'],
        series: [[
          profitSignal,
          balanceSignal,
          cashflowSignal,
          overallScore,
          predictedGrowthPct,
          predictedProfitYi ?? NaN,
        ]],
        labels: ['三表预测评分/结果'],
        latest: [
          `综合得分 ${fmt(overallScore, '')}`,
          `预测净利增速 ${fmt(predictedGrowthPct, '%')}`,
          `预测净利润 ${fmt(predictedProfitYi, '亿')}`,
        ],
        note: `${latestPeriod || '最近期'} · 利润+资产负债+现金流信号合成`,
      };
    }

    return { tsCode, loading: false, stockInfo, charts };
  } catch (e) {
    return { tsCode, loading: false, stockInfo: null, error: e instanceof Error ? e.message : '拉取失败', charts };
  }
}
