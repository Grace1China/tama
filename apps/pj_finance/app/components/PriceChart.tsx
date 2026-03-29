'use client';

import { useState, useEffect } from 'react';
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
} from 'recharts';

interface PriceData {
  [key: string]: string | number | null;
}

interface BestMatch {
  date: string;
  value: number;
}

interface LeftData1 {
  barField: string; // 柱状图字段名（左侧Y轴）
  barFieldLabel: string; // 柱状图字段的显示名称
  barApiPath: string; // 柱状图数据源的 API 路径
  barDateField: string; // 柱状图数据源的日期字段
  barSource?: string; // 数据源类型（如 'csv', 'parquet'）
  // 可选第二柱图（与 barField 使用同一数据源和日期轴）
  barField2?: string;
  barField2Label?: string;
  barField2Color?: string;
}

interface RightData1 {
  lineField: string; // 折线图字段名（右侧Y轴）
  lineFieldLabel: string; // 折线图字段的显示名称
  lineApiPath: string; // 折线图数据源的 API 路径
  lineDateField: string; // 折线图数据源的日期字段
  lineSource?: string; // 数据源类型（如 'csv', 'parquet'）
}

interface DualLineData {
  line1Field: string;
  line1Label: string;
  line2Field: string;
  line2Label: string;
  line3Field?: string;
  line3Label?: string;
  apiPath: string;
  dateField: string;
}

interface PriceChartProps {
  tsCode?: string;
  apiPath?: string;
  dateField?: string; // 日期字段名，默认为 'end_date'
  // 柱状图数据配置（左侧Y轴）
  leftData1?: LeftData1;
  // 向后兼容：保留旧的单独参数
  barField?: string; // 柱状图字段名（左侧Y轴）
  barFieldLabel?: string; // 柱状图字段的显示名称
  barApiPath?: string; // 柱状图数据源的 API 路径
  barDateField?: string; // 柱状图数据源的日期字段
  // 向后兼容：如果只提供了 valueField，则作为折线图
  valueField?: string;
  valueFieldLabel?: string;
  // 折线图数据配置（右侧Y轴）
  rightData1?: RightData1;
  // 向后兼容：保留旧的单独参数
  lineField?: string;
  lineFieldLabel?: string;
  lineApiPath?: string;
  lineDateField?: string;
  // 双曲线模式：两条线共用一个Y轴
  dualLineData?: DualLineData;
  // 交换Y轴：柱状图在右、折线图在左
  swapYAxes?: boolean;
}

