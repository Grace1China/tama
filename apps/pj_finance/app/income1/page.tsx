'use client';

import { useState, useRef, useEffect } from 'react';
import DataGrid from '../components/DataGrid';
import PriceChart from '../components/PriceChart';
import StockCodeAutocomplete from '../components/StockCodeAutocomplete';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
} from 'recharts';
import { formatDateYYMM } from '@/lib/dateFormat';

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
  const [revCashflowData, setRevCashflowData] = useState<Array<Record<string, any>>>([]);
  const [revCashflowLoading, setRevCashflowLoading] = useState(false);
  const [revCashflowError, setRevCashflowError] = useState<string | null>(null);
  const [feeRevenueData, setFeeRevenueData] = useState<Array<Record<string, any>>>([]);
  const [feeRevenueLoading, setFeeRevenueLoading] = useState(false);
  const [feeRevenueError, setFeeRevenueError] = useState<string | null>(null);
  const [growthSummaryData, setGrowthSummaryData] = useState<Array<{ name: string; value: number | null; fill: string }>>([]);
  const [growthSummaryLoading, setGrowthSummaryLoading] = useState(false);
  const [growthSummaryError, setGrowthSummaryError] = useState<string | null>(null);
  const [growthTrendData, setGrowthTrendData] = useState<Array<Record<string, any>>>([]);
  const [growthTrendLoading, setGrowthTrendLoading] = useState(false);
  const [growthTrendError, setGrowthTrendError] = useState<string | null>(null);
  const [balanceStructureData, setBalanceStructureData] = useState<Array<{ name: string; value: number | null; fill: string }>>([]);
  const [balanceStructurePeriod, setBalanceStructurePeriod] = useState<string | null>(null);
  const [balanceStructureLoading, setBalanceStructureLoading] = useState(false);
  const [balanceStructureError, setBalanceStructureError] = useState<string | null>(null);
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

  // 营收和现金流：指标 API — 4 条曲线（亿元）
  useEffect(() => {
    if (chartTab !== 'rev_cashflow') return;
    if (!selectedTsCode.trim()) {
      setRevCashflowData([]);
      setRevCashflowError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setRevCashflowLoading(true);
      setRevCashflowError(null);
      try {
        const qs = new URLSearchParams({
          stock: selectedTsCode.trim(),
          metrics: 'total_revenue_ttm,c_inf_fr_operate_a_ttm,n_income_attr_p_ttm,n_cashflow_act_ttm',
          from: '2014Q1',
          to: '2025Q4',
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
        const toYi = (p: Record<string, unknown>, key: string) => {
          const n = Number(p?.[key]);
          return Number.isFinite(n) ? n / 1e8 : null;
        };
        const chartRows = points.map((p) => ({
          period: String(p?.period ?? ''),
          total_revenue_yi: toYi(p, 'total_revenue_ttm'),
          cashflow_in_yi: toYi(p, 'c_inf_fr_operate_a_ttm'),
          net_profit_yi: toYi(p, 'n_income_attr_p_ttm'),
          cashflow_net_yi: toYi(p, 'n_cashflow_act_ttm'),
        }));
        setRevCashflowData(chartRows);
      } catch (e) {
        if (!cancelled) {
          setRevCashflowError(e instanceof Error ? e.message : String(e));
          setRevCashflowData([]);
        }
      } finally {
        if (!cancelled) setRevCashflowLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
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

  // 三费与总营收：左轴营收 TTM（亿元柱）、右轴销售/管理/研发 TTM（亿元线）；字段见 income_vip sell_exp / admin_exp / rd_exp
  useEffect(() => {
    if (chartTab !== 'fee_revenue') return;
    if (!selectedTsCode.trim()) {
      setFeeRevenueData([]);
      setFeeRevenueError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setFeeRevenueLoading(true);
      setFeeRevenueError(null);
      try {
        const qs = new URLSearchParams({
          stock: selectedTsCode.trim(),
          metrics: 'total_revenue_ttm,sell_exp_ttm,admin_exp_ttm,rd_exp_ttm',
          from: '2014Q1',
          to: '2025Q3',
        });
        const res = await fetch(`/api/metrics?${qs.toString()}`);
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
          const toYi = (k: string) => {
            const n = Number(p?.[k]);
            return Number.isFinite(n) ? n / 1e8 : null;
          };
          return {
            period: periodKey,
            total_revenue_yi: toYi('total_revenue_ttm'),
            sell_exp_yi: toYi('sell_exp_ttm'),
            admin_exp_yi: toYi('admin_exp_ttm'),
            rd_exp_yi: toYi('rd_exp_ttm'),
          };
        });
        setFeeRevenueData(chartRows);
      } catch (e) {
        if (!cancelled) {
          setFeeRevenueError(e instanceof Error ? e.message : String(e));
          setFeeRevenueData([]);
        }
      } finally {
        if (!cancelled) setFeeRevenueLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [chartTab, selectedTsCode]);

  // 综合增长率：mv_growth / revenue_growth / profit_growth / net_assets_growth（指标在 metrics/definitions.ts）
  useEffect(() => {
    if (chartTab !== 'growth_summary') return;
    if (!selectedTsCode.trim()) {
      setGrowthSummaryData([]);
      setGrowthSummaryError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setGrowthSummaryLoading(true);
      setGrowthSummaryError(null);
      try {
        const qs = new URLSearchParams({
          stock: selectedTsCode.trim(),
          metrics: 'mv_growth,revenue_growth,profit_growth,net_assets_growth',
          years: '5',
        });
        const res = await fetch(`/api/metrics?${qs.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(typeof json?.message === 'string' ? json.message : `metrics api failed: ${res.status}`);
        }
        const results = (json?.results ?? {}) as Record<string, any>;
        const getVal = (k: string) => {
          const v = results?.[k]?.value;
          const n = typeof v === 'number' ? v : Number(v);
          return Number.isFinite(n) ? n : null;
        };
        setGrowthSummaryData([
          { name: '市值增长', value: getVal('mv_growth'), fill: '#facc15' },
          { name: '营收增长', value: getVal('revenue_growth'), fill: '#60a5fa' },
          { name: '利润增长', value: getVal('profit_growth'), fill: '#60a5fa' },
          { name: '净资产增长', value: getVal('net_assets_growth'), fill: '#60a5fa' },
        ]);
      } catch (e) {
        if (!cancelled) {
          setGrowthSummaryError(e instanceof Error ? e.message : String(e));
          setGrowthSummaryData([]);
        }
      } finally {
        if (!cancelled) setGrowthSummaryLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [chartTab, selectedTsCode]);

  // 综合增长率变化趋势：左轴=市值/营收/净利润/净资产，右轴=对应5年CAGR
  useEffect(() => {
    if (chartTab !== 'growth_trend') return;
    if (!selectedTsCode.trim()) {
      setGrowthTrendData([]);
      setGrowthTrendError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setGrowthTrendLoading(true);
      setGrowthTrendError(null);
      try {
        const years = 5;
        const fromPeriod = '2014Q1';
        const firstCagrPeriod = `${Number(fromPeriod.slice(0, 4)) + years}Q${fromPeriod.slice(-1)}`;
        const qs = new URLSearchParams({
          stock: selectedTsCode.trim(),
          metrics:
            'total_mv,total_revenue_ttm,n_income_attr_p_ttm,total_hldr_eqy_exc_min_int,mv_growth,revenue_growth,profit_growth,net_assets_growth',
          years: String(years),
          from: fromPeriod,
          to: '2025Q3',
        });
        const res = await fetch(`/api/metrics?${qs.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(typeof json?.message === 'string' ? json.message : `metrics api failed: ${res.status}`);
        }
        const points: Record<string, unknown>[] = Array.isArray(json?.points) ? json.points : [];
        const chartRows = points.map((p) => {
          const toYiByKey = (k: string) => {
            const n = Number(p?.[k]);
            if (!Number.isFinite(n)) return null;
            // total_mv 单位万元，其余为元
            if (k === 'total_mv') return n / 1e4;
            return n / 1e8;
          };
          const growthOrZero = (k: string) => {
            const n = Number(p?.[k]);
            return Number.isFinite(n) ? n : 0;
          };
          return {
            period: String(p?.period ?? ''),
            mv_yi: toYiByKey('total_mv'),
            revenue_yi: toYiByKey('total_revenue_ttm'),
            profit_yi: toYiByKey('n_income_attr_p_ttm'),
            net_assets_yi: toYiByKey('total_hldr_eqy_exc_min_int'),
            mv_growth_pct: growthOrZero('mv_growth'),
            revenue_growth_pct: growthOrZero('revenue_growth'),
            profit_growth_pct: growthOrZero('profit_growth'),
            net_assets_growth_pct: growthOrZero('net_assets_growth'),
          };
        }).filter((row) => row.period >= firstCagrPeriod);
        setGrowthTrendData(chartRows);
      } catch (e) {
        if (!cancelled) {
          setGrowthTrendError(e instanceof Error ? e.message : String(e));
          setGrowthTrendData([]);
        }
      } finally {
        if (!cancelled) setGrowthTrendLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [chartTab, selectedTsCode]);

  // 资产负债结构：取最新一期资产/负债/权益关键项目（亿元）
  useEffect(() => {
    if (chartTab !== 'balance_structure') return;
    if (!selectedTsCode.trim()) {
      setBalanceStructureData([]);
      setBalanceStructurePeriod(null);
      setBalanceStructureError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setBalanceStructureLoading(true);
      setBalanceStructureError(null);
      try {
        const qs = new URLSearchParams({
          stock: selectedTsCode.trim(),
          metrics:
            'total_cash,prepayment,accounts_receiv,inventories,oth_cur_assets,lt_eqt_invest,fix_assets,intan_assets,oth_nca,st_borr,accounts_pay,contract_liab,payroll_taxes_payable,oth_cur_liab,lt_borr,oth_ncl',
        });
        const res = await fetch(`/api/metrics?${qs.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(typeof json?.message === 'string' ? json.message : `metrics api failed: ${res.status}`);
        }
        const results = (json?.results ?? {}) as Record<string, any>;
        const toYi = (k: string) => {
          const v = results?.[k]?.value;
          const n = typeof v === 'number' ? v : Number(v);
          return Number.isFinite(n) ? n / 1e8 : null;
        };
        setBalanceStructurePeriod(typeof json?.period === 'string' ? json.period : null);
        setBalanceStructureData([
          { name: '总现金', value: toYi('total_cash'), fill: '#60a5fa' },
          { name: '应收款', value: toYi('accounts_receiv'), fill: '#60a5fa' },
          { name: '预付款项', value: toYi('prepayment'), fill: '#60a5fa' },
          { name: '存货', value: toYi('inventories'), fill: '#60a5fa' },
          { name: '其他流动资产', value: toYi('oth_cur_assets'), fill: '#60a5fa' },
          { name: '长期股权投资', value: toYi('lt_eqt_invest'), fill: '#60a5fa' },
          { name: '固定资产', value: toYi('fix_assets'), fill: '#60a5fa' },
          { name: '无形资产', value: toYi('intan_assets'), fill: '#60a5fa' },
          { name: '其他非流动资产', value: toYi('oth_nca'), fill: '#60a5fa' },
          { name: '短期借款', value: toYi('st_borr'), fill: '#ef4444' },
          { name: '应付票据及应付账款', value: toYi('accounts_pay'), fill: '#ef4444' },
          { name: '合同负债', value: toYi('contract_liab'), fill: '#ef4444' },
          { name: '薪酬和税费', value: toYi('payroll_taxes_payable'), fill: '#ef4444' },
          { name: '其他流动负债', value: toYi('oth_cur_liab'), fill: '#ef4444' },
          { name: '长期借款', value: toYi('lt_borr'), fill: '#ef4444' },
          { name: '其他长期负债', value: toYi('oth_ncl'), fill: '#ef4444' },
        ]);
      } catch (e) {
        if (!cancelled) {
          setBalanceStructureError(e instanceof Error ? e.message : String(e));
          setBalanceStructureData([]);
          setBalanceStructurePeriod(null);
        }
      } finally {
        if (!cancelled) setBalanceStructureLoading(false);
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
        <div className="flex items-center gap-2 relative">
          <label htmlFor="tsCode" className="text-sm font-medium text-gray-700">
            股票代码:
          </label>
          <StockCodeAutocomplete onSelectTsCode={setSelectedTsCode} />
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
                  <TabsTrigger value="fee_revenue">三费与营收</TabsTrigger>
                  <TabsTrigger value="growth_summary">综合增长率</TabsTrigger>
                  <TabsTrigger value="growth_trend">综合增长率趋势</TabsTrigger>
                  <TabsTrigger value="balance_structure">资产负债结构</TabsTrigger>
                  <TabsTrigger value="biz_comp">业务构成</TabsTrigger>
                  <TabsTrigger value="ps_valuation">市销率估值</TabsTrigger>
                  <TabsTrigger value="pe_valuation">滚动市盈率估值</TabsTrigger>
                  <TabsTrigger value="pb_valuation">市净率估值</TabsTrigger>
                </TabsList>
                <TabsContent value="rev_mv">
                  {selectedTsCode ? (
                    <PriceChart
                      tsCode={selectedTsCode}
                      xAxisDateFormat="quarter"
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
                  {!selectedTsCode ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  ) : revCashflowLoading ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">加载中...</p>
                    </div>
                  ) : revCashflowError ? (
                    <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                      <p className="text-red-500">错误: {revCashflowError}</p>
                    </div>
                  ) : revCashflowData.length === 0 ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">暂无数据</p>
                    </div>
                  ) : (
                    <div className="w-full h-[28rem] border border-slate-700 rounded-lg p-4 pb-8 bg-slate-900 text-slate-100">
                      <h3 className="text-lg font-semibold mb-1">
                        营收和现金流分析 - {selectedTsCode}
                      </h3>
                      <p className="text-xs text-slate-400 mb-3">
                        横轴：报告期（YYQn）；纵轴：亿元（/api/metrics TTM）
                      </p>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={revCashflowData}
                          margin={{ top: 8, right: 36, left: 8, bottom: 52 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis
                            dataKey="period"
                            tickFormatter={formatDateYYMM}
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
                            label={{ value: '营收/现金流入(亿)', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            domain={['auto', 'auto']}
                            tick={{ fill: '#cbd5e1', fontSize: 11 }}
                            tickFormatter={(v) => `${Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`}
                            label={{ value: '利润/现金流净额(亿)', angle: 90, position: 'insideRight', fill: '#cbd5e1', fontSize: 11 }}
                          />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
                            labelStyle={{ color: '#e2e8f0' }}
                            formatter={(value: any, name?: string | number) => {
                              const n = typeof value === 'number' ? value : Number(value);
                              if (!Number.isFinite(n)) return ['—', String(name ?? '')];
                              return [`${n.toFixed(2)} 亿`, String(name ?? '')];
                            }}
                          />
                          <Legend
                            verticalAlign="bottom"
                            wrapperStyle={{ paddingTop: 12 }}
                            formatter={(value) => <span className="text-slate-300 text-sm">{value}</span>}
                          />
                          <Line yAxisId="left" type="monotone" dataKey="total_revenue_yi" name="滚动总营收 TTM" stroke="#1e40af" strokeWidth={2} dot={{ r: 2, fill: '#1e40af' }} connectNulls />
                          <Line yAxisId="left" type="monotone" dataKey="cashflow_in_yi" name="经营现金流入 TTM" stroke="#60a5fa" strokeWidth={2} dot={{ r: 2, fill: '#60a5fa' }} connectNulls />
                          <Line yAxisId="right" type="monotone" dataKey="net_profit_yi" name="归母净利润 TTM" stroke="#9a3412" strokeWidth={2} dot={{ r: 2, fill: '#9a3412' }} connectNulls />
                          <Line yAxisId="right" type="monotone" dataKey="cashflow_net_yi" name="经营现金流净额 TTM" stroke="#fb923c" strokeWidth={2} dot={{ r: 2, fill: '#fb923c' }} connectNulls />
                        </ComposedChart>
                      </ResponsiveContainer>
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
                        横轴：报告期（YYQn）；左轴：营业总收入 TTM / 营业成本 TTM（亿元，oper_cost 单季滚动四季度之和）；右轴：毛利率 TTM（%）= (营收 TTM − 营业成本 TTM) ÷ 营收 TTM（/api/metrics）
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
                            tickFormatter={formatDateYYMM}
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
                            domain={[0, 'auto']}
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
                <TabsContent value="fee_revenue">
                  {!selectedTsCode ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  ) : feeRevenueLoading ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">加载中...</p>
                    </div>
                  ) : feeRevenueError ? (
                    <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                      <p className="text-red-500">错误: {feeRevenueError}</p>
                    </div>
                  ) : feeRevenueData.length === 0 ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">暂无利润表数据</p>
                    </div>
                  ) : (
                    <div className="w-full h-[28rem] border border-slate-700 rounded-lg p-4 pb-8 bg-slate-900 text-slate-100">
                      <h3 className="text-lg font-semibold mb-1">三费与总营收 — {selectedTsCode}</h3>
                      <p className="text-xs text-slate-400 mb-3">
                        横轴：报告期（YYQn）；左轴：营业总收入 TTM（亿元）；右轴：销售费用 / 管理费用 / 研发费用 TTM（亿元），均为单季递推后滚动四季度之和；字段对应 income_vip 的 total_revenue、sell_exp、admin_exp、rd_exp（/api/metrics）
                      </p>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={feeRevenueData}
                          margin={{ top: 8, right: 44, left: 8, bottom: 52 }}
                          barCategoryGap="18%"
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis
                            dataKey="period"
                            tickFormatter={formatDateYYMM}
                            tick={{ fill: '#94a3b8', fontSize: 10 }}
                            angle={-45}
                            textAnchor="end"
                            height={70}
                            interval={0}
                          />
                          <YAxis
                            yAxisId="left"
                            orientation="left"
                            domain={[0, 'auto']}
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            tickFormatter={(v) => `${Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`}
                            label={{ value: '总营收 TTM（亿元）', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            domain={[0, 'auto']}
                            tick={{ fill: '#cbd5e1', fontSize: 11 }}
                            tickFormatter={(v) => `${Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`}
                            label={{ value: '三费 TTM（亿元）', angle: 90, position: 'insideRight', fill: '#cbd5e1', fontSize: 11 }}
                          />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
                            labelStyle={{ color: '#e2e8f0' }}
                            formatter={(value: any, name?: string | number, props?: any) => {
                              const n = typeof value === 'number' ? value : Number(value);
                              const label = String(name ?? '');
                              if (!Number.isFinite(n)) return ['—', label];
                              const color =
                                typeof props?.color === 'string'
                                  ? props.color
                                  : typeof props?.payload?.fill === 'string'
                                    ? props.payload.fill
                                    : '#e2e8f0';
                              return [<span style={{ color }}>{`${n.toFixed(2)} 亿`}</span>, label];
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
                            fill="#38bdf8"
                            radius={[2, 2, 0, 0]}
                            maxBarSize={32}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="sell_exp_yi"
                            name="销售费用 TTM"
                            stroke="#ef4444"
                            strokeWidth={2}
                            dot={{ r: 2, fill: '#ef4444' }}
                            connectNulls
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="admin_exp_yi"
                            name="管理费用 TTM"
                            stroke="#e2e8f0"
                            strokeWidth={2}
                            dot={{ r: 2, fill: '#e2e8f0' }}
                            connectNulls
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="rd_exp_yi"
                            name="研发费用 TTM"
                            stroke="#eab308"
                            strokeWidth={2}
                            dot={{ r: 2, fill: '#eab308' }}
                            connectNulls
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="growth_summary">
                  {!selectedTsCode ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  ) : growthSummaryLoading ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">加载中...</p>
                    </div>
                  ) : growthSummaryError ? (
                    <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                      <p className="text-red-500">错误: {growthSummaryError}</p>
                    </div>
                  ) : growthSummaryData.length === 0 ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">暂无数据</p>
                    </div>
                  ) : (
                    <div className="w-full h-[24rem] border border-slate-700 rounded-lg p-4 pb-6 bg-slate-900 text-slate-100">
                      <h3 className="text-lg font-semibold mb-1">近五年综合增长率 - {selectedTsCode}</h3>
                      <p className="text-xs text-slate-400 mb-3">
                        指标：市值增长 / 营收增长 / 利润增长 / 净资产增长（CAGR，%）；口径：最近一个财报季 TTM vs 往前 5 年同季度 TTM（/api/metrics）
                      </p>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={growthSummaryData} margin={{ top: 8, right: 16, left: 16, bottom: 24 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 12 }} />
                          <YAxis
                            domain={[0, 'auto']}
                            tick={{ fill: '#cbd5e1', fontSize: 11 }}
                            tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                          />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
                            labelStyle={{ color: '#cbd5e1' }}
                            itemStyle={{ color: '#cbd5e1' }}
                            formatter={(value: any) => {
                              const n = typeof value === 'number' ? value : Number(value);
                              if (!Number.isFinite(n)) return ['—', ''];
                              return [`${n.toFixed(2)}%`, ''];
                            }}
                          />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {growthSummaryData.map((entry, idx) => (
                              <Cell key={`cell-${idx}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="growth_trend">
                  {!selectedTsCode ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  ) : growthTrendLoading ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">加载中...</p>
                    </div>
                  ) : growthTrendError ? (
                    <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                      <p className="text-red-500">错误: {growthTrendError}</p>
                    </div>
                  ) : growthTrendData.length === 0 ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">暂无数据</p>
                    </div>
                  ) : (
                    <div className="w-full h-[28rem] border border-slate-700 rounded-lg p-4 pb-8 bg-slate-900 text-slate-100">
                      <h3 className="text-lg font-semibold mb-1">综合增长率变化趋势 - {selectedTsCode}</h3>
                      <p className="text-xs text-slate-400 mb-3">
                        左轴：市值/总营收/净利润/净资产（亿元）；右轴：对应5年CAGR（%）；序列前段无5年基数时按0处理（/api/metrics）
                      </p>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={growthTrendData} margin={{ top: 8, right: 44, left: 8, bottom: 52 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis
                            dataKey="period"
                            tickFormatter={formatDateYYMM}
                            tick={{ fill: '#94a3b8', fontSize: 10 }}
                            angle={-45}
                            textAnchor="end"
                            height={70}
                            interval={0}
                          />
                          <YAxis
                            yAxisId="left"
                            orientation="left"
                            domain={[0, 'auto']}
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            tickFormatter={(v) => `${Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`}
                            label={{ value: '规模指标（亿元）', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            domain={[0, 'auto']}
                            tick={{ fill: '#cbd5e1', fontSize: 11 }}
                            tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                            label={{ value: '5年CAGR（%）', angle: 90, position: 'insideRight', fill: '#cbd5e1', fontSize: 11 }}
                          />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
                            labelStyle={{ color: '#e2e8f0' }}
                            formatter={(value: any, name?: string | number) => {
                              const n = typeof value === 'number' ? value : Number(value);
                              const label = String(name ?? '');
                              if (!Number.isFinite(n)) return ['—', label];
                              if (label.includes('CAGR')) return [`${n.toFixed(2)}%`, label];
                              return [`${n.toFixed(2)} 亿`, label];
                            }}
                          />
                          <Legend
                            verticalAlign="bottom"
                            wrapperStyle={{ paddingTop: 12 }}
                            formatter={(value) => <span className="text-slate-300 text-sm">{value}</span>}
                          />

                          <Bar yAxisId="left" dataKey="mv_yi" name="总市值(亿元)" fill="#94a3b8" maxBarSize={16} />
                          <Bar yAxisId="left" dataKey="revenue_yi" name="营收TTM(亿元)" fill="#3b82f6" maxBarSize={16} />
                          <Bar yAxisId="left" dataKey="profit_yi" name="归母净利润TTM(亿元)" fill="#ef4444" maxBarSize={16} />
                          <Bar yAxisId="left" dataKey="net_assets_yi" name="归母所有者权益(亿元)" fill="#22c55e" maxBarSize={16} />

                          <Line yAxisId="right" type="monotone" dataKey="mv_growth_pct" name="市值5年CAGR" stroke="#cbd5e1" strokeWidth={2} dot={false} connectNulls />
                          <Line yAxisId="right" type="monotone" dataKey="revenue_growth_pct" name="营收5年CAGR" stroke="#60a5fa" strokeWidth={2} dot={false} connectNulls />
                          <Line yAxisId="right" type="monotone" dataKey="profit_growth_pct" name="利润5年CAGR" stroke="#fb7185" strokeWidth={2.5} dot={false} connectNulls />
                          <Line yAxisId="right" type="monotone" dataKey="net_assets_growth_pct" name="净资产5年CAGR" stroke="#34d399" strokeWidth={2} dot={false} connectNulls />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="balance_structure">
                  {!selectedTsCode ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">请选择股票代码查看数据走势</p>
                    </div>
                  ) : balanceStructureLoading ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">加载中...</p>
                    </div>
                  ) : balanceStructureError ? (
                    <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
                      <p className="text-red-500">错误: {balanceStructureError}</p>
                    </div>
                  ) : balanceStructureData.length === 0 ? (
                    <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                      <p className="text-gray-500">暂无资产负债结构数据</p>
                    </div>
                  ) : (
                    <div className="w-full h-[30rem] border border-slate-700 rounded-lg p-4 pb-10 bg-slate-900 text-slate-100">
                      <h3 className="text-lg font-semibold mb-1">资产负债结构 - {selectedTsCode}</h3>
                      <p className="text-xs text-slate-400 mb-3">
                        报告期：{balanceStructurePeriod ?? '—'}；单位：亿元；蓝色=资产项目，红色=负债项目，黄色=权益项目（/api/metrics）
                      </p>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={balanceStructureData} margin={{ top: 8, right: 16, left: 8, bottom: 76 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis
                            dataKey="name"
                            tick={{ fill: '#cbd5e1', fontSize: 10 }}
                            angle={-35}
                            textAnchor="end"
                            interval={0}
                            height={84}
                          />
                          <YAxis
                            tick={{ fill: '#cbd5e1', fontSize: 11 }}
                            tickFormatter={(v) => `${Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`}
                            label={{ value: '亿元', angle: -90, position: 'insideLeft', fill: '#cbd5e1', fontSize: 11 }}
                          />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
                            labelStyle={{ color: '#cbd5e1' }}
                            itemStyle={{ color: '#cbd5e1' }}
                            formatter={(value: any, name?: string | number) => {
                              const n = typeof value === 'number' ? value : Number(value);
                              const label = String(name ?? '');
                              if (!Number.isFinite(n)) return ['—', label];
                              return [`${n.toFixed(2)} 亿`, label];
                            }}
                          />
                          <Bar dataKey="value" name="规模" radius={[3, 3, 0, 0]} maxBarSize={30}>
                            {balanceStructureData.map((entry, idx) => (
                              <Cell key={`balance-cell-${idx}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
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
