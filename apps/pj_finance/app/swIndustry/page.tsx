'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DataGrid, { type CSVData } from '../components/DataGrid';
import {
  SW_TREE_ROW_COLS,
  formatSwChgPct,
  swChgClass,
  useSwIndexPriceSnapshots,
} from '../lib/swIndexPriceSnapshots';
import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Line,
} from 'recharts';

type Level = 'L1' | 'L2' | 'L3';

type SwTreeNode = {
  indexCode: string;
  industryCode: string;
  parentCode: string;
  name: string;
  level: Level;
  memberCount: number;
  children: SwTreeNode[];
};

type ValuationRow = {
  ts_code: string;
  name: string;
  trade_date: string;
  close: number;
  pct_change: number;
  vol: number;
  amount: number;
  float_mv: number;
  total_mv: number;
  pe: number | null;
  pe_percentile: number | null;
  pb: number | null;
  pb_percentile: number | null;
};

type DailyPoint = {
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
  pe: number | null;
  pb: number | null;
};

type PePbStats = {
  mean: number;
  std: number;
  high: number;
  low: number;
};

type IndustryWithCharts = {
  ts_code: string;
  name: string;
  daily: DailyPoint[];
  pe_stats: PePbStats | null;
  pb_stats: PePbStats | null;
};

function nodeKey(node: SwTreeNode): string {
  return `${node.level}-${node.industryCode}-${node.indexCode}`;
}

const GRID_FIELDS = [
  'name', 'close', 'pct_change', 'vol', 'amount',
  'total_mv', 'pe', 'pe_percentile', 'pb', 'pb_percentile',
] as const;

const GRID_LABELS: Record<string, string> = {
  name: '行业指数名称',
  close: '最新收盘',
  pct_change: '涨跌幅(%)',
  vol: '成交量(手)',
  amount: '成交额',
  total_mv: '总市值(亿)',
  pe: 'PE',
  pe_percentile: 'PE历史分位(%)',
  pb: 'PB',
  pb_percentile: 'PB历史分位(%)',
};

function percentileColor(pct: number | null): { bg: string; text: string } {
  if (pct == null) return { bg: '#f9fafb', text: '#9ca3af' };
  if (pct < 30) return { bg: '#dcfce7', text: '#166534' };
  if (pct > 70) return { bg: '#fee2e2', text: '#991b1b' };
  return { bg: '#f9fafb', text: '#6b7280' };
}

/** Format YYYYMMDD -> YY/MM */
function shortDate(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd;
  return `${ymd.slice(2, 4)}/${ymd.slice(4, 6)}`;
}

