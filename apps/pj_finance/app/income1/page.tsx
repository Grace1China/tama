'use client';

import { useState, useRef, useEffect } from 'react';
import DataGrid from '../components/DataGrid';
import PriceChart from '../components/PriceChart';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

interface StockInfo {
  name: string;
  area: string;
  industry: string;
}

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

export default function Income1Page() {
  const [selectedTsCode, setSelectedTsCode] = useState<string>('');
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
  const [chartTab, setChartTab] = useState<string>('rev_mv');
  const { width, containerRef, mounted } = useContainerWidth();

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

  const INCOME1_YI_FIELDS = new Set(['total_revenue', 'q_total_revenue']);

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
                </TabsList>
                <TabsContent value="rev_mv">
                  {selectedTsCode ? (
                    <PriceChart
                      tsCode={selectedTsCode}
                      leftData1={{
                        barField: 'q_total_revenue',
                        barFieldLabel: '单季营业总收入',
                        barApiPath: '/api/parq/income1',
                        barDateField: 'end_date',
                      }}
                      rightData1={{
                        lineField: 'total_mv',
                        lineFieldLabel: '总市值（万元）',
                        lineApiPath: '/api/csv/indicator',
                        lineDateField: 'trade_date',
                        lineSource: 'csv',
                      }}
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
              </Tabs>
            </div>
          </div>
        )}
      </div>

      {/* 数据表格 */}
      {chartTab === 'rev_cashflow' ? (
        <div className="w-full">
          <DataGrid
            category="cashflowIncome"
            title="滚动营收与现金流"
            useServerPagination={true}
            apiPath="/api/parq/cashflowIncome"
            extraQueryParams={selectedTsCode ? { ts_code: selectedTsCode } : {}}
            defaultHiddenFields={CASHFLOW_TAB_DEFAULT_HIDDEN}
            yiFields={new Set(['q_total_revenue', 'q_n_income', 'q_c_inf_fr_operate_a', 'ttm_total_revenue', 'ttm_n_income', 'ttm_c_inf_fr_operate_a'])}
          />
        </div>
      ) : (
        <Tabs defaultValue="income1" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="income1">利润表</TabsTrigger>
            <TabsTrigger value="daily_indicators">每日指标</TabsTrigger>
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
                category="indicator"
                title="每日指标（按季度分组）"
                useServerPagination={true}
                apiPath={"/api/csv/indicator"}
                extraQueryParams={{ ts_code: selectedTsCode, source: 'csv' }}
              />
            ) : (
              <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                <p className="text-gray-500">请先输入股票代码</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
