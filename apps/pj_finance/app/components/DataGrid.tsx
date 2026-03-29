'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { AgGridReact as AgGridReactType } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { GridReadyEvent, IDatasource } from 'ag-grid-community';
import { ArrowDown, ArrowUp, Download, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface CSVData {
  category: string;
  filename: string;
  headers: string[]; // 中文列名
  originalHeaders?: string[]; // 英文原始列名（可选）
  data: Record<string, any>[];
  totalRows: number;
}

interface DataGridProps {
  category: string;
  title: string;
  // 是否使用服务端分页 (infinite row model)
  useServerPagination?: boolean;
  // 自定义 API 路径，默认使用 /api/csv/{category}
  apiPath?: string;
  // 额外的查询参数
  extraQueryParams?: Record<string, string | boolean>;
  // 将指定列放到某列后面，如 { anchor: 'end_date', field: 'total_revenue' }
  columnAfter?: { anchor: string; field: string };
  /** 指定列顺序（英文字段名数组），未列出的列追加到末尾；为空则按 API 返回顺序 */
  columnOrder?: string[];
  /** 英文字段名 → 中文标签 映射，覆盖 API 返回的中文列名 */
  fieldLabelMap?: Record<string, string>;
  /** 默认隐藏的列（英文字段名集合），用户可通过列选择器切换 */
  defaultHiddenFields?: Set<string>;
  /** 页签标识，用于分页签缓存列显示状态；如 "breakdown" 则使用 key colVisibility_${category}_breakdown */
  tabId?: string;
  /** 字段值映射：field → { rawValue → 显示文本 }，用于把数字编码显示为中文 */
  valueMappings?: Record<string, Record<string, string>>;
  /** 需要用「亿」为单位格式化的字段集合 */
  yiFields?: Set<string>;
}

function getColVisibilityKey(category: string, tabId?: string): string {
  return `colVisibility_${category}${tabId ? `_${tabId}` : ''}`;
}

type ColumnPrefs = {
  hiddenFields: string[];
  columnOrder?: string[];
};

function parseColumnPrefs(raw: string | null): ColumnPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    // backward compatibility: old format is string[] (hidden fields only)
    if (Array.isArray(parsed)) {
      return {
        hiddenFields: parsed.filter((v): v is string => typeof v === 'string'),
        columnOrder: [],
      };
    }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const hiddenFields = Array.isArray(obj.hiddenFields)
        ? obj.hiddenFields.filter((v): v is string => typeof v === 'string')
        : [];
      const columnOrder = Array.isArray(obj.columnOrder)
        ? obj.columnOrder.filter((v): v is string => typeof v === 'string')
        : [];
      return { hiddenFields, columnOrder };
    }
    return null;
  } catch {
    return null;
  }
}