function fullDate(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd;
  return `${ymd.slice(0, 4)}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
}

/** Mini candlestick chart. Mode: global=filter by dates, own=filter by % slider. */
function MiniKLine({ data, height, resetKey, onOwnChange, useGlobal, globalStart, globalEnd }: {
  data: DailyPoint[]; height: number; resetKey: number; onOwnChange?: () => void;
  useGlobal: boolean; globalStart: string; globalEnd: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);

  const sliderH = 22;
  const chartH = height - sliderH;

  // Data filtered by global date range
  const dateFiltered = useMemo(() => {
    if (!useGlobal || (!globalStart && !globalEnd)) return data;
    return data.filter((d) => {
      const td = String(d.trade_date ?? '');
      if (globalStart && td < globalStart) return false;
      if (globalEnd && td > globalEnd) return false;
      return true;
    });
  }, [data, useGlobal, globalStart, globalEnd]);

  const sliderLen = Math.max(dateFiltered.length, 1);
  const toPct = (idx: number) => (idx / Math.max(sliderLen - 1, 1)) * 100;

  const [ownRange, setOwnRange] = useState({ start: 0, end: Math.max(dateFiltered.length - 1, 0) });
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  // Reset own slider when global slider moves
  useEffect(() => {
    setOwnRange({ start: 0, end: Math.max(dateFiltered.length - 1, 0) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, dateFiltered]);

  // When in global mode, use full range; in own mode, use own slider
  const filtered = useMemo(() => {
    if (dateFiltered.length === 0) return [];
    if (useGlobal) return dateFiltered; // global mode: show all date-filtered data
    return dateFiltered.slice(ownRange.start, ownRange.end + 1); // own mode: apply % slider
  }, [dateFiltered, useGlobal, ownRange]);

  // Hover state for tooltip
  const [hoverInfo, setHoverInfo] = useState<{ idx: number; d: DailyPoint; x: number } | null>(null);

  // Container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Draw candlestick canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || filtered.length < 2 || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = chartH * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const pad = { top: 6, right: 6, bottom: 20, left: 42 };
    const plotW = width - pad.left - pad.right;
    const plotH = chartH - pad.top - pad.bottom;

    const allHigh = filtered.reduce((m, d) => Math.max(m, d.high), -Infinity);
    const allLow = filtered.reduce((m, d) => Math.min(m, d.low), Infinity);
    const range = allHigh - allLow || 1;
    const yScale = (v: number) => pad.top + plotH * (1 - (v - allLow) / range);

    ctx.clearRect(0, 0, width, chartH);

    // Grid lines
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      const val = allHigh - (range * i) / 4;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1), pad.left - 3, y + 3);
    }

    // Candlesticks
    const candleW = Math.max(1, Math.min(8, plotW / filtered.length - 1));
    const gap = (plotW - candleW * filtered.length) / (filtered.length + 1);
    const candlePositions: number[] = [];

    for (let i = 0; i < filtered.length; i++) {
      const d = filtered[i];
      const cx = pad.left + gap + i * (candleW + gap) + candleW / 2;
      candlePositions.push(cx);
      const bodyTop = yScale(Math.max(d.open, d.close));
      const bodyBot = yScale(Math.min(d.open, d.close));
      const wickTop = yScale(d.high);
      const wickBot = yScale(d.low);

      const isGreen = d.close >= d.open;
      ctx.strokeStyle = isGreen ? '#dc2626' : '#16a34a';
      ctx.fillStyle = isGreen ? '#dc2626' : '#16a34a';

      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, wickTop);
      ctx.lineTo(cx, wickBot);
      ctx.stroke();

      const bodyH = Math.max(1, bodyBot - bodyTop);
      ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyH);
    }

    // Date labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor(filtered.length / 6));
    for (let i = 0; i < filtered.length; i += step) {
      const d = filtered[i];
      const x = pad.left + gap + i * (candleW + gap) + candleW / 2;
      ctx.fillText(shortDate(d.trade_date), x, chartH - 3);
    }

    // Store positions for hover detection
    canvasRef.current && ((canvasRef.current as any)._candlePositions = candlePositions);
  }, [filtered, width, chartH]);

  const onCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const positions: number[] = (canvas as any)._candlePositions ?? [];
    if (!positions.length) return;
    let best = 0; let bestDist = Infinity;
    for (let i = 0; i < positions.length; i++) {
      const d = Math.abs(mx - positions[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best < filtered.length) {
      setHoverInfo({ idx: best, d: filtered[best], x: positions[best] });
    }
  }, [filtered]);

  const onCanvasMouseLeave = useCallback(() => setHoverInfo(null), []);

  // Own slider drag
  const fromPct = (pct: number) => Math.round((pct / 100) * Math.max(sliderLen - 1, 0));

  const onSliderMouseDown = (which: 'start' | 'end') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOwnChange?.(); // clear global
    setDragging(which);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = sliderRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const idx = fromPct(pct);
      setOwnRange((prev) => {
        if (dragging === 'start' && idx < prev.end) return { ...prev, start: idx };
        if (dragging === 'end' && idx > prev.start) return { ...prev, end: idx };
        return prev;
      });
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, fromPct]);

  if (data.length < 2) return <div className="text-xs text-gray-400 flex items-center justify-center h-full">数据不足</div>;
  if (dateFiltered.length === 0) return <div className="text-xs text-gray-400 flex items-center justify-center h-full">该时间范围内无数据</div>;

  const ownStartD = dateFiltered[ownRange.start];
  const ownEndD = dateFiltered[ownRange.end];
  const startLabel = ownStartD ? shortDate(String(ownStartD.trade_date ?? '')) : '';
  const endLabel = ownEndD ? shortDate(String(ownEndD.trade_date ?? '')) : '';
  const fmtVol = (v: number) => v >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(1)}万` : `${v}`;

  return (
    <div ref={containerRef} style={{ width: '100%', height, position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: chartH }} onMouseMove={onCanvasMouseMove} onMouseLeave={onCanvasMouseLeave} />
      {/* Tooltip */}
      {hoverInfo && (
        <div
          className="absolute z-50 bg-white border border-gray-300 rounded shadow px-2 py-1 text-[10px] leading-relaxed pointer-events-none whitespace-nowrap"
          style={{ left: Math.min(hoverInfo.x + 8, width - 120), top: 4 }}
        >
          <div className="font-semibold text-gray-800">{fullDate(hoverInfo.d.trade_date)}</div>
          <div>开 {hoverInfo.d.open.toFixed(2)} 高 {hoverInfo.d.high.toFixed(2)}</div>
          <div>低 {hoverInfo.d.low.toFixed(2)} 收 {hoverInfo.d.close.toFixed(2)}</div>
          <div className={hoverInfo.d.close >= hoverInfo.d.open ? 'text-red-500' : 'text-green-600'}>
            涨跌 {((hoverInfo.d.close - hoverInfo.d.open) / hoverInfo.d.open * 100).toFixed(2)}%
          </div>
          <div className="text-gray-500">成交量 {fmtVol(hoverInfo.d.vol)}</div>
        </div>
      )}
      {/* Own range slider */}
      <div
        ref={sliderRef}
        className="relative flex items-center select-none"
        style={{ height: sliderH, paddingLeft: 42, paddingRight: 6 }}
      >
        <div className="absolute left-[42px] right-[6px] h-1.5 bg-gray-200 rounded-full" />
        <div
          className="absolute h-1.5 bg-blue-400 rounded-full"
          style={{ left: `calc(${toPct(ownRange.start)}% * (100% - 48px) / 100% + 42px)`, width: `calc(${toPct(ownRange.end) - toPct(ownRange.start)}% * (100% - 48px) / 100%)` }}
        />
        <div
          className="absolute w-3 h-4 bg-white border-2 border-blue-500 rounded-sm cursor-ew-resize shadow z-10"
          style={{ left: `calc(${toPct(ownRange.start)}% * (100% - 48px) / 100% + 42px - 6px)` }}
          onMouseDown={onSliderMouseDown('start')}
        />
        <div
          className="absolute w-3 h-4 bg-white border-2 border-blue-500 rounded-sm cursor-ew-resize shadow z-10"
          style={{ left: `calc(${toPct(ownRange.end)}% * (100% - 48px) / 100% + 42px - 6px)` }}
          onMouseDown={onSliderMouseDown('end')}
        />
        <span className="absolute text-[9px] text-gray-400" style={{ left: 42, bottom: 1 }}>{startLabel}</span>
        <span className="absolute text-[9px] text-gray-400" style={{ right: 6, bottom: 1 }}>{endLabel}</span>
      </div>
    </div>
  );
}