export default function PriceChart({ 
  tsCode, 
  apiPath = '/api/parq/daily_pro_bar',
  dateField = 'end_date',
  leftData1,
  barField,
  barFieldLabel,
  barApiPath,
  barDateField,
  valueField,
  valueFieldLabel,
  rightData1,
  dualLineData,
  swapYAxes = false,
}: PriceChartProps) {
  const [data, setData] = useState<PriceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const MIN_DISPLAY_DATE = 20140101; // 仅显示近10年：从 2014-01-01 起

  // 双曲线模式
  const isDualLineMode = !!dualLineData;

  // 优先使用 leftData1，否则使用向后兼容的单独参数
  const effectiveBarField = isDualLineMode ? undefined : (leftData1?.barField || barField);
  const effectiveBarLabel = isDualLineMode ? undefined : (leftData1?.barFieldLabel || barFieldLabel);
  const effectiveBarApiPath = isDualLineMode ? undefined : (leftData1?.barApiPath || barApiPath || apiPath);
  const effectiveBarDateField = isDualLineMode ? dualLineData?.dateField : (leftData1?.barDateField || barDateField || dateField);
  const effectiveBarSource = isDualLineMode ? undefined : leftData1?.barSource;
  const effectiveBarField2 = isDualLineMode ? undefined : leftData1?.barField2;
  const effectiveBarLabel2 = isDualLineMode ? undefined : leftData1?.barField2Label;
  const effectiveBarColor2 = isDualLineMode ? undefined : leftData1?.barField2Color;

  // 优先使用 rightData1，否则使用向后兼容的单独参数，最后使用 valueField
  const effectiveLineField = isDualLineMode ? undefined : rightData1?.lineField;
  const effectiveLineLabel = isDualLineMode ? undefined : rightData1?.lineFieldLabel;
  const effectiveLineApiPath = isDualLineMode ? undefined : rightData1?.lineApiPath;
  const effectiveLineDateField = isDualLineMode ? undefined : rightData1?.lineDateField;
  const effectiveLineSource = isDualLineMode ? undefined : rightData1?.lineSource;
  
  // 统一的日期字段（用于 X 轴）
  const unifiedDateField = isDualLineMode ? dualLineData?.dateField : effectiveBarDateField;

  // 标准化日期格式为 YYYYMMDD
  const normalizeDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const raw = String(dateStr).trim();
    if (!raw) return '';

    // YYYYMMDD -> YYYY-MM-DD
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    const normalized = m ? `${m[1]}-${m[2]}-${m[3]}` : raw;

    const dt = new Date(normalized.replace(/-/g, '/'));
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${y}${mm}${dd}`;
  };

  useEffect(() => {
    // 双曲线模式
    if (isDualLineMode && dualLineData) {
      if (!tsCode) {
        setData([]);
        return;
      }
      const fetchDualLineData = async () => {
        setLoading(true);
        setError(null);
        try {
          const url = `${dualLineData.apiPath}?ts_code=${encodeURIComponent(tsCode)}&page=1&size=10000&sortField=${dualLineData.dateField}&sortDir=asc`;
          const res = await fetch(url);
          const result = await res.json();
          const rawData = result.data || [];
          
          if (rawData.length === 0) {
            setData([]);
            return;
          }
          
          // 收集所有日期
          const allDates: number[] = [];
          rawData.forEach((item: any) => {
            const dateValue = item[dualLineData.dateField];
            const normalizedDate = normalizeDate(dateValue);
            if (normalizedDate) {
              allDates.push(parseInt(normalizedDate));
            }
          });
          
          if (allDates.length === 0) {
            setData([]);
            return;
          }
          
          const minDate = Math.min(...allDates);
          const maxDate = Math.max(...allDates);
          
          // 生成季度初日期列表
          const quarterDates: string[] = [];
          const minYear = Math.floor(minDate / 10000);
          const maxYear = Math.floor(maxDate / 10000);
          for (let year = minYear; year <= maxYear; year++) {
            for (const month of [1, 4, 7, 10]) {
              const quarterStartDate = `${year}${String(month).padStart(2, '0')}01`;
              if (parseInt(quarterStartDate) >= MIN_DISPLAY_DATE) quarterDates.push(quarterStartDate);
            }
          }
          
          // 构建数据映射
          const line1Map = new Map<string, number>();
          const line2Map = new Map<string, number>();
          const line3Map = new Map<string, number>();
          rawData.forEach((item: any) => {
            const dateValue = item[dualLineData.dateField];
            const normalizedDate = normalizeDate(dateValue);
            if (normalizedDate) {
              const value1 = Number(item[dualLineData.line1Field]);
              const value2 = Number(item[dualLineData.line2Field]);
              const value3 = dualLineData.line3Field ? Number(item[dualLineData.line3Field]) : NaN;
              if (!isNaN(value1)) line1Map.set(normalizedDate, value1);
              if (!isNaN(value2)) line2Map.set(normalizedDate, value2);
              if (dualLineData.line3Field && !isNaN(value3)) line3Map.set(normalizedDate, value3);
            }
          });
          
          // 为每个季度初日期查找对应的数据
          const chartData: PriceData[] = quarterDates.map(quarterDate => {
            const dataPoint: PriceData = {
              [dualLineData.dateField]: quarterDate,
            };
            
            const quarterYear = parseInt(quarterDate.slice(0, 4));
            const quarterMonth = parseInt(quarterDate.slice(4, 6));
            const quarterEndMonth = quarterMonth + 2;
            const lastDay = new Date(quarterYear, quarterEndMonth, 0).getDate();
            const quarterEndDate = `${quarterYear}${String(quarterEndMonth).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;
            
            const quarterStartNum = parseInt(quarterDate);
            const quarterEndNum = parseInt(quarterEndDate);
            
            // 查找该季度内的数据（两条线使用同一日期）
            let line1Value: number | undefined;
            let line2Value: number | undefined;
            let line3Value: number | undefined;
            let foundDate: string | undefined;
            
            // 先找到该季度内最晚的日期
            Array.from(line1Map.keys()).forEach((date) => {
              const dateNum = parseInt(date);
              if (dateNum >= quarterStartNum && dateNum <= quarterEndNum) {
                if (!foundDate || dateNum > parseInt(foundDate)) {
                  foundDate = date;
                }
              }
            });
            
            // 使用找到的日期获取两条线的值
            if (foundDate) {
              line1Value = line1Map.get(foundDate);
              line2Value = line2Map.get(foundDate);
              line3Value = dualLineData.line3Field ? line3Map.get(foundDate) : undefined;
            }
            
            dataPoint[dualLineData.line1Field] = line1Value ?? null;
            dataPoint[dualLineData.line2Field] = line2Value ?? null;
            if (dualLineData.line3Field) {
              dataPoint[dualLineData.line3Field] = line3Value ?? null;
            }
            
            return dataPoint;
          });
          
          setData(chartData);
        } catch (err) {
          console.error('获取数据失败:', err);
          setError(err instanceof Error ? err.message : '获取数据失败');
          setData([]);
        } finally {
          setLoading(false);
        }
      };
      fetchDualLineData();
      return;
    }

    // 原有的 bar+line 模式
    if (!tsCode || (!effectiveBarField && !effectiveBarField2 && !effectiveLineField)) {
      setData([]);
      return;
    }

    const fetchPriceData = async () => {
      setLoading(true);
      setError(null);
      try {
        const promises: Promise<any>[] = [];
        
        // 获取柱状图数据
        if (effectiveBarField && effectiveBarApiPath) {
          let barUrl = `${effectiveBarApiPath}?ts_code=${encodeURIComponent(tsCode)}&page=1&size=10000&sortField=${effectiveBarDateField}&sortDir=asc&getAllDates=true`;
          // 如果指定了数据源类型，添加到查询参数
          if (effectiveBarSource) {
            barUrl += `&source=${encodeURIComponent(effectiveBarSource)}`;
          }
          promises.push(fetch(barUrl).then(res => res.json()).then(result => ({
            type: 'bar',
            data: result.data || [],
            dateField: effectiveBarDateField,
            valueField: effectiveBarField
          })));
        }
        // 获取折线图数据
        if (effectiveLineField && effectiveLineApiPath) {
          let lineUrl = `${effectiveLineApiPath}?ts_code=${encodeURIComponent(tsCode)}&page=1&size=10000&sortField=${effectiveLineDateField}&sortDir=asc&getAllDates=true`;
          // 如果指定了数据源类型，添加到查询参数
          if (effectiveLineSource) {
            lineUrl += `&source=${encodeURIComponent(effectiveLineSource)}`;
          }
          promises.push(fetch(lineUrl).then(res => res.json()).then(result => ({
            type: 'line',
            data: result.data || [],
            dateField: effectiveLineDateField,
            valueField: effectiveLineField
          })));
        }
        
        const results = await Promise.all(promises);
        
        // 提取数据
        const barData = results.find((r: any) => r.type === 'bar');
        const lineData = results.find((r: any) => r.type === 'line');
        
        if (!barData && !lineData) {
          setData([]);
          return;
        }
        
        // 收集所有日期并找到最小最大值
        const allDates: number[] = [];
        
        if (barData) {
          barData.data.forEach((item: any) => {
            const dateValue = item[barData.dateField];
            const normalizedDate = normalizeDate(dateValue);
            if (normalizedDate) {
              allDates.push(parseInt(normalizedDate));
            }
          });
        }
        
        if (lineData) {
          lineData.data.forEach((item: any) => {
            const dateValue = item[lineData.dateField];
            const normalizedDate = normalizeDate(dateValue);
            if (normalizedDate) {
              allDates.push(parseInt(normalizedDate));
            }
          });
        }
        
        if (allDates.length === 0) {
          setData([]);
          return;
        }
        
        // 找到日期范围
        const minDate = Math.min(...allDates);
        const maxDate = Math.max(...allDates);
        
        // 生成季度初日期列表（每年固定 4 个季度：0101/0401/0701/1001）
        const quarterDates: string[] = [];
        const minYear = Math.floor(minDate / 10000);
        const maxYear = Math.floor(maxDate / 10000);
        for (let year = minYear; year <= maxYear; year++) {
          for (const month of [1, 4, 7, 10]) {
            const quarterStartDate = `${year}${String(month).padStart(2, '0')}01`;
            if (parseInt(quarterStartDate) >= MIN_DISPLAY_DATE) quarterDates.push(quarterStartDate);
          }
        }

        
        // 构建数据映射：bar数据按end_date索引，line数据按trade_date索引
        const barMap = new Map<string, number>();
        if (barData) {
          barData.data.forEach((item: any) => {
            const dateValue = item[barData.dateField];
            const normalizedDate = normalizeDate(dateValue);
            if (normalizedDate) {
              if (effectiveBarField) {
                const value = Number(item[effectiveBarField]);
                if (!isNaN(value)) barMap.set(normalizedDate, value);
              }
            }
          });
        }
        
        const bar2Map = new Map<string, number>();
        if (barData && effectiveBarField2) {
          barData.data.forEach((item: any) => {
            const dateValue = item[barData.dateField];
            const normalizedDate = normalizeDate(dateValue);
            if (normalizedDate) {
              const value2 = Number(item[effectiveBarField2]);
              if (!isNaN(value2)) bar2Map.set(normalizedDate, value2);
            }
          });
        }
        
        const lineMap = new Map<string, number>();
        if (lineData) {
          lineData.data.forEach((item: any) => {
            const dateValue = item[lineData.dateField];
            const normalizedDate = normalizeDate(dateValue);
            if (normalizedDate && effectiveLineField) {
              const value = Number(item[lineData.valueField]);
              if (!isNaN(value)) {
                lineMap.set(normalizedDate, value);
              }
            }
          });
        }
        
        // 为每个季度初日期查找对应的数据
        const chartData: PriceData[] = quarterDates.map(quarterDate => {
          const dataPoint: PriceData = {
            [unifiedDateField]: quarterDate,
          };
          
          // 计算季度末日期（季度末月最后一天）
          const quarterYear = parseInt(quarterDate.slice(0, 4));
          const quarterMonth = parseInt(quarterDate.slice(4, 6));
          const quarterEndMonth = quarterMonth + 2;
          const lastDay = new Date(quarterYear, quarterEndMonth, 0).getDate();
          const quarterEndDate = `${quarterYear}${String(quarterEndMonth).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;
          
          const quarterStartNum = parseInt(quarterDate);
          const quarterEndNum = parseInt(quarterEndDate);
          
          // 查找该季度内最近的bar数据（end_date <= 季度末）
          let barValue: number | undefined;
          let barDate: string | undefined;
          Array.from(barMap.entries()).forEach(([date, value]) => {
            const dateNum = parseInt(date);
            if (dateNum >= quarterStartNum && dateNum <= quarterEndNum) {
              if (!barDate || dateNum > parseInt(barDate)) {
                barDate = date;
                barValue = value;
              }
            }
          });

          let barValue2: number | undefined;
          let barDate2: string | undefined;
          Array.from(bar2Map.entries()).forEach(([date, value]) => {
            const dateNum = parseInt(date);
            if (dateNum >= quarterStartNum && dateNum <= quarterEndNum) {
              if (!barDate2 || dateNum > parseInt(barDate2)) {
                barDate2 = date;
                barValue2 = value;
              }
            }
          });
          
          // 查找该季度内最近的line数据（trade_date <= 季度末）
          let lineValue: number | undefined;
          let lineDate: string | undefined;
          Array.from(lineMap.entries()).forEach(([date, value]) => {
            const dateNum = parseInt(date);
            if (dateNum >= quarterStartNum && dateNum <= quarterEndNum) {
              if (!lineDate || dateNum > parseInt(lineDate)) {
                lineDate = date;
                lineValue = value;
              }
            }
          });
          
          if (effectiveBarField) dataPoint[effectiveBarField] = barValue ?? null;
          if (effectiveBarField2) dataPoint[effectiveBarField2] = barValue2 ?? null;
          if (effectiveLineField) dataPoint[effectiveLineField] = lineValue ?? null;
          
          return dataPoint;
        });
        setData(chartData);
      } catch (err) {
        console.error('获取数据失败:', err);
        setError(err instanceof Error ? err.message : '获取数据失败');
        setData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPriceData();
  }, [tsCode, apiPath, dateField, effectiveBarField, effectiveBarApiPath, effectiveBarDateField, effectiveBarSource, effectiveLineField, effectiveLineApiPath, effectiveLineDateField, effectiveLineSource, unifiedDateField, isDualLineMode, dualLineData]);

  // 格式化日期显示：统一显示为 YY-MM 格式
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    let year = '';
    let month = '';
    // 如果是 YYYYMMDD 格式
    if (/^\d{8}$/.test(dateStr)) {
      year = dateStr.slice(2, 4); // 取年份后两位
      month = dateStr.slice(4, 6);
    }
    // 如果是 YYYY-MM-DD 格式
    else if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      if (parts.length >= 2) {
        year = parts[0].slice(2, 4); // 取年份后两位
        month = parts[1];
      }
    }
    // 尝试解析其他格式
    else {
      const match = dateStr.match(/(\d{4})[-\/]?(\d{2})/);
      if (match) {
        year = match[1].slice(2, 4);
        month = match[2];
      }
    }
    if (year && month) {
      return `${year}-${month}`;
    }
    return dateStr;
  };

  // 格式化数值显示
  const formatValue = (value: number) => {
    // 根据数值大小选择合适的格式
    if (Math.abs(value) >= 100000000) {
      return `${(value / 100000000).toFixed(2)}亿`;
    } else if (Math.abs(value) >= 10000) {
      return `${(value / 10000).toFixed(2)}万`;
    } else {
      return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  };

  // 右轴（如 total_mv，单位通常为「万元」）统一显示为「亿」
  const formatRightAxisValue = (value: number) => {
    // 1 亿 = 10000 万
    return `${(value / 10000).toFixed(2)}亿`;
  };

  if (!tsCode) {
    return (
      <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
        <p className="text-gray-500">请选择股票代码查看数据走势</p>
      </div>
    );
  }

  if (!isDualLineMode && !effectiveBarField && !effectiveBarField2 && !effectiveLineField) {
    return (
      <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
        <p className="text-gray-500">请选择要展示的列</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-96 flex items-center justify-center border border-red-200 rounded-lg bg-red-50">
        <p className="text-red-500">错误: {error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
        <p className="text-gray-500">暂无数据</p>
      </div>
    );
  }

  // 确保使用正确的日期字段
  const xAxisDataKey = isDualLineMode ? (dualLineData?.dateField || 'end_date') : (unifiedDateField || dateField || 'end_date');
  const barLabel = effectiveBarLabel || effectiveBarField || '';
  const lineLabel = effectiveLineLabel || effectiveLineField || '';

  // 双曲线模式渲染
  if (isDualLineMode && dualLineData) {
    return (
      <div className="w-full h-[28rem] border border-gray-200 rounded-lg p-4 pb-6 bg-white">
        <h3 className="text-lg font-semibold mb-4">
          数据走势图 - {tsCode} ({dualLineData.line1Label} / {dualLineData.line2Label}{dualLineData.line3Label ? ` / ${dualLineData.line3Label}` : ''})
        </h3>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 28 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey={xAxisDataKey}
              tickFormatter={formatDate}
              angle={-90}
              textAnchor="end"
              height={60}
              interval={0}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              yAxisId="left"
              orientation="left"
              domain={['auto', 'auto']}
              tickFormatter={formatValue}
            />
            <Tooltip
              formatter={(value: any) => {
                const numValue = typeof value === 'number' ? value : Number(value);
                if (isNaN(numValue)) return '';
                return formatValue(numValue);
              }}
              labelFormatter={(label) => `日期: ${formatDate(String(label))}`}
            />
            <Legend verticalAlign="bottom" height={24} wrapperStyle={{ paddingTop: 8 }} />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey={dualLineData.line1Field}
              stroke="#8884d8"
              strokeWidth={2}
              dot={{ r: 3, fill: '#8884d8' }}
              activeDot={{ r: 5 }}
              name={dualLineData.line1Label}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey={dualLineData.line2Field}
              stroke="#82ca9d"
              strokeWidth={2}
              dot={{ r: 3, fill: '#82ca9d' }}
              activeDot={{ r: 5 }}
              name={dualLineData.line2Label}
            />
            {dualLineData.line3Field && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey={dualLineData.line3Field}
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 3, fill: '#ef4444' }}
                activeDot={{ r: 5 }}
                name={dualLineData.line3Label || dualLineData.line3Field}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // 原有的 bar+line 模式渲染
  return (
    <div className="w-full h-[28rem] border border-gray-200 rounded-lg p-4 pb-6 bg-white">
      <h3 className="text-lg font-semibold mb-4">
        数据走势图 - {tsCode}
        {effectiveBarField && ` (柱状图: ${barLabel})`}
        {effectiveLineField && ` (折线图: ${lineLabel})`}
      </h3>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 28 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey={xAxisDataKey}
            tickFormatter={formatDate}
            angle={-90}
            textAnchor="end"
            height={60}
            interval={0}
            tick={{ fontSize: 11 }}
          />
          {/* Y轴 - 柱状图 */}
          {(effectiveBarField || effectiveBarField2) && (
            <YAxis
              yAxisId="bar"
              orientation={swapYAxes ? 'right' : 'left'}
              domain={['auto', 'auto']}
              tickFormatter={formatValue}
            />
          )}
          {/* Y轴 - 折线图 */}
          {effectiveLineField && (
            <YAxis
              yAxisId="line"
              orientation={swapYAxes ? 'left' : 'right'}
              domain={['auto', 'auto']}
              tickFormatter={formatRightAxisValue}
            />
          )}
          <Tooltip
            formatter={(value: any, name?: string | number, props?: any) => {
              const numValue = typeof value === 'number' ? value : Number(value);
              if (isNaN(numValue)) return '';
              const key = props?.dataKey as string | undefined;
              if (key && effectiveLineField && key === effectiveLineField) return formatRightAxisValue(numValue);
              return formatValue(numValue);
            }}
            labelFormatter={(label) => `日期: ${formatDate(String(label))}`}
          />
          <Legend verticalAlign="bottom" height={24} wrapperStyle={{ paddingTop: 8 }} />
          {/* 柱状图 */}
          {effectiveBarField && (
            <Bar
              yAxisId="bar"
              dataKey={effectiveBarField}
              fill="#8884d8"
              name={barLabel}
            />
          )}
          {effectiveBarField2 && (
            <Bar
              yAxisId="bar"
              dataKey={effectiveBarField2}
              fill={effectiveBarColor2 || '#ef4444'}
              name={effectiveBarLabel2 || effectiveBarField2}
            />
          )}
          {/* 折线图 */}
          {effectiveLineField && (
            <Line
              yAxisId="line"
              type="monotone"
              dataKey={effectiveLineField}
              stroke="#82ca9d"
              strokeWidth={2}
              dot={{ r: 4, fill: '#82ca9d' }}
              activeDot={{ r: 6 }}
              name={lineLabel}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