export default function DataGrid({ 
  category, 
  title,
  useServerPagination = false,
  apiPath,
  extraQueryParams = {},
  columnAfter,
  columnOrder,
  fieldLabelMap,
  defaultHiddenFields,
  tabId,
  valueMappings,
  yiFields,
}: DataGridProps) {
  const [csvData, setCsvData] = useState<CSVData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [colSelectorOpen, setColSelectorOpen] = useState(false);
  const storageKey = getColVisibilityKey(category, tabId);
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return defaultHiddenFields ?? new Set();
    const prefs = parseColumnPrefs(window.localStorage.getItem(storageKey));
    if (prefs) return new Set(prefs.hiddenFields);
    return defaultHiddenFields ?? new Set();
  });
  const [customColumnOrder, setCustomColumnOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const prefs = parseColumnPrefs(window.localStorage.getItem(storageKey));
    return prefs?.columnOrder ?? [];
  });

  // 切换页签或 category 时，从该页签的缓存恢复列显示状态
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prefs = parseColumnPrefs(window.localStorage.getItem(storageKey));
    if (prefs) {
      setHiddenFields(new Set(prefs.hiddenFields));
      setCustomColumnOrder(prefs.columnOrder ?? []);
      return;
    }
    setHiddenFields(defaultHiddenFields ?? new Set());
    setCustomColumnOrder([]);
  }, [storageKey, defaultHiddenFields]);
  const [colSearchText, setColSearchText] = useState('');
  const colSelectorRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<AgGridReactType>(null);
  const sortModelRef = useRef<any[]>([]);
  const filterModelRef = useRef<any>({});
  const extraQueryParamsRef = useRef(extraQueryParams);

  // 更新 ref 当 extraQueryParams 变化时
  useEffect(() => {
    extraQueryParamsRef.current = extraQueryParams;
  }, [extraQueryParams]);

  const getApiUrl = useCallback((page: number, size: number, sortQuery = '', filterQuery = '') => {
    const basePath = apiPath || `/api/csv/${category}`;
    let extraParams = '';
    const currentExtraParams = extraQueryParamsRef.current;
    if (Object.keys(currentExtraParams).length > 0) {
      const params = new URLSearchParams();
      Object.entries(currentExtraParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
      extraParams = '&' + params.toString();
    }
    return `${basePath}?page=${page}&size=${size}${sortQuery}${filterQuery}${extraParams}`;
  }, [apiPath, category]);

  // 将 extraQueryParams 序列化为字符串用于依赖比较
  const extraQueryParamsStr = useMemo(() => {
    return JSON.stringify(extraQueryParams);
  }, [extraQueryParams]);

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const basePath = apiPath || `/api/csv/${category}`;
      let extraParams = '';
      const currentExtraParams = extraQueryParamsRef.current;
      if (Object.keys(currentExtraParams).length > 0) {
        const params = new URLSearchParams();
        Object.entries(currentExtraParams).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            params.append(key, String(value));
          }
        });
        extraParams = '&' + params.toString();
      }

      let url: string;
      if (useServerPagination) {
        // 服务端分页模式：只获取 headers 和 totalRows
        url = `${basePath}?page=1&size=1${extraParams}`;
      } else {
        // 客户端分页模式：获取全部数据
        url = `${basePath}?page=1&size=10000${extraParams}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      // 若结果中包含 update_flag / end_type 等字段，则做资产负债表相关的清洗：
      // 1) 根据 end_date 推导缺失的 end_type（1,2,3,4）
      // 2) 按 ts_code + end_date + report_type 去重：若存在 update_flag=1，则丢弃 0
      let processed = data;
      try {
        const rows: any[] | undefined = Array.isArray(data?.data) ? data.data : undefined;
        if (rows && rows.length > 0 && rows[0]) {
          // 1) 填充缺失的 end_type（如果有该字段）
          rows.forEach((r) => {
            if (
              Object.prototype.hasOwnProperty.call(r, 'end_type') &&
              (r.end_type === null || r.end_type === undefined || r.end_type === '' || r.end_type === '-')
            ) {
              const raw = String(r.end_date ?? '');
              let month = 0;
              if (raw) {
                const d = new Date(raw.replace(/-/g, '/'));
                if (!isNaN(d.getTime())) {
                  month = d.getMonth() + 1; // 1-12
                }
              }
              let code = '';
              if (month >= 1 && month <= 3) code = '1';
              else if (month >= 4 && month <= 6) code = '2';
              else if (month >= 7 && month <= 9) code = '3';
              else if (month >= 10 && month <= 12) code = '4';
              if (code) r.end_type = code;
            }
          });

          // 2) 若存在 update_flag 字段，则按 ts_code + end_date + report_type 去重
          if (Object.prototype.hasOwnProperty.call(rows[0], 'update_flag')) {
            const hasUpdated = new Set<string>();
            const key = (r: any) =>
              `${r.ts_code ?? ''}_${r.end_date ?? ''}_${r.report_type ?? ''}`;
            for (const r of rows) {
              if (Number(r.update_flag) === 1) {
                hasUpdated.add(key(r));
              }
            }
            const deduped = rows.filter((r) => {
              if (Number(r.update_flag) === 0 && hasUpdated.has(key(r))) return false;
              return true;
            });
            processed = { ...data, data: deduped };
          }
        }
      } catch (e) {
        console.warn('balanceSheet cleanup (end_type/update_flag) failed, fallback to raw data:', e);
      }

      setCsvData(processed);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [useServerPagination, apiPath, category]);

  // 数据加载
  useEffect(() => {
    setCsvData(null);
    fetchInitialData();
  }, [category, extraQueryParamsStr, fetchInitialData]);

  // 数字格式化函数：千分位 + 保留两位小数
  const formatNumber = (value: any, field: string): string => {
    if (value === null || value === undefined || value === '') {
      return '-';
    }
    
    const num = Number(value);
    
    if (isNaN(num)) {
      return String(value);
    }
    
    let digits = field.endsWith('count') ? 0 : 2;
    return num.toLocaleString('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  };

  // 判断列是否为日期列（仅匹配 _date 后缀或 date_ 前缀，排除 update_flag 等含 date 的非日期列）
  const isDateColumn = (field: string): boolean => {
    const f = field.toLowerCase();
    if (f === 'update_flag') return false;
    return f.endsWith('_date') || f.startsWith('date_');
  };

  // 日期格式化函数：只显示日期部分
  const formatDate = (value: any): string => {
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    const strValue = String(value);
    
    // 处理 YYYYMMDD 格式（8位数字）
    if (/^\d{8}$/.test(strValue)) {
      return `${strValue.slice(0, 4)}-${strValue.slice(4, 6)}-${strValue.slice(6, 8)}`;
    }
    
    // 处理 YYYY-MM-DD HH:mm:ss 或 YYYY-MM-DDTHH:mm:ss 格式
    if (strValue.includes(' ') || strValue.includes('T')) {
      return strValue.split(/[\sT]/)[0];
    }
    
    // 处理 YYYY-MM-DD 格式（已经是日期格式）
    if (/^\d{4}-\d{2}-\d{2}/.test(strValue)) {
      return strValue.split(/[\sT]/)[0];
    }
    
    // 尝试解析为日期对象
    try {
      const date = new Date(strValue);
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    } catch (e) {
      // 解析失败，返回原值
    }
    
    // 无法解析，返回原值
    return strValue;
  };

  // 判断列是否为数字列
  const isNumericColumn = (field: string, data: Record<string, any>[]): boolean => {
    if (!data || data.length === 0) return false;
    
    if (field.endsWith('_date') || field.endsWith('symbol')) {
      return false;
    }

    const sampleSize = Math.min(10, data.length);
    let numericCount = 0;
    
    for (let i = 0; i < sampleSize; i++) {
      const value = data[i]?.[field];
      if (value !== null && value !== undefined && value !== '') {
        const num = Number(value);
        if (!isNaN(num)) {
          numericCount++;
        }
      }
    }
    
    return numericCount > sampleSize * 0.5;
  };

  // 根据标题文本长度计算合适的列宽
  const calculateColumnWidth = (headerText: string): number => {
    const chineseCharWidth = 14;
    const englishCharWidth = 8;
    
    let width = 0;
    for (let i = 0; i < headerText.length; i++) {
      const char = headerText[i];
      if (/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(char)) {
        width += chineseCharWidth;
      } else {
        width += englishCharWidth;
      }
    }
    
    return Math.max(width + 60, 120);
  };

  const [colDirty, setColDirty] = useState(false);

  const saveColVisibility = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const payload: ColumnPrefs = {
        hiddenFields: [...hiddenFields],
        columnOrder: customColumnOrder,
      };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
      setColDirty(false);
    } catch { /* ignore quota errors */ }
  }, [hiddenFields, customColumnOrder, storageKey]);

  useEffect(() => {
    if (!colSelectorOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (colSelectorRef.current && !colSelectorRef.current.contains(e.target as Node)) {
        setColSelectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [colSelectorOpen]);

  const toggleFieldVisibility = useCallback((field: string) => {
    setHiddenFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
    setColDirty(true);
  }, []);

  const showAllFields = useCallback(() => { setHiddenFields(new Set()); setColDirty(true); }, []);
  const hideAllFields = useCallback(() => {
    if (!csvData) return;
    const allFields = csvData.originalHeaders || csvData.headers;
    setHiddenFields(new Set(allFields));
    setColDirty(true);
  }, [csvData]);
  const resetToDefault = useCallback(() => { setHiddenFields(defaultHiddenFields ?? new Set()); setColDirty(true); }, [defaultHiddenFields]);
  const moveField = useCallback((field: string, direction: 'up' | 'down') => {
    if (!csvData || !csvData.headers || csvData.headers.length === 0) return;
    const originalHeaders = csvData.originalHeaders || csvData.headers;
    const present = new Set(originalHeaders);
    const baseOrder =
      customColumnOrder.length > 0
        ? [...customColumnOrder.filter((f) => present.has(f)), ...originalHeaders.filter((f) => !customColumnOrder.includes(f))]
        : columnOrder && columnOrder.length > 0
          ? [...columnOrder.filter((f) => present.has(f)), ...originalHeaders.filter((f) => !columnOrder.includes(f))]
          : [...originalHeaders];
    const idx = baseOrder.indexOf(field);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === baseOrder.length - 1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [baseOrder[idx], baseOrder[swapIdx]] = [baseOrder[swapIdx], baseOrder[idx]];
    setCustomColumnOrder(baseOrder);
    setColDirty(true);
  }, [csvData, customColumnOrder, columnOrder]);

  // 生成AG Grid的列定义
  const columnDefs = useMemo(() => {
    if (!csvData || !csvData.headers || csvData.headers.length === 0) return [];
    const originalHeaders = csvData.originalHeaders || csvData.headers;

    const fieldToChineseFromApi = new Map<string, string>();
    originalHeaders.forEach((field, i) => {
      fieldToChineseFromApi.set(field, csvData.headers[i] ?? field);
    });

    const makeDef = (field: string) => {
      const chineseLabel = fieldLabelMap?.[field] ?? fieldToChineseFromApi.get(field) ?? field;
      const headerText = chineseLabel !== field ? `${chineseLabel}\n${field}` : field;
      const calculatedWidth = calculateColumnWidth(chineseLabel.length > field.length ? chineseLabel : field);
      const isNumeric = isNumericColumn(field, csvData.data);
      const isDate = isDateColumn(field);
      const mapping = valueMappings?.[field];
      const useYi = yiFields?.has(field);

      let formatterProps: Record<string, any> = {};
      if (mapping) {
        formatterProps = {
          valueFormatter: (params: any) => {
            const raw = params.value;
            if (raw == null || raw === '') return '-';
            const key = String(Math.floor(Number(raw)));
            return mapping[key] ?? mapping[String(raw)] ?? String(raw);
          },
        };
      } else if (isDate) {
        formatterProps = {
          valueFormatter: (params: any) => formatDate(params.value),
        };
      } else if (useYi) {
        formatterProps = {
          valueFormatter: (params: any) => {
            if (params.value == null || params.value === '') return '-';
            const n = Number(params.value);
            if (isNaN(n)) return String(params.value);
            return (n / 1e8).toFixed(2) + ' 亿';
          },
          cellStyle: { textAlign: 'right' },
        };
      } else if (isNumeric) {
        formatterProps = {
          valueFormatter: (params: any) => formatNumber(params.value, field),
          cellStyle: { textAlign: 'right' },
        };
      }

      return {
        field,
        headerName: headerText,
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: calculatedWidth,
        width: calculatedWidth,
        headerClass: 'ag-header-cell-wrap',
        hide: hiddenFields.has(field),
        ...formatterProps,
      };
    };

    let orderedFields: string[];
    if (customColumnOrder.length > 0) {
      const present = new Set(originalHeaders);
      const ordered = customColumnOrder.filter((f) => present.has(f));
      const rest = originalHeaders.filter((f) => !customColumnOrder.includes(f));
      orderedFields = [...ordered, ...rest];
    } else if (columnOrder && columnOrder.length > 0) {
      const present = new Set(originalHeaders);
      const ordered = columnOrder.filter((f) => present.has(f));
      const rest = originalHeaders.filter((f) => !columnOrder.includes(f));
      orderedFields = [...ordered, ...rest];
    } else {
      orderedFields = [...originalHeaders];
    }

    let defs = orderedFields.map(makeDef);

    if (columnAfter?.anchor && columnAfter?.field && columnAfter.anchor !== columnAfter.field) {
      const anchorIdx = defs.findIndex((c) => c.field === columnAfter.anchor);
      const fieldIdx = defs.findIndex((c) => c.field === columnAfter.field);
      if (anchorIdx !== -1 && fieldIdx !== -1) {
        const [moved] = defs.splice(fieldIdx, 1);
        const insertAt = fieldIdx < anchorIdx ? anchorIdx : anchorIdx + 1;
        defs.splice(insertAt, 0, moved);
      }
    }

    return defs;
  }, [csvData, columnAfter, columnOrder, customColumnOrder, fieldLabelMap, hiddenFields, valueMappings, yiFields]);

  // 默认列配置
  const defaultColDef = useMemo(() => ({
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 120,
  }), []);

  // 将数据转换为CSV格式
  const convertToCSV = (data: Record<string, any>[], headers: string[], originalHeaders: string[]): string => {
    // CSV头部使用中文列名
    const csvHeaders = headers.join(',');
    
    // CSV数据行
    const csvRows = data.map(row => {
      return originalHeaders.map(header => {
        const value = row[header];
        // 处理包含逗号、引号或换行符的值
        if (value === null || value === undefined || value === '') {
          return '';
        }
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',');
    });
    
    // 添加BOM以支持Excel正确显示中文
    const BOM = '\uFEFF';
    return BOM + [csvHeaders, ...csvRows].join('\n');
  };

  // 下载CSV文件
  const downloadCSV = (csvContent: string, filename: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 导出数据到CSV
  const handleExportCSV = useCallback(async () => {
    if (!csvData) return;
    
    setExporting(true);
    try {
      let allData: Record<string, any>[] = [];
      let sortQuery = '';
      let filterQuery = '';

      // 获取当前的排序和过滤条件
      if (gridRef.current?.api) {
        try {
          // 尝试从 grid API 获取排序和过滤模型
          const api = gridRef.current.api as any;
          const sortModel = api.getSortModel?.() || sortModelRef.current || [];
          const filterModel = api.getFilterModel?.() || filterModelRef.current || {};
          
          sortModelRef.current = sortModel;
          filterModelRef.current = filterModel;

          if (sortModel && sortModel.length > 0) {
            const sortField = sortModel[0].colId;
            const sortDir = sortModel[0].sort;
            sortQuery = `&sortField=${sortField}&sortDir=${sortDir}`;
          }

          if (filterModel && Object.keys(filterModel).length > 0) {
            filterQuery = `&filters=${encodeURIComponent(JSON.stringify(filterModel))}`;
          }
        } catch (e) {
          // 如果获取失败，使用已保存的引用
          console.warn('Failed to get sort/filter model, using cached values:', e);
        }
      }

      if (useServerPagination) {
        // 服务端分页：获取所有数据（使用一个很大的size）
        const url = getApiUrl(1, 1000000, sortQuery, filterQuery);
        const response = await fetch(url);
        const data = await response.json();
        allData = data.data;
      } else {
        // 客户端分页：直接使用已有数据
        allData = csvData.data;
      }

      // 应用排序和过滤（客户端分页时）
      if (!useServerPagination && allData.length > 0) {
        let filteredData = [...allData];

        // 应用过滤
        if (filterModelRef.current && Object.keys(filterModelRef.current).length > 0) {
          Object.keys(filterModelRef.current).forEach(key => {
            const filter = filterModelRef.current[key];
            if (filter.filterType === 'text') {
              const filterValue = String(filter.filter).toLowerCase();
              filteredData = filteredData.filter(row => {
                const value = String(row[key] || '').toLowerCase();
                return value.includes(filterValue);
              });
            } else if (filter.filterType === 'number') {
              const filterValue = Number(filter.filter);
              if (!isNaN(filterValue)) {
                filteredData = filteredData.filter(row => {
                  const value = Number(row[key]);
                  if (isNaN(value)) return false;
                  switch (filter.type) {
                    case 'equals': return value === filterValue;
                    case 'greaterThan': return value > filterValue;
                    case 'lessThan': return value < filterValue;
                    case 'greaterThanOrEqual': return value >= filterValue;
                    case 'lessThanOrEqual': return value <= filterValue;
                    default: return true;
                  }
                });
              }
            }
          });
        }

        // 应用排序
        if (sortModelRef.current && sortModelRef.current.length > 0) {
          const sort = sortModelRef.current[0];
          filteredData.sort((a, b) => {
            const aVal = a[sort.colId];
            const bVal = b[sort.colId];
            const aNum = Number(aVal);
            const bNum = Number(bVal);
            
            let comparison = 0;
            if (!isNaN(aNum) && !isNaN(bNum)) {
              comparison = aNum - bNum;
            } else {
              comparison = String(aVal || '').localeCompare(String(bVal || ''));
            }
            
            return sort.sort === 'asc' ? comparison : -comparison;
          });
        }

        allData = filteredData;
      }

      // 转换为CSV
      const originalHeaders = csvData.originalHeaders || csvData.headers;
      const csvContent = convertToCSV(allData, csvData.headers, originalHeaders);
      
      // 生成文件名（包含时间戳）
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `${category}_${timestamp}.csv`;
      
      // 下载文件
      downloadCSV(csvContent, filename);
    } catch (err) {
      console.error('导出失败:', err);
      alert('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }, [category, csvData, useServerPagination, apiPath]);

  // onGridReady 处理数据源
  const onGridReady = useCallback((params: GridReadyEvent) => {
    if (csvData?.headers) {
      const allColumnIds = params.api.getColumns()?.map((col: { getColId: () => any; }) => col.getColId()) || [];
      params.api.autoSizeColumns(allColumnIds);
    }

    // 为特定类别设置默认排序
    if (useServerPagination && category === 'income1') {
      // 设置默认按 end_date 降序排序
      const defaultSortModel = [{ colId: 'end_date', sort: 'desc' as 'asc' | 'desc' }];
      sortModelRef.current = defaultSortModel;
      // 注意：AG Grid 的排序会在数据源请求时通过 sortModel 参数传递
      // 我们在 getRows 中已经处理了默认排序逻辑
    }

    if (useServerPagination) {
      const dataSource: IDatasource = {
        getRows: async (params) => {
          const { startRow, successCallback, failCallback, sortModel, filterModel } = params;

          // 保存排序和过滤条件
          sortModelRef.current = sortModel || [];
          filterModelRef.current = filterModel || {};

          let sortQuery = '';
          if (sortModel && sortModel.length > 0) {
            const sortField = sortModel[0].colId;
            const sortDir = sortModel[0].sort;
            sortQuery = `&sortField=${sortField}&sortDir=${sortDir}`;
          } else if (category === 'income1') {
            // 对于 income1 类别，如果没有用户排序，使用默认的 end_date 降序
            sortQuery = `&sortField=end_date&sortDir=desc`;
          }

          let filterQuery = '';
          if (filterModel && Object.keys(filterModel).length > 0) {
            filterQuery = `&filters=${encodeURIComponent(JSON.stringify(filterModel))}`;
          }
          
          const page = Math.floor(startRow / pageSize) + 1;
          
          try {
            console.log(`Fetching page ${page} for rows ${startRow} (${category})`);
            const basePath = apiPath || `/api/csv/${category}`;
            let extraParams = '';
            const currentExtraParams = extraQueryParamsRef.current;
            if (Object.keys(currentExtraParams).length > 0) {
              const params = new URLSearchParams();
              Object.entries(currentExtraParams).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                  params.append(key, String(value));
                }
              });
              extraParams = '&' + params.toString();
            }
            const url = `${basePath}?page=${page}&size=${pageSize}${sortQuery}${filterQuery}${extraParams}`;
            const res = await fetch(url);
            const d = await res.json();
            successCallback(d.data, d.totalRows);
          } catch (e) {
            console.error('Error fetching data:', e);
            failCallback();
          }
        }
      };
      
      params.api.setGridOption('datasource', dataSource);
    }
  }, [category, pageSize, csvData, useServerPagination, apiPath]);

  return (
    <div className="container relative">
      {/* <div className="header">
        <h1>{title}</h1>
        <p>查看和分析数据</p>
      </div> */}

      {loading && (
        <div className="loading">
          <p>加载中...</p>
        </div>
      )}

      {error && (
        <div className="error">
          <p>错误: {error}</p>
        </div>
      )}

      {csvData && !loading && (
        <>
          {/* <div className="info">
            <div className="info-item">
              <span className="info-label">文件:</span>
              <span className="info-value">{csvData.filename}</span>
            </div>
            <div className="info-item">
              <span className="info-label">总行数:</span>
              <span className="info-value">{csvData.totalRows}</span>
            </div>
            <div className="info-item">
              <span className="info-label">列数:</span>
              <span className="info-value">{csvData.headers.length}</span>
            </div>
          </div> */}

          <div className="mb-4 flex items-end gap-2 absolute right-0 flex-col top-10">
            <div className="relative" ref={colSelectorRef}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setColSelectorOpen((v) => !v)}
                title="列筛选"
                aria-label="列筛选"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
              {colSelectorOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-72 max-h-96 flex flex-col">
                  <div className="p-2 border-b border-gray-100 flex gap-1">
                    <input
                      type="text"
                      placeholder="搜索列名..."
                      value={colSearchText}
                      onChange={(e) => setColSearchText(e.target.value)}
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs"
                    />
                  </div>
                  <div className="p-2 border-b border-gray-100 flex items-center gap-2 text-xs">
                    <button type="button" onClick={showAllFields} className="text-blue-600 hover:underline">全选</button>
                    <button type="button" onClick={hideAllFields} className="text-blue-600 hover:underline">全清</button>
                    {defaultHiddenFields && (
                      <button type="button" onClick={resetToDefault} className="text-blue-600 hover:underline">恢复默认</button>
                    )}
                    <button
                      type="button"
                      onClick={saveColVisibility}
                      className={`ml-auto px-2 py-0.5 rounded text-white text-xs ${
                        colDirty ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-default'
                      }`}
                      disabled={!colDirty}
                    >
                      保存
                    </button>
                  </div>
                  <div className="overflow-y-auto flex-1 p-1">
                    {columnDefs
                      .filter((col: any) => {
                        if (!colSearchText.trim()) return true;
                        const q = colSearchText.trim().toLowerCase();
                        return col.field.toLowerCase().includes(q) || col.headerName.toLowerCase().includes(q);
                      })
                      .map((col: any) => (
                        <label
                          key={col.field}
                          className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={!hiddenFields.has(col.field)}
                            onChange={() => toggleFieldVisibility(col.field)}
                            className="h-3.5 w-3.5 rounded border-gray-300"
                          />
                          <span className="truncate">
                            {(fieldLabelMap?.[col.field] || col.headerName.split('\n')[0])}
                            <span className="text-gray-400 ml-1">{col.field}</span>
                          </span>
                          <span className="ml-auto inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveField(col.field, 'up'); }}
                              className="text-gray-500 hover:text-gray-800"
                              title="上移"
                              aria-label="上移"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveField(col.field, 'down'); }}
                              className="text-gray-500 hover:text-gray-800"
                              title="下移"
                              aria-label="下移"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </label>
                      ))}
                  </div>
                </div>
              )}
            </div>
            <Button
              onClick={handleExportCSV}
              disabled={exporting}
              variant="outline"
              size="sm"
              title={exporting ? '导出中...' : '导出CSV'}
              aria-label={exporting ? '导出中...' : '导出CSV'}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>

          <div className="table-container">
            <div className="ag-theme-alpine" style={{ height: '70vh', width: '100%' }}>
              <AgGridReact
                key={`${category}-${pageSize}`}
                ref={gridRef}
                rowData={useServerPagination ? undefined : csvData.data}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                pagination={true}
                paginationPageSize={pageSize}
                paginationPageSizeSelector={[25, 50, 100, 200]}
                rowModelType={useServerPagination ? 'infinite' : 'clientSide'}
                cacheBlockSize={useServerPagination ? pageSize : undefined}
                onPaginationChanged={(e) => {
                  if (typeof e.newPageSize === 'number') setPageSize(e.newPageSize);
                }}
                enableCellTextSelection={true}
                ensureDomOrder={true}
                suppressCellFocus={false}
                animateRows={true}
                rowSelection="multiple"
                suppressRowClickSelection={true}
                onGridReady={onGridReady}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
