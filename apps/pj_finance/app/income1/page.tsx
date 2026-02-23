'use client';

import { useState, useRef, useEffect } from 'react';
import DataGrid from '../components/DataGrid';
import PriceChart from '../components/PriceChart';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import RGL from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = RGL.WidthProvider(RGL.Responsive);
type Layout = RGL.Layout;

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

export default function Income1Page() {
  const [selectedTsCode, setSelectedTsCode] = useState<string>('');
  const { width, containerRef, mounted } = useContainerWidth();

  const layout = [
    { i: 'price-chart', x: 0, y: 0, w: 12, h: 6, minW: 6, minH: 4 },
  ];

  const onLayoutChange = (newLayout: Layout[]) => {
    // 可以在这里保存布局到本地存储或后端
    console.log('Layout changed:', newLayout);
  };

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
        <div className="text-sm text-gray-600">
          图表显示：柱状图（营业总收入，左侧Y轴）和折线图（总市值，右侧Y轴）
        </div>
      </div>

      {/* 可拖拽布局区域 */}
      <div ref={containerRef as any} className="bg-gray-50 p-4 rounded-lg w-full" style={{ width: '100%' }}>
        {mounted && width > 0 && (
          <ResponsiveGridLayout
            className="layout"
            width={width}
            layouts={{ lg: layout }}
            onLayoutChange={(layout, layouts) => onLayoutChange(layout)}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={30}
            margin={[10, 10]}
            containerPadding={[10, 10]}
          >
          <div key="price-chart" className="bg-white border border-gray-200 rounded-lg overflow-hidden h-full">
            <div className="drag-handle bg-gray-100 px-4 py-2 border-b border-gray-200 cursor-move flex items-center">
              <span className="text-sm font-medium text-gray-700">📊 数据走势图</span>
              <span className="text-xs text-gray-500 ml-2">(可拖拽调整大小)</span>
            </div>
            <div className="p-4 h-[calc(100%-50px)] overflow-auto">
              {selectedTsCode ? (
                <PriceChart
                  tsCode={selectedTsCode}
                  leftData1={{
                    barField: "total_revenue",
                    barFieldLabel: "营业总收入",
                    barApiPath: "/api/parq/income1",
                    barDateField: "end_date"
                  }}
                  rightData1={{
                    lineField: "total_mv",
                    lineFieldLabel: "总市值（万元）",
                    lineApiPath: "/api/csv/indicator",
                    lineDateField: "trade_date",
                    lineSource: "csv"
                  }}
                />
              ) : (
                <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
                  <p className="text-gray-500">请选择股票代码查看数据走势</p>
                </div>
              )}
            </div>
          </div>
          </ResponsiveGridLayout>
        )}
      </div>

      {/* 数据表格 */}
      <Tabs defaultValue="income1" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="income1">利润表1</TabsTrigger>
          <TabsTrigger value="daily_indicators">每日指标</TabsTrigger>
        </TabsList>
        <TabsContent value="income1">
          <DataGrid
            category="income1"
            title="利润表1"
            useServerPagination={true}
            apiPath="/api/parq/income1"
            extraQueryParams={selectedTsCode ? { ts_code: selectedTsCode } : {}}
          />
        </TabsContent>
        <TabsContent value="daily_indicators">
          {selectedTsCode ? (
            <DataGrid
              category="indicator"
              title="每日指标（按季度分组）"
              useServerPagination={true}
              apiPath="/api/csv/indicator"
              extraQueryParams={{ ts_code: selectedTsCode, source: 'csv' }}
            />
          ) : (
            <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
              <p className="text-gray-500">请先输入股票代码</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
