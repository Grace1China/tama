'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DataGrid, { type CSVData } from '../components/DataGrid';
import { formatDateYYMM } from '@/lib/dateFormat';
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
  | 'pb_valuation';

type ContrastRow = {
  tsCode: string;
  loading: boolean;
  error?: string;
  stockInfo: StockInfo | null;
  charts: Record<MetricKey, MetricChart>;
};

type ContrastGridRow = {
  stock_basic: ContrastRow;
} & Record<MetricKey, MetricChart>;

const COLORS = ['#2563eb', '#ef4444', '#16a34a', '#f59e0b', '#7c3aed', '#0ea5e9'];

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
];

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
  const m2 = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m2) return Number(`${m2[1]}${String(m2[2]).padStart(2, '0')}${String(m2[3]).padStart(2, '0')}`);
  const dt = new Date(raw.replace(/-/g, '/'));
  if (Number.isNaN(dt.getTime())) return NaN;
  const y = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return Number(`${y}${mm}${dd}`);
}

function pickSeries(values: Array<number | null | undefined>, maxPoints = 24): number[] {
  const filtered = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (filtered.length <= maxPoints) return filtered;
  const picked: number[] = [];
  const step = (filtered.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    picked.push(filtered[Math.round(i * step)]);
  }
  return picked;
}

