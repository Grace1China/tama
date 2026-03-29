'use client';

import { useState, useRef, useEffect } from 'react';
import DataGrid from '../components/DataGrid';
import PriceChart from '../components/PriceChart';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
  Bar,
} from 'recharts';

interface StockInfo {
  name: string;
  area: string;
  industry: string;
}

type ValuationPoint = {
  end_date?: string;
  trade_date?: string;
  ps_ttm: number | null;
  ps: number | null;
  pe_ttm?: number | null;
  pe?: number | null;
  pb?: number | null;
};

type MainBizRow = {
  end_date?: string;
  bz_item?: string;
  bz_sales?: number | string | null;
};

function useContainerWidth() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0]?.contentRect.width ?? 0));
    });
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  return { width, containerRef, mounted };
}

// 当选中"营收和现金流"页签时，DataGrid 默认隐藏的字段
const CASHFLOW_TAB_DEFAULT_HIDDEN = new Set([
  'report_type', 'comp_type', 'q_total_revenue', 'q_n_income', 'q_c_inf_fr_operate_a',
]);

function formatDateYYMM(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // support YYYYMMDD and YYYY-MM-DD
  if (/^\d{8}$/.test(raw)) {
    const dd = raw.slice(6, 8);
    return dd === '01'
      ? `${raw.slice(2, 4)}-${raw.slice(4, 6)}`
      : `${raw.slice(2, 4)}-${raw.slice(4, 6)}-${dd}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const dd = raw.slice(8, 10);
    return dd === '01'
      ? `${raw.slice(2, 4)}-${raw.slice(5, 7)}`
      : `${raw.slice(2, 4)}-${raw.slice(5, 7)}-${dd}`;
  }
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(raw)) {
    const parts = raw.split(/[\/\s]/).filter(Boolean);
    const yy = parts[0]?.slice(2, 4) ?? '';
    const mm = String(parts[1] ?? '').padStart(2, '0');
    if (yy && mm) return `${yy}-${mm}`;
  }
  return raw;
}

function calcMeanStd(values: number[]): { mean: number; std: number } | null {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

function normalizeDateToNumber(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  // YYYYMMDD
  if (/^\d{8}$/.test(raw)) return Number(raw);
  // YYYY-MM-DD...
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Number(`${m[1]}${m[2]}${m[3]}`);
  // YYYY/M/D...
  const s = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (s) {
    const mm = String(s[2]).padStart(2, '0');
    const dd = String(s[3]).padStart(2, '0');
    return Number(`${s[1]}${mm}${dd}`);
  }
  // fallback: try Date parsing
  const dt = new Date(raw.replace(/-/g, '/'));
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return Number(`${y}${mm}${dd}`);
  }
  const asNum = Number(raw);
  return Number.isFinite(asNum) ? asNum : NaN;
}

function quarterStartDates(minDateNum: number, maxDateNum: number, minDisplayDateNum: number): string[] {
  if (!Number.isFinite(minDateNum) || !Number.isFinite(maxDateNum)) return [];
  const minYear = Math.floor(minDateNum / 10000);
  const maxYear = Math.floor(maxDateNum / 10000);
  const dates: string[] = [];
  for (let year = minYear; year <= maxYear; year++) {
    for (const month of [1, 4, 7, 10]) {
      const d = `${year}${String(month).padStart(2, '0')}01`;
      const n = Number(d);
      if (Number.isFinite(n) && n >= minDisplayDateNum) dates.push(d);
    }
  }
  // ensure within actual max range (keep last quarterStart even if after max? trim)
  return dates.filter((d) => Number(d) <= maxDateNum);
}

function quarterEndDateNum(quarterStart: string): number {
  const y = Number(quarterStart.slice(0, 4));
  const m = Number(quarterStart.slice(4, 6));
  const endMonth = m + 2;
  const lastDay = new Date(y, endMonth, 0).getDate();
  return Number(`${y}${String(endMonth).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`);
}

/** 利润表接口返回的 end_date 可能为中文本地化，用于排序 */
function parseReportDateKey(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  const n = normalizeDateToNumber(raw);
  if (Number.isFinite(n)) return n;
  const zh = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
  if (zh) {
    return Number(`${zh[1]}${String(zh[2]).padStart(2, '0')}${String(zh[3]).padStart(2, '0')}`);
  }
  const slash = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (slash) {
    return Number(`${slash[1]}${String(slash[2]).padStart(2, '0')}${String(slash[3]).padStart(2, '0')}`);
  }
  return NaN;
}

export default function Income1Page() {
  const [selectedTsCode, setSelectedTsCode] = useState<string>('');
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
  const [chartTab, setChartTab] = useState<string>('rev_mv');
  const { width, containerRef, mounted } = useContainerWidth();
  const [psData, setPsData] = useState<Array<Record<string, any>>>([]);
  const [psLoading, setPsLoading] = useState(false);
  const [psError, setPsError] = useState<string | null>(null);
  const [psStats, setPsStats] = useState<{ mean: number; std: number } | null>(null);
  const [finaMeta, setFinaMeta] = useState<Array<{ name: string; defaultShow: boolean; desc: string }>>([]);
  const [finaMetaError, setFinaMetaError] = useState<string | null>(null);
  const [mainbzMeta, setMainbzMeta] = useState<Array<{ name: string; defaultShow: boolean; desc: string }>>([]);
  const [mainbzMetaError, setMainbzMetaError] = useState<string | null>(null);
  const [mainbzChartData, setMainbzChartData] = useState<Array<Record<string, any>>>([]);
  const [mainbzSeriesKeys, setMainbzSeriesKeys] = useState<string[]>([]);
  const [mainbzLoading, setMainbzLoading] = useState(false);
  const [mainbzError, setMainbzError] = useState<string | null>(null);
  const [costMarginData, setCostMarginData] = useState<Array<Record<string, any>>>([]);
  const [costMarginLoading, setCostMarginLoading] = useState(false);
  const [costMarginError, setCostMarginError] = useState<string | null>(null);
  const isValuationTab = chartTab === 'ps_valuation' || chartTab === 'pe_valuation' || chartTab === 'pb_valuation';
  const valuationCfg =
    chartTab === 'pe_valuation'
      ? {
          key: 'pe',
          title: '滚动市盈率估值',
          seriesLabel: '滚动市盈率(PE_TTM/PE)',
        }
      : chartTab === 'pb_valuation'
        ? {
            key: 'pb',
            title: '市净率估值',
            seriesLabel: '市净率(PB)',
          }
        : {
            key: 'ps',
            title: '市销率估值',
            seriesLabel: '市销率(PS/PS_TTM)',
          };

  const INCOME1_VALUE_MAPPINGS: Record<string, Record<string, string>> = {
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

  const INCOME1_YI_FIELDS = new Set(['total_revenue', 'q_total_revenue', 'ttm_total_revenue', 'q_compr_inc_attr_p', 'ttm_compr_inc_attr_p']);

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

  useEffect(() => {
    if (!isValuationTab) return;
    if (!selectedTsCode.trim()) {
      setPsData([]);
      setPsStats(null);
      setPsError(null);
      return;
    }
    let cancelled = false;
    const fetchPs = async () => {
      setPsLoading(true);
      setPsError(null);
      try {
        const url = `/api/parq/daily_basic?ts_code=${encodeURIComponent(selectedTsCode.trim())}&page=1&size=1000000&sortField=trade_date&sortDir=asc&getAllDates=true&start_date=20140101`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`indicator api failed: ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const rows: ValuationPoint[] = Array.isArray(json?.data) ? json.data : [];
        const points = rows
          .map((r) => {
            const psTtm = r?.ps_ttm == null ? null : Number(r.ps_ttm);
            const ps = r?.ps == null ? null : Number(r.ps);
            const peTtm = r?.pe_ttm == null ? null : Number(r.pe_ttm);
            const pe = r?.pe == null ? null : Number(r.pe);
            const pb = r?.pb == null ? null : Number(r.pb);
            const v =
              valuationCfg.key === 'pe'
                ? (Number.isFinite(peTtm) ? peTtm : Number.isFinite(pe) ? pe : null)
                : valuationCfg.key === 'pb'
                  ? (Number.isFinite(pb) ? pb : null)
                  : (Number.isFinite(psTtm) ? psTtm : Number.isFinite(ps) ? ps : null);
            const dNum = normalizeDateToNumber((r as any)?.trade_date);
            return {
              trade_date: String((r as any)?.trade_date ?? ''),
              __dateNum: dNum,
              __valuation_value: v,
            };
          })
          .filter((p: any) => p.trade_date && Number.isFinite(p.__dateNum) && p.__dateNum >= 20140101)
          .sort((a, b) => a.__dateNum - b.__dateNum);

        const allDates = points.map((p) => p.__dateNum);
        const minDate = Math.min(...allDates);
        const maxDate = Math.max(...allDates);
        const quarterStarts = quarterStartDates(minDate, maxDate, 20140101);

        // dateNum -> values[]（一个季度内用所有市销率取均值）
        const valueMap = new Map<number, number[]>();
        for (const p of points) {
          if (typeof p.__valuation_value === 'number' && Number.isFinite(p.__valuation_value)) {
            const arr = valueMap.get(p.__dateNum) ?? [];
            arr.push(p.__valuation_value);
            valueMap.set(p.__dateNum, arr);
          }
        }

        // 第一步：每个季度起始点，先用该季度内全部市销率均值
        const quarterSeries = quarterStarts.map((qs) => {
          const startNum = Number(qs);
          const endNum = quarterEndDateNum(qs);
          const quarterValues: number[] = [];
          for (const [d, vals] of valueMap.entries()) {
            if (d >= startNum && d <= endNum) {
              quarterValues.push(...vals);
            }
          }
          const v =
            quarterValues.length > 0
              ? quarterValues.reduce((a, b) => a + b, 0) / quarterValues.length
              : null;
          return {
            trade_date: qs,
            __valuation_value: v,
          };
        });

        // 第二步：基于季度均值做第一轮估值
        const quarterValuesRaw = quarterSeries
          .map((p) => p.__valuation_value)
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        const firstStats = calcMeanStd(quarterValuesRaw);
        const firstHigh = firstStats ? firstStats.mean + firstStats.std : null;
        const firstLow = firstStats ? firstStats.mean - firstStats.std : null;

        // 第三步：超过第一轮高低估值线 1 个单位以上的值做截断，再做第二轮估值并显示
        const upperCap = firstHigh != null ? firstHigh + 1 : null;
        const lowerCap = firstLow != null ? firstLow - 1 : null;
        const normalizedQuarterSeries = quarterSeries.map((p) => {
          const v = p.__valuation_value;
          if (v == null || !Number.isFinite(v) || upperCap == null || lowerCap == null) return p;
          return {
            ...p,
            __valuation_value: Math.max(lowerCap, Math.min(upperCap, v)),
          };
        });

        const quarterValuesNormalized = normalizedQuarterSeries
          .map((p) => p.__valuation_value)
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        const stats = calcMeanStd(quarterValuesNormalized);
        setPsStats(stats);
        const mean = stats?.mean ?? null;
        const high = stats ? stats.mean + stats.std : null;
        const low = stats ? stats.mean - stats.std : null;

        const chartData = normalizedQuarterSeries.map((p) => ({
          ...p,
          mean,
          high,
          low,
        }));

        // 在季度序列最后追加一个「最新日期」点（最新日频市销率）
        const latestPoint = points.reduce<null | { dateNum: number; value: number }>((acc, p) => {
          if (typeof p.__valuation_value !== 'number' || !Number.isFinite(p.__valuation_value)) return acc;
          if (!Number.isFinite(p.__dateNum)) return acc;
          if (!acc || p.__dateNum > acc.dateNum) {
            return { dateNum: p.__dateNum, value: p.__valuation_value };
          }
          return acc;
        }, null);

        if (latestPoint) {
          const latestValue = latestPoint.value;
          const latestDate = String(latestPoint.dateNum);
          if (!chartData.length || chartData[chartData.length - 1]?.trade_date !== latestDate) {
            chartData.push({
              trade_date: latestDate,
              __valuation_value: latestValue,
              mean,
              high,
              low,
            });
          }
        }

        setPsData(chartData);
      } catch (e) {
        if (!cancelled) {
          setPsError(e instanceof Error ? e.message : String(e));
          setPsData([]);
          setPsStats(null);
        }
      } finally {
        if (!cancelled) setPsLoading(false);
      }
    };
    fetchPs();
    return () => {
      cancelled = true;
    };
  }, [chartTab, selectedTsCode, isValuationTab, valuationCfg.key]);

  // 拉取财务指标元数据（用于列顺序/默认显示/中文名）
  useEffect(() => {
    let cancelled = false;
    const fetchMeta = async () => {
      try {
        const res = await fetch('/api/meta/finaIndicator');
        const json = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(json?.rows) ? json.rows : [];
        setFinaMeta(rows);
        setFinaMetaError(null);
      } catch (e) {
        if (!cancelled) {
          setFinaMeta([]);
          setFinaMetaError(e instanceof Error ? e.message : String(e));
        }
      }
    };
    fetchMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  // 拉取主营业务构成元数据
  useEffect(() => {
    let cancelled = false;
    const fetchMeta = async () => {
      try {
        const res = await fetch('/api/meta/finaMainbzVip');
        const json = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(json?.rows) ? json.rows : [];
        setMainbzMeta(rows);
        setMainbzMetaError(null);
      } catch (e) {
        if (!cancelled) {
          setMainbzMeta([]);
          setMainbzMetaError(e instanceof Error ? e.message : String(e));
        }
      }
    };
    fetchMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  // 拉取主营业务构成图数据（按 end_date + bz_item 聚合）
  useEffect(() => {
    if (chartTab !== 'biz_comp') return;
    if (!selectedTsCode.trim()) {
      setMainbzChartData([]);
      setMainbzSeriesKeys([]);
      setMainbzError(null);
      return;
    }
    let cancelled = false;
    const fetchMainbz = async () => {
      setMainbzLoading(true);
      setMainbzError(null);
      try {
        const url = `/api/parq/finaMainbzVip?ts_code=${encodeURIComponent(selectedTsCode.trim())}&page=1&size=1000000&sortField=end_date&sortDir=asc&start_date=20140101`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`mainbiz api failed: ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const rows: MainBizRow[] = Array.isArray(json?.data) ? json.data : [];

        const dateItemMap = new Map<string, Map<string, number>>();
        const latestItemSales = new Map<string, number>();
        let latestDateNum = -Infinity;
        let latestDate = '';

        for (const row of rows) {
          const dateRaw = String(row?.end_date ?? '').trim();
          const item = String(row?.bz_item ?? '').trim();
          const salesNum = Number(row?.bz_sales ?? NaN);
          if (!dateRaw || !item || !Number.isFinite(salesNum)) continue;
          const dateNum = normalizeDateToNumber(dateRaw);
          if (!Number.isFinite(dateNum)) continue;
          if (!dateItemMap.has(dateRaw)) dateItemMap.set(dateRaw, new Map<string, number>());
          const itemMap = dateItemMap.get(dateRaw)!;
          itemMap.set(item, (itemMap.get(item) ?? 0) + salesNum);

          if (dateNum > latestDateNum) {
            latestDateNum = dateNum;
            latestDate = dateRaw;
          }
        }

        const latestMap = latestDate ? dateItemMap.get(latestDate) : undefined;
        if (latestMap) {
          for (const [k, v] of latestMap.entries()) latestItemSales.set(k, v);
        }

        const topItems = [...latestItemSales.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([k]) => k);

        const dates = [...dateItemMap.keys()].sort((a, b) => normalizeDateToNumber(a) - normalizeDateToNumber(b));
        const chartRows = dates.map((d) => {
          const row: Record<string, any> = { end_date: d };
          const itemMap = dateItemMap.get(d);
          for (const item of topItems) {
            const sales = itemMap?.get(item) ?? null;
            row[item] = typeof sales === 'number' ? sales / 1e8 : null;
          }
          return row;
        });

        setMainbzSeriesKeys(topItems);
        setMainbzChartData(chartRows);
      } catch (e) {
        if (!cancelled) {
          setMainbzError(e instanceof Error ? e.message : String(e));
          setMainbzSeriesKeys([]);
          setMainbzChartData([]);
        }
      } finally {
        if (!cancelled) setMainbzLoading(false);
      }
    };
    fetchMainbz();
    return () => {
      cancelled = true;
    };
  }, [chartTab, selectedTsCode]);

  // 成本与毛利率：指标 API — total_revenue_ttm / oper_cost_ttm / grossMargin_ttm（滚动四季度单季之和）
  useEffect(() => {
    if (chartTab !== 'cost_margin') return;
    if (!selectedTsCode.trim()) {
      setCostMarginData([]);
      setCostMarginError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setCostMarginLoading(true);
      setCostMarginError(null);
      try {
        const qs = new URLSearchParams({
          stock: selectedTsCode.trim(),
          metrics: 'total_revenue_ttm,oper_cost_ttm,grossMargin_ttm',
          from: '2014Q1',
          to: '2025Q3',
        });
        const url = `/api/metrics?${qs.toString()}`;
        const res = await fetch(url);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(
            typeof json?.message === 'string' ? json.message : `metrics api failed: ${res.status}`
          );
        }
        const points: Record<string, unknown>[] = Array.isArray(json?.points) ? json.points : [];
        const chartRows = points.map((p) => {
          const periodKey = String(p?.period ?? '');
          const tr = Number(p?.total_revenue_ttm);
          const oc = Number(p?.oper_cost_ttm);
          const gm = p?.grossMargin_ttm;
          const rev = Number.isFinite(tr) ? tr : NaN;
          const operCost = Number.isFinite(oc) ? oc : NaN;
          const gmNum = gm == null ? NaN : Number(gm);
          const grossMarginPct =
            Number.isFinite(gmNum) ? gmNum * 100 : null;
          return {
            period: periodKey,
            total_revenue_yi: Number.isFinite(rev) ? rev / 1e8 : null,
            oper_cost_yi: Number.isFinite(operCost) ? operCost / 1e8 : null,
            gross_margin_pct: grossMarginPct,
          };
        });
        setCostMarginData(chartRows);
      } catch (e) {
        if (!cancelled) {
          setCostMarginError(e instanceof Error ? e.message : String(e));
          setCostMarginData([]);
        }
      } finally {
        if (!cancelled) setCostMarginLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [chartTab, selectedTsCode]);

  return (
    <div className="space-y-6">
      {/* 控制面板 */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-white rounded-lg border border-gray-200">
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

      <div
        ref={containerRef as any}
        className="bg-gray-50 p-4 rounded-lg w-full mt-0"
        style={{ width: '100%' ,marginTop:0}}
      >
        {mounted && width > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="p-4">
              <Tabs value={chartTab} onValueChange={setChartTab} className="w-full">
                <TabsList className="mb-3">
                  <TabsTrigger value="rev_mv">营收和市值</TabsTrigger>
                  <TabsTrigger value="rev_cashflow">营收和现金流</TabsTrigger>
                  <TabsTrigger value="cost_margin">成本与毛利率</TabsTrigger>
                  <TabsTrigger value="biz_comp">业务构成</TabsTrigger>
                  <TabsTrigger value="ps_valuation">市销率估值</TabsTrigger>
                  <TabsTrigger value="pe_valuation">滚动市盈率估值</TabsTrigger>
                  <TabsTrigger value="pb_valuation">市净率估值</TabsTrigger>
                </TabsList>
                <TabsContent value="rev_mv">
                  {selectedTsCode ? (
                    <PriceChart
                      tsCode={selectedTsCode}
                      leftData1={{
                        barField: 'ttm_total_revenue',
                        barFieldLabel: 'TTM滚动总营收',
                        barField2: 'ttm_compr_inc_attr_p',
                        barField2Label: 'TTM滚动归母综合收益总额',
                        barField2Color: '#ef4444',
                        barApiPath: '/api/parq/income1',
                        barDateField: 'end_date',
                      }}
                      rightData1={{
                        lineField: 'total_mv',
                        lineFieldLabel: '总市值（万元）',
                        lineApiPath: '/api/parq/daily_basic',
                        lineDateField: 'trade_date',
                        lineSource: 'parquet',
                      }}
                      swapYAxes={true}
                    />
                  ) : (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="rev_cashflow">
                  {selectedTsCode ? (
                    <PriceChart
                      tsCode={selectedTsCode}
                      dualLineData={{
                        line1Field: 'ttm_total_revenue',
                        line1Label: '滚动总营收',
                        line2Field: 'ttm_c_inf_fr_operate_a',
                        line2Label: '滚动经营现金流入',
                        line3Field: 'ttm_n_income',
                        line3Label: '滚动净利润',
                        apiPath: '/api/parq/cashflowIncome',
                        dateField: 'end_date',
                      }}
                    />
                  ) : (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="cost_margin">
                  {!selectedTsCode ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  ) : costMarginLoading ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">加载中...</p>
                    </div>
                  ) : costMarginError ? (
                    <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                      <p className="text-red-500">错误: {costMarginError}</p>
                    </div>
                  ) : costMarginData.length === 0 ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">暂无利润表数据</p>
                    </div>
                  ) : (
                    <div className="w-full h-[28rem] border border-slate-700 rounded-lg p-4 pb-8 bg-slate-900 text-slate-100">
                      <h3 className="text-lg font-semibold mb-1">
                        成本与毛利率分析 - {selectedTsCode}
                      </h3>
                      <p className="text-xs text-slate-400 mb-3">
                        横轴：报告期（YYYYQn）；左轴：营业总收入 TTM / 营业成本 TTM（亿元，oper_cost 单季滚动四季度之和）；右轴：毛利率 TTM（%）= (营收 TTM − 营业成本 TTM) ÷ 营收 TTM（/api/metrics）
                      </p>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={costMarginData}
                          margin={{ top: 8, right: 36, left: 8, bottom: 52 }}
                          barCategoryGap="18%"
                          barGap={4}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis
                            dataKey="period"
                            tick={{ fill: '#94a3b8', fontSize: 10 }}
                            angle={-45}
                            textAnchor="end"
                            height={70}
                            interval={0}
                          />
                          <YAxis
                            yAxisId="left"
                            orientation="left"
                            domain={['auto', 'auto']}
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            tickFormatter={(v) => `${Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`}
                            label={{ value: '亿元', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            domain={['auto', 'auto']}
                            tick={{ fill: '#cbd5e1', fontSize: 11 }}
                            tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                            label={{ value: '毛利率 TTM', angle: 90, position: 'insideRight', fill: '#cbd5e1', fontSize: 11 }}
                          />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
                            labelStyle={{ color: '#e2e8f0' }}
                            formatter={(value: any, name?: string | number) => {
                              const n = typeof value === 'number' ? value : Number(value);
                              const label = String(name ?? '');
                              if (!Number.isFinite(n)) return ['—', label];
                              if (label.includes('毛利率')) return [`${n.toFixed(2)}%`, label];
                              return [`${n.toFixed(2)} 亿`, label];
                            }}
                          />
                          <Legend
                            verticalAlign="bottom"
                            wrapperStyle={{ paddingTop: 12 }}
                            formatter={(value) => <span className="text-slate-300 text-sm">{value}</span>}
                          />
                          <Bar
                            yAxisId="left"
                            dataKey="total_revenue_yi"
                            name="营业总收入 TTM"
                            fill="#3b82f6"
                            radius={[2, 2, 0, 0]}
                            maxBarSize={28}
                          />
                          <Bar
                            yAxisId="left"
                            dataKey="oper_cost_yi"
                            name="营业成本 TTM"
                            fill="#f97316"
                            radius={[2, 2, 0, 0]}
                            maxBarSize={28}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="gross_margin_pct"
                            name="毛利率 TTM"
                            stroke="#f8fafc"
                            strokeWidth={2}
                            dot={{ r: 2, fill: '#f8fafc' }}
                            activeDot={{ r: 4 }}
                            connectNulls
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="biz_comp">
                  {!selectedTsCode ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  ) : mainbzLoading ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">加载中...</p>
                    </div>
                  ) : mainbzError ? (
                    <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                      <p className="text-red-500">错误: {mainbzError}</p>
                    </div>
                  ) : mainbzChartData.length === 0 || mainbzSeriesKeys.length === 0 ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">暂无主营业务构成数据</p>
                    </div>
                  ) : (
                    <div className="w-full h-[28rem] border border-gray-200 rounded-lg p-4 pb-6 bg-white">
                      <h3 className="text-lg font-semibold mb-3">主营业务构成趋势 - {selectedTsCode}</h3>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={mainbzChartData} margin={{ top: 5, right: 30, left: 20, bottom: 44 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="end_date"
                            tickFormatter={formatDateYYMM}
                            angle={-90}
                            textAnchor="end"
                            height={78}
                            interval={0}
                            tickMargin={6}
                            minTickGap={0}
                            tick={{ fontSize: 10 }}
                          />
                          <YAxis tickFormatter={(v) => Number(v).toFixed(2)} />
                          <Tooltip
                            labelFormatter={(l) => `报告期: ${formatDateYYMM(l)}`}
                            formatter={(value: any, name?: string | number) => {
                              const num = typeof value === 'number' ? value : Number(value);
                              if (!Number.isFinite(num)) return ['—', name];
                              return [num.toFixed(2), `${String(name ?? '')}(亿元)`];
                            }}
                          />
                          <Legend verticalAlign="bottom" height={24} wrapperStyle={{ paddingTop: 8 }} />
                          {mainbzSeriesKeys.map((k, idx) => (
                            <Line
                              key={k}
                              type="monotone"
                              dataKey={k}
                              stroke={['#eab308', '#06b6d4', '#ef4444', '#2563eb', '#10b981', '#a855f7'][idx % 6]}
                              strokeWidth={2}
                              dot={{ r: 2 }}
                              activeDot={{ r: 4 }}
                              connectNulls={true}
                              name={k}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="ps_valuation">
                  {!selectedTsCode ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  ) : psLoading ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">加载中...</p>
                    </div>
                  ) : psError ? (
                    <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                      <p className="text-red-500">错误: {psError}</p>
                    </div>
                  ) : psData.length === 0 ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">暂无数据</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="w-full h-[28rem] border border-gray-200 rounded-lg p-4 pb-6 bg-white">
                        <h3 className="text-lg font-semibold mb-1">
                          {valuationCfg.title} - {selectedTsCode}
                        </h3>
                        <div className="text-xs text-gray-500 mb-3">
                          使用全样本均值与标准差：均值 {psStats ? psStats.mean.toFixed(3) : '—'}，
                          标准差 {psStats ? psStats.std.toFixed(3) : '—'}（高估线=均值+1σ，低估线=均值-1σ）
                        </div>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={psData} margin={{ top: 5, right: 30, left: 20, bottom: 44 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="trade_date"
                              tickFormatter={formatDateYYMM}
                              angle={-90}
                              textAnchor="end"
                              height={78}
                              interval={0}
                              tickMargin={6}
                              minTickGap={0}
                              tick={{ fontSize: 10 }}
                            />
                            <YAxis
                              domain={['auto', 'auto']}
                              tickFormatter={(v) => Number(v).toFixed(2)}
                            />
                            <Tooltip
                              labelFormatter={(l) => `日期: ${formatDateYYMM(l)}`}
                              formatter={(value: any, name?: string | number, props?: any) => {
                                const key = props?.dataKey as string | undefined;
                                const num = typeof value === 'number' ? value : Number(value);
                                if (!Number.isFinite(num)) return ['—', name];
                                const label =
                                  key === '__valuation_value'
                                    ? valuationCfg.seriesLabel
                                    : key === 'mean'
                                      ? '均值'
                                      : key === 'high'
                                        ? '高估线(均值+1σ)'
                                        : key === 'low'
                                          ? '低估线(均值-1σ)'
                                          : String(name ?? key ?? '');
                                return [num.toFixed(3), label];
                              }}
                            />
                            <Legend verticalAlign="bottom" height={24} wrapperStyle={{ paddingTop: 8 }} />
                            <Line
                              type="monotone"
                              dataKey="__valuation_value"
                              stroke="#2563eb"
                              strokeWidth={2}
                              dot={{ r: 2, fill: '#2563eb' }}
                              activeDot={{ r: 4 }}
                              name={valuationCfg.seriesLabel}
                            />
                            <Line
                              type="monotone"
                              dataKey="mean"
                              stroke="#facc15"
                              strokeWidth={2}
                              dot={false}
                              name="均值"
                            />
                            <Line
                              type="monotone"
                              dataKey="high"
                              stroke="#ef4444"
                              strokeWidth={2}
                              dot={false}
                              name="高估线(均值+1σ)"
                            />
                            <Line
                              type="monotone"
                              dataKey="low"
                              stroke="#111827"
                              strokeWidth={2}
                              dot={false}
                              name="低估线(均值-1σ)"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="pe_valuation">
                  {!selectedTsCode ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  ) : psLoading ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">加载中...</p>
                    </div>
                  ) : psError ? (
                    <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                      <p className="text-red-500">错误: {psError}</p>
                    </div>
                  ) : psData.length === 0 ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">暂无数据</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="w-full h-[28rem] border border-gray-200 rounded-lg p-4 pb-6 bg-white">
                        <h3 className="text-lg font-semibold mb-1">
                          {valuationCfg.title} - {selectedTsCode}
                        </h3>
                        <div className="text-xs text-gray-500 mb-3">
                          使用全样本均值与标准差：均值 {psStats ? psStats.mean.toFixed(3) : '—'}，
                          标准差 {psStats ? psStats.std.toFixed(3) : '—'}（高估线=均值+1σ，低估线=均值-1σ）
                        </div>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={psData} margin={{ top: 5, right: 30, left: 20, bottom: 44 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="trade_date" tickFormatter={formatDateYYMM} angle={-90} textAnchor="end" height={78} interval={0} tickMargin={6} minTickGap={0} tick={{ fontSize: 10 }} />
                            <YAxis domain={['auto', 'auto']} tickFormatter={(v) => Number(v).toFixed(2)} />
                            <Tooltip
                              labelFormatter={(l) => `日期: ${formatDateYYMM(l)}`}
                              formatter={(value: any, name?: string | number, props?: any) => {
                                const key = props?.dataKey as string | undefined;
                                const num = typeof value === 'number' ? value : Number(value);
                                if (!Number.isFinite(num)) return ['—', name];
                                const label =
                                  key === '__valuation_value'
                                    ? valuationCfg.seriesLabel
                                    : key === 'mean'
                                      ? '均值'
                                      : key === 'high'
                                        ? '高估线(均值+1σ)'
                                        : key === 'low'
                                          ? '低估线(均值-1σ)'
                                          : String(name ?? key ?? '');
                                return [num.toFixed(3), label];
                              }}
                            />
                            <Legend verticalAlign="bottom" height={24} wrapperStyle={{ paddingTop: 8 }} />
                            <Line type="monotone" dataKey="__valuation_value" stroke="#2563eb" strokeWidth={2} dot={{ r: 2, fill: '#2563eb' }} activeDot={{ r: 4 }} name={valuationCfg.seriesLabel} />
                            <Line type="monotone" dataKey="mean" stroke="#facc15" strokeWidth={2} dot={false} name="均值" />
                            <Line type="monotone" dataKey="high" stroke="#ef4444" strokeWidth={2} dot={false} name="高估线(均值+1σ)" />
                            <Line type="monotone" dataKey="low" stroke="#111827" strokeWidth={2} dot={false} name="低估线(均值-1σ)" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="pb_valuation">
                  {!selectedTsCode ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  ) : psLoading ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">加载中...</p>
                    </div>
                  ) : psError ? (
                    <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                      <p className="text-red-500">错误: {psError}</p>
                    </div>
                  ) : psData.length === 0 ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">暂无数据</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="w-full h-[28rem] border border-gray-200 rounded-lg p-4 pb-6 bg-white">
                        <h3 className="text-lg font-semibold mb-1">
                          {valuationCfg.title} - {selectedTsCode}
                        </h3>
                        <div className="text-xs text-gray-500 mb-3">
                          使用全样本均值与标准差：均值 {psStats ? psStats.mean.toFixed(3) : '—'}，
                          标准差 {psStats ? psStats.std.toFixed(3) : '—'}（高估线=均值+1σ，低估线=均值-1σ）
                        </div>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={psData} margin={{ top: 5, right: 30, left: 20, bottom: 44 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="trade_date"
                              tickFormatter={formatDateYYMM}
                              angle={-90}
                              textAnchor="end"
                              height={78}
                              interval={0}
                              tickMargin={6}
                              minTickGap={0}
                              tick={{ fontSize: 10 }}
                            />
                            <YAxis
                              domain={['auto', 'auto']}
                              tickFormatter={(v) => Number(v).toFixed(2)}
                            />
                            <Tooltip
                              labelFormatter={(l) => `日期: ${formatDateYYMM(l)}`}
                              formatter={(value: any, name?: string | number, props?: any) => {
                                const key = props?.dataKey as string | undefined;
                                const num = typeof value === 'number' ? value : Number(value);
                                if (!Number.isFinite(num)) return ['—', name];
                                const label =
                                  key === '__valuation_value'
                                    ? valuationCfg.seriesLabel
                                    : key === 'mean'
                                      ? '均值'
                                      : key === 'high'
                                        ? '高估线(均值+1σ)'
                                        : key === 'low'
                                          ? '低估线(均值-1σ)'
                                          : String(name ?? key ?? '');
                                return [num.toFixed(3), label];
                              }}
                            />
                            <Legend verticalAlign="bottom" height={24} wrapperStyle={{ paddingTop: 8 }} />
                            <Line
                              type="monotone"
                              dataKey="__valuation_value"
                              stroke="#2563eb"
                              strokeWidth={2}
                              dot={{ r: 2, fill: '#2563eb' }}
                              activeDot={{ r: 4 }}
                              name={valuationCfg.seriesLabel}
                            />
                            <Line
                              type="monotone"
                              dataKey="mean"
                              stroke="#facc15"
                              strokeWidth={2}
                              dot={false}
                              name="均值"
                            />
                            <Line
                              type="monotone"
                              dataKey="high"
                              stroke="#ef4444"
                              strokeWidth={2}
                              dot={false}
                              name="高估线(均值+1σ)"
                            />
                            <Line
                              type="monotone"
                              dataKey="low"
                              stroke="#111827"
                              strokeWidth={2}
                              dot={false}
                              name="低估线(均值-1σ)"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </div>

      {/* 数据表格 */}
      { (
        <Tabs defaultValue="income1" className="w-full">
          <TabsList className="mb-3 flex flex-wrap">
            <TabsTrigger value="income1">利润表</TabsTrigger>
            <TabsTrigger value="daily_indicators">每日指标</TabsTrigger>
            <TabsTrigger value="fina_indicators">财务指标</TabsTrigger>
            <TabsTrigger value="rev_cashflow">滚动营收与现金流</TabsTrigger>
            <TabsTrigger value="biz_comp">主营业务构成</TabsTrigger>
          </TabsList>
          <TabsContent value="income1">
            <DataGrid
              category="income1"
              title="利润表"
              useServerPagination={true}
              apiPath={"/api/parq/income1"}
              extraQueryParams={selectedTsCode ? { ts_code: selectedTsCode } : {}}
              valueMappings={INCOME1_VALUE_MAPPINGS}
              yiFields={INCOME1_YI_FIELDS}
            />
          </TabsContent>
          <TabsContent value="daily_indicators">
            {selectedTsCode ? (
              <DataGrid
                category="daily_basic"
                tabId="income1_daily"
                title="每日指标（按季度分组）"
                useServerPagination={true}
                apiPath={"/api/parq/daily_basic"}
                extraQueryParams={{ ts_code: selectedTsCode, start_date: '20140101' }}
                columnOrder={['trade_date', 'ps_ttm', 'ps', 'total_mv', 'close', 'pe_ttm', 'pb']}
                fieldLabelMap={{
                  ps_ttm: '市销率(PS_TTM)',
                  ps: '市销率(PS)',
                }}
              />
            ) : (
              <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                <p className="text-gray-500">请先输入股票代码</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="fina_indicators">
            {selectedTsCode ? (
              finaMetaError ? (
                <div className="w-full h-48 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                  <p className="text-red-500">元数据加载失败: {finaMetaError}</p>
                </div>
              ) : (
                <DataGrid
                  category="finaIndicator"
                  tabId="income1_fina"
                  title="财务指标"
                  useServerPagination={true}
                  apiPath={"/api/parq/finaIndicator"}
                  extraQueryParams={{ ts_code: selectedTsCode, start_date: '20140101' }}
                  columnOrder={finaMeta.length ? finaMeta.map((r) => r.name) : undefined}
                  fieldLabelMap={
                    finaMeta.length
                      ? Object.fromEntries(finaMeta.map((r) => [r.name, r.desc]))
                      : undefined
                  }
                  defaultHiddenFields={
                    finaMeta.length
                      ? new Set(finaMeta.filter((r) => !r.defaultShow).map((r) => r.name))
                      : undefined
                  }
                />
              )
            ) : (
              <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                <p className="text-gray-500">请先输入股票代码</p>
              </div>
            )}
          </TabsContent>
          <TabsContent value="rev_cashflow">
            <DataGrid
              category="cashflowIncome"
              title="滚动营收与现金流"
              useServerPagination={true}
              apiPath="/api/parq/cashflowIncome"
              extraQueryParams={selectedTsCode ? { ts_code: selectedTsCode } : {}}
              defaultHiddenFields={CASHFLOW_TAB_DEFAULT_HIDDEN}
              yiFields={new Set(['q_total_revenue', 'q_n_income', 'q_c_inf_fr_operate_a', 'ttm_total_revenue', 'ttm_n_income', 'ttm_c_inf_fr_operate_a'])}
            />
          </TabsContent>
          <TabsContent value="biz_comp">
          <DataGrid
                category="finaMainbzVip"
                tabId="income1_mainbz"
                title="主营业务构成"
                useServerPagination={true}
                apiPath={"/api/parq/finaMainbzVip"}
                extraQueryParams={{ ts_code: selectedTsCode, start_date: '20140101' }}
                columnOrder={mainbzMeta.length ? mainbzMeta.map((r) => r.name) : undefined}
                fieldLabelMap={
                  mainbzMeta.length
                    ? Object.fromEntries(mainbzMeta.map((r) => [r.name, r.desc]))
                    : undefined
                }
                defaultHiddenFields={
                  mainbzMeta.length
                    ? new Set(mainbzMeta.filter((r) => !r.defaultShow).map((r) => r.name))
                    : undefined
                }
                yiFields={new Set(['bz_sales', 'bz_profit', 'bz_cost'])}
              />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