/** PE/PB valuation chart with mean +/- 1σ bands (Recharts) */
function ValuationLineChart({
  data,
  valueKey,
  stats,
  color,
  label,
}: {
  data: DailyPoint[];
  valueKey: 'pe' | 'pb';
  stats: PePbStats | null;
  color: string;
  label: string;
}) {
  const chartData = useMemo(() => {
    const mean = stats?.mean ?? 0;
    const high = stats?.high ?? 0;
    const low = stats?.low ?? 0;
    return data
      .filter((d) => d[valueKey] != null && Number.isFinite(d[valueKey]))
      .map((d, i) => ({
        idx: i,
        date: shortDate(d.trade_date),
        value: d[valueKey] as number,
        mean,
        high,
        low,
      }));
  }, [data, valueKey, stats]);

  if (chartData.length < 2) {
    return <div className="text-xs text-gray-400 flex items-center justify-center h-full">暂无{label}数据</div>;
  }

  const fmtVal = (v: number) => v.toFixed(1);

  const valTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    return (
      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 3, padding: '3px 6px', fontSize: 10, lineHeight: '14px' }}>
        <div style={{ fontWeight: 600, marginBottom: 1 }}>{p?.date}</div>
        {payload.map((entry: any, i: number) => {
          const n = Number(entry.value);
          return (
            <div key={i} style={{ color: entry.color, whiteSpace: 'nowrap' }}>
              {entry.name}: {Number.isFinite(n) ? n.toFixed(2) : '—'}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="idx" tick={{ fontSize: 8 }} interval="preserveStartEnd" hide />
        <YAxis tick={{ fontSize: 9 }} width={38} tickFormatter={fmtVal} />
        <Tooltip content={valTooltip} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} name={label} connectNulls />
        {stats && (
          <>
            <Line type="monotone" dataKey="mean" stroke="#f59e0b" strokeWidth={1} dot={false} name="均值" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="high" stroke="#ef4444" strokeWidth={1} dot={false} name="高估线(均值+1σ)" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="low" stroke="#6b7280" strokeWidth={1} dot={false} name="低估线(均值-1σ)" strokeDasharray="2 2" />
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function SwIndustryPage() {
  const [swTree, setSwTree] = useState<SwTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<SwTreeNode | null>(null);
  const [treeFilter, setTreeFilter] = useState('');

  const [valuationRows, setValuationRows] = useState<ValuationRow[] | null>(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [valuationError, setValuationError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState('table');
  const [chartData, setChartData] = useState<IndustryWithCharts[] | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  // Global K-line date range — based on the longest timeline across all industries
  const [globalStartDate, setGlobalStartDate] = useState('');
  const [globalEndDate, setGlobalEndDate] = useState('');
  const [globalRangeDragging, setGlobalRangeDragging] = useState<'start' | 'end' | null>(null);
  const globalSliderRef = useRef<HTMLDivElement>(null);

  // Compute union date range from all chart data
  const { globalMinDate, globalMaxDate } = useMemo(() => {
    if (!chartData || chartData.length === 0) return { globalMinDate: '', globalMaxDate: '' };
    let minD = '', maxD = '';
    for (const ind of chartData) {
      if (ind.daily.length === 0) continue;
      const first = String(ind.daily[0].trade_date ?? '');
      const last = String(ind.daily[ind.daily.length - 1].trade_date ?? '');
      if (!minD || first < minD) minD = first;
      if (!maxD || last > maxD) maxD = last;
    }
    return { globalMinDate: minD, globalMaxDate: maxD };
  }, [chartData]);

  // Which control is active: 'global' = date slider, 'own' = per-chart % sliders
  const [activeFilter, setActiveFilter] = useState<'global' | 'own'>('global');
  // Reset key: incremented when global slider moves → resets all per-chart sliders
  const [chartResetKey, setChartResetKey] = useState(0);
  // When per-chart slider moves, switch to own mode and reset global to full range
  const onOwnSliderChange = useCallback(() => {
    setActiveFilter('own');
    if (globalMinDate && globalMaxDate) {
      setGlobalStartDate(globalMinDate);
      setGlobalEndDate(globalMaxDate);
    }
  }, [globalMinDate, globalMaxDate]);

  // Init global range when data loads
  useEffect(() => {
    if (globalMinDate && globalMaxDate) {
      setGlobalStartDate(globalMinDate);
      setGlobalEndDate(globalMaxDate);
    }
  }, [globalMinDate, globalMaxDate]);

  // Convert YYYYMMDD to day count for slider math
  const toDays = useCallback((ymd: string) => {
    if (!/^\d{8}$/.test(ymd)) return 0;
    const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(4, 6)) - 1, d = Number(ymd.slice(6, 8));
    return Math.floor(new Date(y, m, d).getTime() / 86400000);
  }, []);
  const fromDays = useCallback((days: number) => {
    const d = new Date(days * 86400000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }, []);

  const minDays = toDays(globalMinDate);
  const maxDays = toDays(globalMaxDate);
  const totalDays = Math.max(maxDays - minDays, 1);
  const dateToPct = useCallback((ymd: string) => ((toDays(ymd) - minDays) / totalDays) * 100, [toDays, minDays, totalDays]);
  const pctToDate = useCallback((pct: number) => fromDays(minDays + Math.round((pct / 100) * totalDays)), [fromDays, minDays, totalDays]);

  const [treePaneWidth, setTreePaneWidth] = useState(480);
  const { snapshots: swIndexSnapshots, loading: swIndexSnapshotsLoading, tradeDate: swIndexTradeDate } =
    useSwIndexPriceSnapshots();
  const dragSplitRef = useRef<{ startX: number; startW: number } | null>(null);

  // Track current query params for chart fetching
  const chartQueryRef = useRef<{ index_code?: string; level?: string }>({});

  // Load tree
  useEffect(() => {
    let cancelled = false;
    setTreeLoading(true);
    setTreeError(null);
    fetch('/api/parq/sw2021/tree')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        const tree = Array.isArray(json?.tree) ? (json.tree as SwTreeNode[]) : [];
        setSwTree(tree);
        if (tree.length > 0) {
          setExpandedNodes(new Set(tree.map((n) => nodeKey(n))));
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setTreeError(e instanceof Error ? e.message : '加载申万分类失败');
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Filter tree locally
  const filteredTree = useMemo(() => {
    const q = treeFilter.toLowerCase().trim();
    if (!q) return swTree;
    const walk = (nodes: SwTreeNode[]): SwTreeNode[] =>
      nodes
        .map((n) => {
          const children = walk(n.children ?? []);
          const matched =
            n.name.toLowerCase().includes(q) ||
            n.indexCode.toLowerCase().includes(q);
          if (matched || children.length > 0) return { ...n, children };
          return null;
        })
        .filter((n): n is SwTreeNode => n != null);
    return walk(swTree);
  }, [swTree, treeFilter]);

  // Fetch valuation on node select (always for table tab)
  const fetchValuation = useCallback(async (params: { index_code?: string; level?: string }) => {
    setValuationRows(null);
    setValuationError(null);
    setValuationLoading(true);
    try {
      const qs = new URLSearchParams();
      if (params.index_code) qs.set('index_code', params.index_code);
      else if (params.level) qs.set('level', params.level);
      const res = await fetch(`/api/parq/sw2021/valuation?${qs.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j?.error === 'string' ? j.error : `HTTP ${res.status}`);
      }
      const json = await res.json();
      setValuationRows(Array.isArray(json?.rows) ? json.rows : []);
    } catch (e) {
      setValuationError(e instanceof Error ? e.message : '加载估值数据失败');
    } finally {
      setValuationLoading(false);
    }
  }, []);

  // Fetch chart data
  const fetchChartData = useCallback(async (params: { index_code?: string; level?: string }) => {
    chartQueryRef.current = params;
    setChartData(null);
    setChartError(null);
    setChartLoading(true);
    try {
      const qs = new URLSearchParams();
      if (params.index_code) qs.set('index_code', params.index_code);
      else if (params.level) qs.set('level', params.level);
      const res = await fetch(`/api/parq/sw2021/chart-data?${qs.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j?.error === 'string' ? j.error : `HTTP ${res.status}`);
      }
      const json = await res.json();
      setChartData(Array.isArray(json?.industries) ? json.industries : []);
    } catch (e) {
      setChartError(e instanceof Error ? e.message : '加载图表数据失败');
    } finally {
      setChartLoading(false);
    }
  }, []);

  const onSelectNode = useCallback(async (node: SwTreeNode) => {
    setSelectedNode(node);
    const params = { index_code: node.indexCode };
    fetchValuation(params);
    if (activeTab === 'charts') fetchChartData(params);
  }, [fetchValuation, fetchChartData, activeTab]);

  const onLoadTopLevel = useCallback(async () => {
    setSelectedNode(null);
    const params = { level: 'L1' };
    fetchValuation(params);
    if (activeTab === 'charts') fetchChartData(params);
  }, [fetchValuation, fetchChartData, activeTab]);

  // When switching to charts tab, fetch if not yet loaded for current selection
  const onTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    if (tab === 'charts' && !chartData && !chartLoading) {
      fetchChartData(chartQueryRef.current);
    }
  }, [chartData, chartLoading, fetchChartData]);

  // Split pane drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragSplitRef.current) return;
      const dx = e.clientX - dragSplitRef.current.startX;
      const maxW = typeof window !== 'undefined' ? window.innerWidth * 0.55 : 800;
      setTreePaneWidth(Math.min(Math.max(dragSplitRef.current.startW + dx, 200), maxW));
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

  // Global K-line range slider drag
  useEffect(() => {
    if (!globalRangeDragging) return;
    const onMove = (e: MouseEvent) => {
      const el = globalSliderRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const date = pctToDate(pct);
      if (globalRangeDragging === 'start' && date < globalEndDate) { setGlobalStartDate(date); setChartResetKey((k) => k + 1); }
      if (globalRangeDragging === 'end' && date > globalStartDate) { setGlobalEndDate(date); setChartResetKey((k) => k + 1); }
    };
    const onUp = () => setGlobalRangeDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [globalRangeDragging, globalStartDate, globalEndDate, pctToDate]);

  // Build DataGrid data
  const displayGridData = useMemo<CSVData | null>(() => {
    if (!valuationRows || valuationRows.length === 0) return null;
    const data = valuationRows.map((row) => ({
      ...row,
      total_mv: row.total_mv != null && row.total_mv !== 0 ? row.total_mv / 10000 : row.total_mv,
      amount: row.amount != null && row.amount !== 0 ? row.amount / 10000 : row.amount,
    }));
    return {
      category: 'swIndustry',
      filename: 'swIndustry',
      headers: GRID_FIELDS.map((f) => GRID_LABELS[f] ?? f),
      originalHeaders: [...GRID_FIELDS],
      data,
      totalRows: data.length,
    };
  }, [valuationRows]);

  // Custom cell renderers for percentile columns
  const customCellRenderers = useMemo(() => {
    const pctRenderer = (params: any) => {
      const val = params.value;
      if (val == null || !Number.isFinite(Number(val))) {
        return <span className="text-gray-400 text-xs">-</span>;
      }
      const pct = Number(val);
      const c = percentileColor(pct);
      return (
        <div className="flex items-center justify-end h-full px-1">
          <span
            className="inline-block px-2 py-0.5 rounded text-xs font-medium"
            style={{ backgroundColor: c.bg, color: c.text }}
          >
            {pct.toFixed(1)}%
          </span>
        </div>
      );
    };
    const valRenderer = (params: any) => {
      const val = params.value;
      if (val == null || !Number.isFinite(Number(val))) {
        return <span className="text-gray-400 text-xs">-</span>;
      }
      return <span className="text-xs">{Number(val).toFixed(2)}</span>;
    };
    return {
      pe_percentile: pctRenderer,
      pb_percentile: pctRenderer,
      pe: valRenderer,
      pb: valRenderer,
    };
  }, []);

  // Chart grid CSVData for Tab 2
  const CHART_FIELDS = ['info', 'kline', 'pe_chart', 'pb_chart'] as const;
  const CHART_LABELS: Record<string, string> = {
    info: '基本信息', kline: 'K线 (OHLC)', pe_chart: 'PE估值', pb_chart: 'PB估值',
  };

  const displayChartGridData = useMemo<CSVData | null>(() => {
    if (!chartData || chartData.length === 0) return null;
    const data = chartData.map((ind) => ({
      info: ind,
      kline: ind,
      pe_chart: ind,
      pb_chart: ind,
      ts_code: ind.ts_code,
    }));
    return {
      category: 'swIndustryChart',
      filename: 'swIndustryChart',
      headers: CHART_FIELDS.map((f) => CHART_LABELS[f] ?? f),
      originalHeaders: [...CHART_FIELDS],
      data,
      totalRows: data.length,
    };
  }, [chartData]);

  const chartCellRenderers = useMemo(() => {
    const infoRenderer = (params: any) => {
      const ind = params?.value as IndustryWithCharts | undefined;
      if (!ind) return <span className="text-xs text-gray-400">-</span>;
      return (
        <div className="py-2">
          <div className="text-sm font-medium text-gray-800">{ind.name}</div>
          <div className="text-xs text-gray-500">{ind.ts_code}</div>
          {ind.pe_stats && (
            <div className="text-[11px] text-gray-400 mt-1">
              PE 均值 {ind.pe_stats.mean.toFixed(1)} σ {ind.pe_stats.std.toFixed(1)}
            </div>
          )}
          {ind.pb_stats && (
            <div className="text-[11px] text-gray-400">
              PB 均值 {ind.pb_stats.mean.toFixed(1)} σ {ind.pb_stats.std.toFixed(1)}
            </div>
          )}
        </div>
      );
    };
    const klineRenderer = (params: any) => {
      const ind = params?.value as IndustryWithCharts | undefined;
      if (!ind?.daily?.length) return <span className="text-xs text-gray-400">数据不足</span>;
      return (
        <div style={{ height: 195, width: '100%' }}>
          <MiniKLine data={ind.daily} height={195} resetKey={chartResetKey} onOwnChange={onOwnSliderChange} useGlobal={activeFilter === 'global'} globalStart={globalStartDate} globalEnd={globalEndDate} />
        </div>
      );
    };
    const peRenderer = (params: any) => {
      const ind = params?.value as IndustryWithCharts | undefined;
      if (!ind) return <span className="text-xs text-gray-400">-</span>;
      return (
        <div style={{ height: 195, width: '100%' }}>
          <ValuationLineChart data={ind.daily} valueKey="pe" stats={ind.pe_stats} color="#3b82f6" label="PE" />
        </div>
      );
    };
    const pbRenderer = (params: any) => {
      const ind = params?.value as IndustryWithCharts | undefined;
      if (!ind) return <span className="text-xs text-gray-400">-</span>;
      return (
        <div style={{ height: 195, width: '100%' }}>
          <ValuationLineChart data={ind.daily} valueKey="pb" stats={ind.pb_stats} color="#22c55e" label="PB" />
        </div>
      );
    };
    return {
      info: infoRenderer,
      kline: klineRenderer,
      pe_chart: peRenderer,
      pb_chart: pbRenderer,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartResetKey, onOwnSliderChange, activeFilter, globalStartDate, globalEndDate]);

  const selectedTitle = useMemo(() => {
    if (selectedNode) return `${selectedNode.name} (${selectedNode.level})`;
    if (valuationRows && !valuationLoading) return '全部一级行业';
    return '未选择分类';
  }, [selectedNode, valuationRows, valuationLoading]);

  const hasData = valuationRows || chartData;
  const isLoading = valuationLoading || chartLoading;

  // Tree renderer
  const renderNode = useCallback((node: SwTreeNode, depth = 0): React.ReactNode => {
    const key = nodeKey(node);
    const hasChildren = (node.children?.length ?? 0) > 0;
    const expanded = expandedNodes.has(key);
    const selected = selectedNode ? nodeKey(selectedNode) === key : false;
    const snap = swIndexSnapshots.get(String(node.indexCode ?? '').toUpperCase());
    const rets = snap?.returns;

    return (
      <div key={key}>
        <div
          className={`flex items-center gap-0 rounded px-0 py-0.5 text-sm ${
            selected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
          }`}
          style={{ paddingLeft: `${depth * 14}px` }}
        >
          <button
            type="button"
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
            className="h-5 w-5 shrink-0 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-40"
            aria-label={expanded ? '收起' : '展开'}
          >
            {hasChildren ? (expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="inline-block w-4" />}
          </button>
          <button
            type="button"
            onClick={() => { void onSelectNode(node); }}
            className={`min-w-0 flex-1 text-left px-1 ${SW_TREE_ROW_COLS}`}
            title={`${node.name} ${node.indexCode}`}
          >
            <span className="truncate font-medium">{node.name}</span>
            <span className="truncate text-[11px] text-gray-500">{node.indexCode}</span>
            <span className={`text-[11px] tabular-nums text-right ${swChgClass(rets?.d1)}`}>
              {formatSwChgPct(rets?.d1)}
            </span>
            <span className={`text-[11px] tabular-nums text-right ${swChgClass(rets?.d5)}`}>
              {formatSwChgPct(rets?.d5)}
            </span>
            <span className={`text-[11px] tabular-nums text-right ${swChgClass(rets?.d20)}`}>
              {formatSwChgPct(rets?.d20)}
            </span>
            <span className="text-[11px] text-gray-400 text-right tabular-nums">({node.memberCount})</span>
          </button>
        </div>
        {hasChildren && expanded && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  }, [expandedNodes, onSelectNode, selectedNode, swIndexSnapshots]);

  return (
    <div className="box-border flex h-[calc(100vh-3.5rem)] min-h-0 flex-col gap-3 overflow-hidden p-4">
      {/* Header */}
      <div className="shrink-0 rounded-lg border border-gray-200 bg-white p-4">
        <h1 className="text-lg font-semibold text-gray-900">申万行业分析</h1>
        <p className="mt-1 text-sm text-gray-500">
          左侧选择申万 L1/L2/L3 分类节点，右侧展示子行业的行情指标与 PE/PB 历史分位。分位越低估值越便宜（绿色），越高越贵（红色）。
        </p>
      </div>

      {/* Main split pane */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {/* Left tree panel */}
        <div
          className="flex min-h-0 shrink-0 flex-col self-stretch overflow-hidden border-r border-gray-100"
          style={{ width: treePaneWidth }}
        >
          <div className="shrink-0 border-b border-gray-100 px-3 py-2 space-y-2">
            <button
              type="button"
              onClick={() => { void onLoadTopLevel(); }}
              className="text-sm font-semibold text-gray-800 hover:text-blue-600 hover:underline transition-colors"
              title="点击查看全部一级行业"
            >
              申万行业分类
            </button>
            <Input
              value={treeFilter}
              onChange={(e) => setTreeFilter(e.target.value)}
              placeholder="搜索行业名称或代码..."
              className="text-sm"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
            {treeLoading && <div className="px-2 py-3 text-sm text-gray-500">加载中...</div>}
            {treeError && <div className="px-2 py-3 text-sm text-red-500">{treeError}</div>}
            {!treeLoading && !treeError && swTree.length === 0 && (
              <div className="px-2 py-3 text-sm text-gray-500">暂无行业分类数据</div>
            )}
            {!treeLoading && !treeError && filteredTree.length === 0 && (
              <div className="px-2 py-3 text-sm text-gray-500">无匹配结果</div>
            )}
            {!treeLoading && !treeError && filteredTree.length > 0 && (
              <>
                <div
                  className={`sticky top-0 z-10 mb-1 border-b border-gray-100 bg-white py-1 pl-5 pr-1 text-[10px] text-gray-500 ${SW_TREE_ROW_COLS}`}
                >
                  <span>名称</span>
                  <span>代码</span>
                  <span className="text-right">1D</span>
                  <span className="text-right">5D</span>
                  <span className="text-right">20D</span>
                  <span className="text-right">支数</span>
                </div>
                {swIndexSnapshotsLoading && (
                  <div className="px-2 pb-1 text-[10px] text-gray-400">加载指数涨跌幅...</div>
                )}
                {!swIndexSnapshotsLoading && swIndexTradeDate && (
                  <div className="px-2 pb-1 text-[10px] text-gray-400">行情截至 {swIndexTradeDate}</div>
                )}
                {filteredTree.map((n) => renderNode(n))}
              </>
            )}
          </div>
        </div>

        {/* Resizable divider */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整左右宽度"
          onMouseDown={startSplitDrag}
          className="w-1.5 shrink-0 cursor-col-resize bg-gray-100 hover:bg-sky-300 active:bg-sky-400 border-x border-gray-200 transition-colors"
        />

        {/* Right data panel */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
          <div className="shrink-0 border-b border-gray-100 px-4 py-3 text-sm text-gray-700">
            当前分类：<span className="font-medium text-gray-900">{selectedTitle}</span>
            {valuationRows && (
              <span className="ml-2 text-gray-400">({valuationRows.length} 个子行业)</span>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {!selectedNode && !valuationRows && !valuationLoading ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-gray-400">
                点击左侧"申万行业分类"查看全部一级行业，或选择具体分类节点。
              </div>
            ) : isLoading ? (
              <div className="flex flex-1 items-center justify-center px-6 text-sm text-gray-500">
                {valuationLoading ? '加载估值数据中...' : '加载图表数据中...'}
              </div>
            ) : valuationError ? (
              <div className="flex flex-1 items-center justify-center px-6 text-sm text-red-500">
                {valuationError}
              </div>
            ) : (
              <Tabs value={activeTab} onValueChange={onTabChange} className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="shrink-0 border-b border-gray-100 px-3 pt-2">
                  <TabsList>
                    <TabsTrigger value="table">当日数据</TabsTrigger>
                    <TabsTrigger value="charts">估值图表</TabsTrigger>
                  </TabsList>
                </div>

                {/* Global K-line date range slider (charts tab only) */}
                {activeTab === 'charts' && chartData && chartData.length > 0 && globalMinDate && globalMaxDate && (
                  <div className="shrink-0 border-b border-gray-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-500 shrink-0">全局范围:</span>
                      <span className="text-[10px] text-gray-400 shrink-0 w-[60px] text-right">{shortDate(globalStartDate)}</span>
                      <div
                        ref={globalSliderRef}
                        className="relative flex items-center flex-1 select-none"
                        style={{ height: 28, minWidth: 200 }}
                      >
                        <div className="absolute left-0 right-0 h-2 bg-gray-200 rounded-full" />
                        <div
                          className="absolute h-2 bg-blue-400 rounded-full"
                          style={{ left: `${dateToPct(globalStartDate)}%`, width: `${dateToPct(globalEndDate) - dateToPct(globalStartDate)}%` }}
                        />
                        <div
                          className="absolute w-3 h-5 bg-white border-2 border-blue-500 rounded-sm cursor-ew-resize shadow hover:border-blue-600 z-10"
                          style={{ left: `calc(${dateToPct(globalStartDate)}% - 6px)` }}
                          onMouseDown={(e) => { e.preventDefault(); setActiveFilter('global'); setGlobalRangeDragging('start'); }}
                        />
                        <div
                          className="absolute w-3 h-5 bg-white border-2 border-blue-500 rounded-sm cursor-ew-resize shadow hover:border-blue-600 z-10"
                          style={{ left: `calc(${dateToPct(globalEndDate)}% - 6px)` }}
                          onMouseDown={(e) => { e.preventDefault(); setActiveFilter('global'); setGlobalRangeDragging('end'); }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0 w-[60px]">{shortDate(globalEndDate)}</span>
                    </div>
                  </div>
                )}

                <div className="flex min-h-0 flex-1 overflow-hidden">
                  {activeTab === 'table' ? (
                    displayGridData ? (
                      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-auto p-3">
                        <DataGrid
                          category="swIndustry"
                          tabId="swIndustry_grid"
                          title="申万行业估值分析"
                          tightChrome
                          localData={displayGridData}
                          useServerPagination={false}
                          columnOrder={[...GRID_FIELDS]}
                          fieldLabelMap={GRID_LABELS}
                          customCellRenderers={customCellRenderers}
                          gridHeight="100%"
                          animateRows={false}
                          getRowId={(params: any) => params.data?.ts_code ?? String(params.rowIndex)}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                        该分类下无有效估值数据。
                      </div>
                    )
                  ) : chartError ? (
                    <div className="flex flex-1 items-center justify-center px-6 text-sm text-red-500">
                      {chartError}
                    </div>
                  ) : displayChartGridData ? (
                    <div className="flex min-h-0 min-w-0 flex-1 overflow-x-auto p-3">
                      <DataGrid
                        category="swIndustryChart"
                        tabId="swIndustryChart_grid"
                        title="申万行业估值图表"
                        tightChrome
                        localData={displayChartGridData}
                        useServerPagination={false}
                        columnOrder={[...CHART_FIELDS]}
                        fieldLabelMap={CHART_LABELS}
                        customCellRenderers={chartCellRenderers}
                        rowHeight={210}
                        gridHeight="100%"
                        uniformColumnWidth={340}
                        columnWidthByField={{ info: 180 }}
                        pinnedLeftFields={['info']}
                        cellStyleByField={{ kline: { overflow: 'visible' }, pe_chart: { overflow: 'visible' }, pb_chart: { overflow: 'visible' } }}
                        animateRows={false}
                        getRowId={(params: any) => params.data?.ts_code ?? String(params.rowIndex)}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                      暂无图表数据。
                    </div>
                  )}
                </div>
              </Tabs>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