function sampleWithLabels(values: number[], labels: string[], maxPoints = 24): { values: number[]; labels: string[] } {
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
    growth_summary: emptyChart(),
    growth_trend: emptyChart(),
    balance_structure: emptyChart(),
    biz_comp: emptyChart(),
    ps_valuation: emptyChart(),
    pe_valuation: emptyChart(),
    pb_valuation: emptyChart(),
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

function IncomeChartCell({ chart, metricKey }: { chart: MetricChart; metricKey: MetricKey }) {
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
    metricKey === 'growth_trend';
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
          const suffix = /CAGR|毛利率|%/.test(p.name) ? '%' : '亿';
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
              {p.name}: {Number.isFinite(n) ? `${n.toFixed(2)}${suffix}` : '—'}
            </div>
          );
        })}
      </div>
    );
  };
  const formatYi = (v: any) => `${Number(v).toFixed(0)}亿`;
  const formatPct = (v: any) => `${Number(v).toFixed(0)}%`;

  if (metricKey === 'rev_mv') {
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10 }}
              width={52}
              tickFormatter={formatYi}
              label={{ value: '市值(亿)', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }}
            />
            <YAxis
              yAxisId="right"
              tick={{ fontSize: 10 }}
              width={52}
              orientation="right"
              tickFormatter={formatYi}
              label={{ value: '营收/利润(亿)', angle: 90, position: 'insideRight', style: { fontSize: 10 } }}
            />
            <Tooltip content={compactTooltip} />
            <Bar yAxisId="right" dataKey="s0" barSize={10} fill="#3b82f6" name={chart.labels[0] ?? 'TTM营收(亿)'} />
            <Bar yAxisId="right" dataKey="s1" barSize={10} fill="#ef4444" name={chart.labels[1] ?? 'TTM归母净利润(亿)'} />
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

  if (metricKey === 'biz_comp' || metricKey === 'ps_valuation' || metricKey === 'pe_valuation' || metricKey === 'pb_valuation') {
    const stats = calcMeanStd(chart.series[0] ?? []);
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fontSize: 10 }}
              width={44}
              tickFormatter={
                metricKey === 'ps_valuation' || metricKey === 'pe_valuation' || metricKey === 'pb_valuation'
                  ? (v: any) => Number(v).toFixed(1)
                  : formatYi
              }
            />
            <Tooltip content={compactTooltip} />
            {chart.series.map((_, idx) => (
              <Line
                key={idx}
                type="monotone"
                dataKey={`s${idx}`}
                stroke={COLORS[idx % COLORS.length]}
                strokeWidth={2}
                dot={false}
                name={chart.labels[idx] ?? `S${idx + 1}`}
              />
            ))}
            {(metricKey === 'ps_valuation' || metricKey === 'pe_valuation' || metricKey === 'pb_valuation') && stats && (
              <>
                <Line type="monotone" dataKey={() => stats.mean} stroke="#facc15" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey={() => stats.mean + stats.std} stroke="#ef4444" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey={() => stats.mean - stats.std} stroke="#111827" strokeWidth={2} dot={false} />
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
            <Bar yAxisId="left" dataKey="s0" fill="#38bdf8" name={chart.labels[0] ?? '营收TTM(亿)'} />
            <Bar yAxisId="left" dataKey="s1" fill="#f97316" name={chart.labels[1] ?? '成本TTM(亿)'} />
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
            <Bar yAxisId="left" dataKey="s0" fill="#38bdf8" name={chart.labels[0] ?? '营收TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s1" stroke="#fb923c" strokeWidth={2} dot={false} name={chart.labels[1] ?? '销售费TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#94a3b8" strokeWidth={2} dot={false} name={chart.labels[2] ?? '管理费TTM(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s3" stroke="#f43f5e" strokeWidth={2.5} dot={false} name={chart.labels[3] ?? '研发费TTM(亿)'} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metricKey === 'growth_summary' || metricKey === 'balance_structure') {
    const bars = (chart.series[0] ?? []).map((v, idx) => ({ idx: chart.x[idx] ?? chart.labels[idx] ?? String(idx + 1), value: v }));
    return (
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 6, right: 8, left: 0, bottom: 14 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="idx" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={40} />
            <YAxis
              tick={{ fontSize: 10 }}
              width={44}
              tickFormatter={metricKey === 'growth_summary' ? formatPct : formatYi}
            />
            <Tooltip content={compactTooltip} />
            <Bar dataKey="value" name={chart.labels[0] ?? '数值'}>
              {bars.map((_, idx) => (
                <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
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
            <Bar yAxisId="left" dataKey="s0" fill="#94a3b8" name={chart.labels[0] ?? '总市值(亿)'} />
            <Bar yAxisId="left" dataKey="s1" fill="#3b82f6" name={chart.labels[1] ?? '营收TTM(亿)'} />
            <Bar yAxisId="left" dataKey="s2" fill="#ef4444" name={chart.labels[2] ?? '归母净利润TTM(亿)'} />
            <Bar yAxisId="left" dataKey="s3" fill="#22c55e" name={chart.labels[3] ?? '归母所有者权益(亿)'} />
            <Line yAxisId="right" type="monotone" dataKey="s4" stroke="#cbd5e1" strokeWidth={2} dot={false} name={chart.labels[4] ?? '市值5年CAGR'} />
            <Line yAxisId="right" type="monotone" dataKey="s5" stroke="#60a5fa" strokeWidth={2} dot={false} name={chart.labels[5] ?? '营收5年CAGR'} />
            <Line yAxisId="right" type="monotone" dataKey="s6" stroke="#fb7185" strokeWidth={2.5} dot={false} name={chart.labels[6] ?? '利润5年CAGR'} />
            <Line yAxisId="right" type="monotone" dataKey="s7" stroke="#34d399" strokeWidth={2} dot={false} name={chart.labels[7] ?? '净资产5年CAGR'} />
          </ComposedChart>
        </ResponsiveContainer>
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
          <Bar yAxisId="left" dataKey="s0" fill="#38bdf8" name={chart.labels[0] ?? 'S1'} />
          {chart.series[1] && <Line yAxisId="left" type="monotone" dataKey="s1" stroke="#f97316" strokeWidth={2} dot={false} name={chart.labels[1] ?? 'S2'} />}
          {chart.series[2] && <Line yAxisId="right" type="monotone" dataKey="s2" stroke="#f8fafc" strokeWidth={2} dot={false} name={chart.labels[2] ?? 'S3'} />}
          {chart.series[3] && <Line yAxisId="right" type="monotone" dataKey="s3" stroke="#ef4444" strokeWidth={2} dot={false} name={chart.labels[3] ?? 'S4'} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function IncomeContrastPage() {
  const [inputText, setInputText] = useState('603983.SH, 600519.SH');
  const [codes, setCodes] = useState<string[]>([]);
  const [rows, setRows] = useState<ContrastRow[]>([]);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  const progressText = useMemo(() => {
    if (!codes.length) return '未开始';
    if (!running) return `完成 ${doneCount}/${codes.length}`;
    return `加载中 ${doneCount}/${codes.length}`;
  }, [codes.length, doneCount, running]);

  const columnOrder = useMemo(
    () => ['stock_basic', ...METRIC_COLUMNS.map((c) => c.key)],
    []
  );

  const contrastGridData = useMemo<CSVData>(() => {
    const headers = ['股票基本信息', ...METRIC_COLUMNS.map((c) => c.label)];
    const data: ContrastGridRow[] = rows.map((row) => {
      const metricData = Object.fromEntries(
        METRIC_COLUMNS.map((c) => [c.key, row.charts[c.key]])
      ) as Record<MetricKey, MetricChart>;
      return {
        stock_basic: row,
        ...metricData,
      };
    });
    return {
      category: 'incomeContrast',
      filename: 'incomeContrast',
      headers,
      originalHeaders: columnOrder,
      data,
      totalRows: data.length,
    };
  }, [rows, columnOrder]);

  const cellRenderers = useMemo(() => {
    const stockRenderer = (params: any) => {
      const row = params?.value as ContrastRow | undefined;
      if (!row) return <div className="text-xs text-gray-400">—</div>;
      return (
        <div className="space-y-1 py-1">
          <div className="font-medium text-gray-900">{row.tsCode}</div>
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
        </div>
      );
    };

    const renderers: Record<string, (params: any) => any> = { stock_basic: stockRenderer };
    for (const c of METRIC_COLUMNS) {
      renderers[c.key] = (params: any) => {
        const chart = params?.value as MetricChart | undefined;
        return <IncomeChartCell metricKey={c.key} chart={chart ?? emptyChart()} />;
      };
    }
    return renderers;
  }, []);

  useEffect(() => {
    if (!codes.length) {
      setRows([]);
      setDoneCount(0);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setRunning(true);
      setDoneCount(0);
      setRows(
        codes.map((tsCode) => ({
          tsCode,
          loading: true,
          stockInfo: null,
          charts: emptyCharts(),
        }))
      );

      for (let i = 0; i < codes.length; i += 1) {
        const tsCode = codes[i];
        if (cancelled) break;
        const row = await buildContrastRow(tsCode);
        if (cancelled) break;
        setRows((prev) => prev.map((r) => (r.tsCode === tsCode ? row : r)));
        setDoneCount(i + 1);
      }
      if (!cancelled) setRunning(false);
    };
    run();
    return () => {
      cancelled = true;
      setRunning(false);
    };
  }, [codes]);

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
  };

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden space-y-4 p-4">
      <div className="w-full max-w-full  rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="text-base font-semibold text-gray-900">利润对比（incomeContrast）</h2>
        <p className="text-sm text-gray-600">
          在下方输入多个股票代码（逗号分隔），系统会按行依次拉取各接口数据并展示 11 个图形维度。
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
      </div>

      <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <DataGrid
          category="incomeContrast"
          tabId="incomeContrast_grid"
          title="利润对比"
          localData={contrastGridData}
          useServerPagination={false}
          columnOrder={columnOrder}
          fieldLabelMap={Object.fromEntries([
            ['stock_basic', '股票基本信息'],
            ...METRIC_COLUMNS.map((c) => [c.key, c.label]),
          ])}
          customCellRenderers={cellRenderers}
          rowHeight={240}
          gridHeight="72vh"
          uniformColumnWidth={360}
          pinnedLeftFields={['stock_basic']}
        />
      </div>
    </div>
  );
}

async function buildContrastRow(tsCode: string): Promise<ContrastRow> {
  const charts = emptyCharts();
  try {
    const [
      stockJson,
      incomeJson,
      dailyJson,
      cashflowJson,
      mainBizJson,
      costMarginJson,
      feeRevenueJson,
      growthSummaryJson,
      growthTrendJson,
      balanceJson,
    ] = await Promise.all([
      fetchJson(`/api/csv/stockList?ts_code=${encodeURIComponent(tsCode)}`),
      fetchJson(
        `/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_revenue_ttm,n_income_attr_p_ttm,total_mv&from=2014Q1&to=2025Q4`
      ),
      fetchJson(
        `/api/parq/daily_basic?ts_code=${encodeURIComponent(tsCode)}&page=1&size=1000000&sortField=trade_date&sortDir=asc&start_date=20140101`
      ),
      fetchJson(
         `/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_revenue_ttm,c_inf_fr_operate_a_ttm,n_income_attr_p_ttm,n_cashflow_act_ttm&from=2014Q1&to=2025Q4`
      ),
      fetchJson(
        `/api/parq/finaMainbzVip?ts_code=${encodeURIComponent(tsCode)}&page=1&size=1000000&sortField=end_date&sortDir=asc&start_date=20140101`
      ),
      fetchJson(
        `/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_revenue_ttm,oper_cost_ttm,grossMargin_ttm&from=2014Q1&to=2025Q3`
      ),
      fetchJson(
        `/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_revenue_ttm,sell_exp_ttm,admin_exp_ttm,rd_exp_ttm&from=2014Q1&to=2025Q3`
      ),
      fetchJson(
        `/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=mv_growth,revenue_growth,profit_growth,net_assets_growth&years=5`
      ),
      fetchJson(
        `/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_mv,total_revenue_ttm,n_income_attr_p_ttm,total_hldr_eqy_exc_min_int,mv_growth,revenue_growth,profit_growth,net_assets_growth&years=5&from=2014Q1&to=2025Q3`
      ),
      fetchJson(
        `/api/metrics?stock=${encodeURIComponent(tsCode)}&metrics=total_cash,prepayment,accounts_receiv,inventories,oth_cur_assets,lt_eqt_invest,fix_assets,intan_assets,oth_nca,st_borr,accounts_pay,contract_liab,payroll_taxes_payable,oth_cur_liab,lt_borr,oth_ncl`
      ),
    ]);

    const stockRow = Array.isArray(stockJson?.data) ? stockJson.data[0] : null;
    const stockInfo: StockInfo | null = stockRow
      ? {
          name: String(stockRow?.name ?? '').trim() || '—',
          area: String(stockRow?.area ?? '').trim() || '—',
          industry: String(stockRow?.industry ?? '').trim() || '—',
        }
      : null;

    const incomeRows = (Array.isArray(incomeJson?.points) ? incomeJson.points : [])
      .slice()
      .sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
    const dailyRows = (Array.isArray(dailyJson?.data) ? dailyJson.data : [])
      .slice()
      .sort((a: any, b: any) => parseDateNum(a?.trade_date) - parseDateNum(b?.trade_date));
    const cashflowRows = (Array.isArray(cashflowJson?.points) ? cashflowJson.points : [])
      .slice()
      .sort((a: any, b: any) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));
    const mainBizRows = (Array.isArray(mainBizJson?.data) ? mainBizJson.data : [])
      .slice()
      .sort((a: any, b: any) => parseDateNum(a?.end_date) - parseDateNum(b?.end_date));

    {
      type RevMvPt = { x: string; rev: number; profit: number; mv: number };
      const allPts: RevMvPt[] = incomeRows
        .map((r: any) => {
          const q = formatDateYYMM(r?.period);
          if (!q) return null;
          const rev = parseNum(r?.total_revenue_ttm);
          const profit = parseNum(r?.n_income_attr_p_ttm);
          const mv = parseNum(r?.total_mv);
          return {
            x: q,
            rev: rev == null ? NaN : rev / 1e8,
            profit: profit == null ? NaN : profit / 1e8,
            mv: mv == null ? NaN : mv / 1e4,
          };
        })
        .filter((p: RevMvPt | null): p is RevMvPt => p != null);

      const maxPts = 24;
      const sampled = allPts.length <= maxPts
        ? allPts
        : Array.from({ length: maxPts }, (_, i) => allPts[Math.round(i * (allPts.length - 1) / (maxPts - 1))]);

      charts.rev_mv = {
        x: sampled.map((p) => p.x),
        series: [
          sampled.map((p) => p.rev),
          sampled.map((p) => p.profit),
          sampled.map((p) => p.mv),
        ],
        labels: ['TTM营收(亿)', 'TTM归母净利润(亿)', '总市值(亿)'],
        latest: [
          fmt(sampled.filter((p) => Number.isFinite(p.rev)).at(-1)?.rev ?? null, '亿'),
          fmt(sampled.filter((p) => Number.isFinite(p.profit)).at(-1)?.profit ?? null, '亿'),
          fmt(sampled.filter((p) => Number.isFinite(p.mv)).at(-1)?.mv ?? null, '亿'),
        ],
      };
    }

    charts.rev_cashflow = {
      x: sampleWithLabels(
        cashflowRows.map((r: any) => (parseNum(r?.total_revenue_ttm) == null ? NaN : Number(r.total_revenue_ttm))),
        cashflowRows.map((r: any) => formatDateYYMM(r?.period))
      ).labels,
      series: [
        pickSeries(cashflowRows.map((r: any) => {
          const n = parseNum(r?.total_revenue_ttm);
          return n == null ? null : n / 1e8;
        })),
        pickSeries(cashflowRows.map((r: any) => {
          const n = parseNum(r?.c_inf_fr_operate_a_ttm);
          return n == null ? null : n / 1e8;
        })),
        pickSeries(cashflowRows.map((r: any) => {
          const n = parseNum(r?.n_income_attr_p_ttm);
          return n == null ? null : n / 1e8;
        })),
        pickSeries(cashflowRows.map((r: any) => {
          const n = parseNum(r?.n_cashflow_act_ttm);
          return n == null ? null : n / 1e8;
        })),
      ],
      labels: ['营收TTM(亿)', '经营现金流TTM(亿)', '净利润TTM(亿)', '经营现金流净额TTM(亿)'],
      latest: [
        fmt(parseNum(cashflowRows.at(-1)?.total_revenue_ttm) != null ? (parseNum(cashflowRows.at(-1)?.total_revenue_ttm) as number) / 1e8 : null, '亿'),
        fmt(parseNum(cashflowRows.at(-1)?.c_inf_fr_operate_a_ttm) != null ? (parseNum(cashflowRows.at(-1)?.c_inf_fr_operate_a_ttm) as number) / 1e8 : null, '亿'),
        fmt(parseNum(cashflowRows.at(-1)?.n_income_attr_p_ttm) != null ? (parseNum(cashflowRows.at(-1)?.n_income_attr_p_ttm) as number) / 1e8 : null, '亿'),
        fmt(parseNum(cashflowRows.at(-1)?.n_cashflow_act_ttm) != null ? (parseNum(cashflowRows.at(-1)?.n_cashflow_act_ttm) as number) / 1e8 : null, '亿'),
      ],
    };

    const costPoints = Array.isArray(costMarginJson?.points) ? costMarginJson.points : [];
    charts.cost_margin = {
      x: sampleWithLabels(
        costPoints.map((p: any) => (parseNum(p?.total_revenue_ttm) == null ? NaN : Number(p.total_revenue_ttm))),
        costPoints.map((p: any) => formatDateYYMM(p?.period))
      ).labels,
      series: [
        pickSeries(costPoints.map((p: any) => {
          const n = parseNum(p?.total_revenue_ttm);
          return n == null ? null : n / 1e8;
        })),
        pickSeries(costPoints.map((p: any) => {
          const n = parseNum(p?.oper_cost_ttm);
          return n == null ? null : n / 1e8;
        })),
        pickSeries(costPoints.map((p: any) => {
          const n = parseNum(p?.grossMargin_ttm);
          return n == null ? null : n * 100;
        })),
      ],
      labels: ['营收TTM(亿)', '成本TTM(亿)', '毛利率TTM(%)'],
      latest: [
        fmt(parseNum(costPoints.at(-1)?.total_revenue_ttm) != null ? (parseNum(costPoints.at(-1)?.total_revenue_ttm) as number) / 1e8 : null, '亿'),
        fmt(parseNum(costPoints.at(-1)?.oper_cost_ttm) != null ? (parseNum(costPoints.at(-1)?.oper_cost_ttm) as number) / 1e8 : null, '亿'),
        fmt(parseNum(costPoints.at(-1)?.grossMargin_ttm) != null ? (parseNum(costPoints.at(-1)?.grossMargin_ttm) as number) * 100 : null, '%'),
      ],
    };

    const feePoints = Array.isArray(feeRevenueJson?.points) ? feeRevenueJson.points : [];
    charts.fee_revenue = {
      x: sampleWithLabels(
        feePoints.map((p: any) => (parseNum(p?.total_revenue_ttm) == null ? NaN : Number(p.total_revenue_ttm))),
        feePoints.map((p: any) => formatDateYYMM(p?.period))
      ).labels,
      series: [
        pickSeries(feePoints.map((p: any) => {
          const n = parseNum(p?.total_revenue_ttm);
          return n == null ? null : n / 1e8;
        })),
        pickSeries(feePoints.map((p: any) => {
          const n = parseNum(p?.sell_exp_ttm);
          return n == null ? null : n / 1e8;
        })),
        pickSeries(feePoints.map((p: any) => {
          const n = parseNum(p?.admin_exp_ttm);
          return n == null ? null : n / 1e8;
        })),
        pickSeries(feePoints.map((p: any) => {
          const n = parseNum(p?.rd_exp_ttm);
          return n == null ? null : n / 1e8;
        })),
      ],
      labels: ['营收TTM(亿)', '销售费TTM(亿)', '管理费TTM(亿)', '研发费TTM(亿)'],
      latest: [
        fmt(parseNum(feePoints.at(-1)?.total_revenue_ttm) != null ? (parseNum(feePoints.at(-1)?.total_revenue_ttm) as number) / 1e8 : null, '亿'),
        fmt(parseNum(feePoints.at(-1)?.sell_exp_ttm) != null ? (parseNum(feePoints.at(-1)?.sell_exp_ttm) as number) / 1e8 : null, '亿'),
        fmt(parseNum(feePoints.at(-1)?.admin_exp_ttm) != null ? (parseNum(feePoints.at(-1)?.admin_exp_ttm) as number) / 1e8 : null, '亿'),
        fmt(parseNum(feePoints.at(-1)?.rd_exp_ttm) != null ? (parseNum(feePoints.at(-1)?.rd_exp_ttm) as number) / 1e8 : null, '亿'),
      ],
    };

    const growthResults = growthSummaryJson?.results ?? {};
    const growthValues = ['mv_growth', 'revenue_growth', 'profit_growth', 'net_assets_growth'].map(
      (k) => parseNum(growthResults?.[k]?.value) ?? 0
    );
    charts.growth_summary = {
      x: ['市值', '营收', '利润', '净资产'],
      series: [growthValues],
      labels: ['市值/营收/利润/净资产 CAGR(%)'],
      latest: [growthValues.map((v) => fmt(v, '%')).join(' | ')],
    };

    const trendPoints = Array.isArray(growthTrendJson?.points) ? growthTrendJson.points : [];
    {
      const toYi = (p: any, k: string) => {
        const n = parseNum(p?.[k]);
        if (n == null) return null;
        return k === 'total_mv' ? n / 1e4 : n / 1e8;
      };
      const sampled = sampleWithLabels(
        trendPoints.map((p: any) => (parseNum(p?.mv_growth) == null ? NaN : Number(p.mv_growth))),
        trendPoints.map((p: any) => formatDateYYMM(p?.period))
      );
      charts.growth_trend = {
        x: sampled.labels,
        series: [
          pickSeries(trendPoints.map((p: any) => toYi(p, 'total_mv'))),
          pickSeries(trendPoints.map((p: any) => toYi(p, 'total_revenue_ttm'))),
          pickSeries(trendPoints.map((p: any) => toYi(p, 'n_income_attr_p_ttm'))),
          pickSeries(trendPoints.map((p: any) => toYi(p, 'total_hldr_eqy_exc_min_int'))),
          pickSeries(trendPoints.map((p: any) => parseNum(p?.mv_growth) ?? 0)),
          pickSeries(trendPoints.map((p: any) => parseNum(p?.revenue_growth) ?? 0)),
          pickSeries(trendPoints.map((p: any) => parseNum(p?.profit_growth) ?? 0)),
          pickSeries(trendPoints.map((p: any) => parseNum(p?.net_assets_growth) ?? 0)),
        ],
        labels: [
          '总市值(亿)', '营收TTM(亿)', '归母净利润TTM(亿)', '归母所有者权益(亿)',
          '市值5年CAGR', '营收5年CAGR', '利润5年CAGR', '净资产5年CAGR',
        ],
        latest: [
          fmt(parseNum(trendPoints.at(-1)?.mv_growth), '%'),
          fmt(parseNum(trendPoints.at(-1)?.revenue_growth), '%'),
          fmt(parseNum(trendPoints.at(-1)?.profit_growth), '%'),
          fmt(parseNum(trendPoints.at(-1)?.net_assets_growth), '%'),
        ],
      };
    }

    const balanceResults = balanceJson?.results ?? {};
    const balanceKeys = [
      'total_cash',
      'prepayment',
      'accounts_receiv',
      'inventories',
      'oth_cur_assets',
      'lt_eqt_invest',
      'fix_assets',
      'intan_assets',
      'oth_nca',
      'st_borr',
      'accounts_pay',
      'contract_liab',
      'payroll_taxes_payable',
      'oth_cur_liab',
      'lt_borr',
      'oth_ncl',
    ];
    const balanceVals = balanceKeys.map((k) => (parseNum(balanceResults?.[k]?.value) ?? 0) / 1e8);
    charts.balance_structure = {
      x: ['现', '预', '应', '存', '他流', '长投', '固资', '无形', '非流', '短借', '应付', '合同', '薪税', '他流负', '长借', '长负'],
      series: [balanceVals],
      labels: ['资产负债结构(亿)'],
      latest: [fmt(balanceVals.reduce((acc, v) => acc + v, 0), '亿(合计)')],
    };

    const latestDateNum = Math.max(
      ...mainBizRows.map((r: any) => parseDateNum(r?.end_date)).filter((n: number) => Number.isFinite(n)),
      -Infinity
    );
    const latestDateRows = mainBizRows.filter((r: any) => parseDateNum(r?.end_date) === latestDateNum);
    const topItems: string[] = latestDateRows
      .map((r: any) => ({
        item: String(r?.bz_item ?? ''),
        sales: parseNum(r?.bz_sales) ?? 0,
      }))
      .sort((a: any, b: any) => b.sales - a.sales)
      .slice(0, 4)
      .map((x: any) => x.item)
      .filter(Boolean);

    const byDate = new Map<string, Record<string, number>>();
    for (const row of mainBizRows) {
      const d = String(row?.end_date ?? '').trim();
      const item = String(row?.bz_item ?? '').trim();
      const sales = parseNum(row?.bz_sales);
      if (!d || !item || sales == null) continue;
      if (!byDate.has(d)) byDate.set(d, {});
      const obj = byDate.get(d)!;
      obj[item] = (obj[item] ?? 0) + sales / 1e8;
    }
    const dates = [...byDate.keys()].sort((a, b) => parseDateNum(a) - parseDateNum(b));
    const bizSeries = topItems.map((item: string) => pickSeries(dates.map((d) => byDate.get(d)?.[item] ?? 0)));
    charts.biz_comp = {
      x: sampleWithLabels(
        dates.map((d) => parseDateNum(d)),
        dates.map((d) => formatDateYYMM(d))
      ).labels,
      series: bizSeries,
      labels: topItems.length ? topItems : ['主营业务'],
      latest: topItems.map((item: string) => {
        const val = dates.length ? byDate.get(dates[dates.length - 1])?.[item] ?? null : null;
        return fmt(val, '亿');
      }),
      note: topItems.length ? undefined : '暂无主营业务构成',
    };

    const psSeries = pickSeries(
      dailyRows.map((r: any) => {
        const ttm = parseNum(r?.ps_ttm);
        const ps = parseNum(r?.ps);
        return ttm ?? ps ?? null;
      })
    );
    const peSeries = pickSeries(
      dailyRows.map((r: any) => {
        const ttm = parseNum(r?.pe_ttm);
        const pe = parseNum(r?.pe);
        return ttm ?? pe ?? null;
      })
    );
    const pbSeries = pickSeries(dailyRows.map((r: any) => parseNum(r?.pb)));

    charts.ps_valuation = {
      x: sampleWithLabels(
        psSeries.map((v) => v),
        dailyRows.map((r: any) => formatDateYYMM(r?.trade_date)).filter(Boolean)
      ).labels,
      series: [psSeries],
      labels: ['PS/PS_TTM'],
      latest: [fmt(psSeries.length ? psSeries[psSeries.length - 1] : null)],
    };
    charts.pe_valuation = {
      x: sampleWithLabels(
        peSeries.map((v) => v),
        dailyRows.map((r: any) => formatDateYYMM(r?.trade_date)).filter(Boolean)
      ).labels,
      series: [peSeries],
      labels: ['PE/PE_TTM'],
      latest: [fmt(peSeries.length ? peSeries[peSeries.length - 1] : null)],
    };
    charts.pb_valuation = {
      x: sampleWithLabels(
        pbSeries.map((v) => v),
        dailyRows.map((r: any) => formatDateYYMM(r?.trade_date)).filter(Boolean)
      ).labels,
      series: [pbSeries],
      labels: ['PB'],
      latest: [fmt(pbSeries.length ? pbSeries[pbSeries.length - 1] : null)],
    };

    return {
      tsCode,
      loading: false,
      stockInfo,
      charts,
    };
  } catch (e) {
    return {
      tsCode,
      loading: false,
      stockInfo: null,
      error: e instanceof Error ? e.message : '拉取失败',
      charts,
    };
  }
}
