'use client';

import { useState, useEffect } from 'react';
import { apiBase } from '@/lib/apiBase';
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
  [key: string]: string | number;
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
}

interface RightData1 {
  lineField: string; // 折线图字段名（右侧Y轴）
  lineFieldLabel: string; // 折线图字段的显示名称
  lineApiPath: string; // 折线图数据源的 API 路径
  lineDateField: string; // 折线图数据源的日期字段
  lineSource?: string; // 数据源类型（如 'csv', 'parquet'）
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
}

export default function PriceChart({ 
  tsCode, 
  apiPath = `${apiBase}/api/parq/indicator`,
  dateField = 'end_date',
  leftData1,
  barField,
  barFieldLabel,
  barApiPath,
  barDateField,
  valueField,
  valueFieldLabel,
  rightData1,
}: PriceChartProps) {
  const [data, setData] = useState<PriceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 优先使用 leftData1，否则使用向后兼容的单独参数
  const effectiveBarField = leftData1?.barField || barField;
  const effectiveBarLabel = leftData1?.barFieldLabel || barFieldLabel;
  const effectiveBarApiPath = leftData1?.barApiPath || barApiPath || apiPath;
  const effectiveBarDateField = leftData1?.barDateField || barDateField || dateField;
  const effectiveBarSource = leftData1?.barSource;

  // 优先使用 rightData1，否则使用向后兼容的单独参数，最后使用 valueField
  const effectiveLineField = rightData1?.lineField
  const effectiveLineLabel = rightData1?.lineFieldLabel
  const effectiveLineApiPath = rightData1?.lineApiPath
  const effectiveLineDateField = rightData1?.lineDateField 
  const effectiveLineSource = rightData1?.lineSource;
  
  // 统一的日期字段（用于 X 轴）
  const unifiedDateField = effectiveBarDateField;

  // 标准化日期格式为 YYYYMMDD
  const normalizeDate = (dateStr: string): string => {
    if (!dateStr) return '';
     if (/^\d{8}$/.test(dateStr)) {
      dateStr = dateStr.substring(0,4)+'-'+dateStr.substring(4,6)+'-'+dateStr.substring(6,8)
    }

    let dt = new Date(dateStr)
    return `${dt.getFullYear()}${('0'+dt.getMonth()).substring(0,2)}${('0'+dt.getDay()).substring(0,2)}`
    // new Date(dateStr).getFullYear()
    // // 如果是 YYYYMMDD 格式，直接返回
   
    // // 如果是 YYYY-MM-DD 格式，转换为 YYYYMMDD
    // if (dateStr.includes('-')) {
    //   return dateStr.replace(/-/g, '');
    // }
    // // 如果是其他格式，尝试提取日期部分
    // const match = dateStr.match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
    // if (match) {
    //   return `${match[1]}${match[2]}${match[3]}`;
    // }
    // return dateStr;
  };

  useEffect(() => {
    if (!tsCode || (!effectiveBarField && !effectiveLineField)) {
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
        
        // 生成季度初日期列表
        const quarterDates: string[] = [];
        const minYear = Math.floor(minDate / 10000);
        const minMonth = Math.floor((minDate % 10000) / 100);
        const maxYear = Math.floor(maxDate / 10000);
        const maxMonth = Math.floor((maxDate % 10000) / 100);
        console.log(minYear,minMonth,maxYear,maxMonth)
        // 从最小日期的季度初开始，到最大日期的季度初
        for (let year = minYear; year <= maxYear; year++) {
          const startMonth = year === minYear ? Math.floor((minMonth - 1) / 3) * 3 + 1 : 1;
          const endMonth = year === maxYear ? Math.floor((maxMonth - 1) / 3) * 3 + 1 : 10;
          
          for (let month = startMonth; month <= endMonth; month += 3) {
            const quarterStartDate = `${year}${String(month).padStart(2, '0')}01`;
            quarterDates.push(quarterStartDate);
          }
        }
        console.log(quarterDates)

        
        // 构建数据映射：bar数据按end_date索引，line数据按trade_date索引
        const barMap = new Map<string, number>();
        if (barData) {
          barData.data.forEach((item: any) => {
            const dateValue = item[barData.dateField];
            const normalizedDate = normalizeDate(dateValue);
            if (normalizedDate && effectiveBarField) {
              const value = Number(item[effectiveBarField]);
              if (!isNaN(value)) {
                barMap.set(normalizedDate, value);
              }
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
        console.log('quarterDates')
        
        // 为每个季度初日期查找对应的数据
        const chartData: PriceData[] = quarterDates.map(quarterDate => {
          const dataPoint: PriceData = {
            [unifiedDateField]: quarterDate,
          };
          
          // 计算季度末日期
          const quarterYear = parseInt(quarterDate.slice(0, 4));
          const quarterMonth = parseInt(quarterDate.slice(4, 6));
          const quarterEndMonth = quarterMonth + 2;
          const quarterEndDate = quarterEndMonth === 3 || quarterEndMonth === 6 || quarterEndMonth === 9 || quarterEndMonth === 12
            ? `${quarterYear}${String(quarterEndMonth).padStart(2, '0')}${quarterEndMonth === 3 || quarterEndMonth === 12 ? '31' : '30'}`
            : `${quarterYear}${String(quarterEndMonth).padStart(2, '0')}30`;
          
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
          
          if (effectiveBarField && barValue !== undefined) {
            dataPoint[effectiveBarField] = barValue;
          }
          if (effectiveLineField && lineValue !== undefined) {
            dataPoint[effectiveLineField] = lineValue;
          }
          
          return dataPoint;
        }).filter(item => {
          // 至少需要一个有效数值
          const hasBarValue = effectiveBarField && !isNaN(Number(item[effectiveBarField]));
          const hasLineValue = effectiveLineField && !isNaN(Number(item[effectiveLineField]));
          return hasBarValue || hasLineValue;
        });
        console.log(chartData)
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
  }, [tsCode, apiPath, dateField, effectiveBarField, effectiveBarApiPath, effectiveBarDateField, effectiveBarSource, effectiveLineField, effectiveLineApiPath, effectiveLineDateField, effectiveLineSource, unifiedDateField]);

  // 格式化日期显示 - 只显示年份后两位
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    let year = '';
    // 如果是 YYYYMMDD 格式
    if (/^\d{8}$/.test(dateStr)) {
      year = dateStr.slice(2, 8); // 取年份后两位
    }
    // 如果是 YYYY-MM-DD 格式
    else if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      if (parts.length >= 1 && parts[0].length === 4) {
        year = parts[0].slice(2, 8); // 取年份后两位
      }
    }
    // 尝试解析其他格式
    else {
      const match = dateStr.match(/(\d{4})/);
      if (match) {
        year = match[1].slice(2, 8);
      }
    }
    return year || dateStr;
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

  if (!tsCode) {
    return (
      <div className="w-full h-96 flex items-center justify-center border border-gray-200 rounded-lg bg-gray-50">
        <p className="text-gray-500">请选择股票代码查看数据走势</p>
      </div>
    );
  }

  if (!effectiveBarField && !effectiveLineField) {
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
  const xAxisDataKey = unifiedDateField || dateField || 'end_date';
  const barLabel = effectiveBarLabel || effectiveBarField || '';
  const lineLabel = effectiveLineLabel || effectiveLineField || '';

  return (
    <div className="w-full h-96 border border-gray-200 rounded-lg p-4 bg-white">
      <h3 className="text-lg font-semibold mb-4">
        数据走势图 - {tsCode}
        {effectiveBarField && ` (柱状图: ${barLabel})`}
        {effectiveLineField && ` (折线图: ${lineLabel})`}
      </h3>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey={xAxisDataKey}
            tickFormatter={formatDate}
            angle={-45}
            textAnchor="end"
            height={80}
            interval="preserveStartEnd"
          />
          {/* 左侧Y轴 - 柱状图 */}
          {effectiveBarField && (
            <YAxis
              yAxisId="left"
              orientation="left"
              domain={['auto', 'auto']}
              tickFormatter={formatValue}
            />
          )}
          {/* 右侧Y轴 - 折线图 */}
          {effectiveLineField && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={['auto', 'auto']}
              tickFormatter={formatValue}
            />
          )}
          <Tooltip
            formatter={(value: any, name?: string | number) => {
              const numValue = typeof value === 'number' ? value : Number(value);
              return isNaN(numValue) ? '' : formatValue(numValue);
            }}
            labelFormatter={(label) => `日期: ${formatDate(String(label))}`}
          />
          <Legend />
          {/* 柱状图 - 左侧Y轴 */}
          {effectiveBarField && (
            <Bar
              yAxisId="left"
              dataKey={effectiveBarField}
              fill="#8884d8"
              name={barLabel}
            />
          )}
          {/* 折线图 - 右侧Y轴 */}
          {effectiveLineField && (
            <Line
              yAxisId="right"
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
