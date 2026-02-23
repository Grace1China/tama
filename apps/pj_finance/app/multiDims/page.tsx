'use client';

import { useEffect, useMemo, useState } from 'react';

interface StockRecord {
  ts_code: string;
  symbol: string;
  name: string;
  area?: string;
  industry?: string;
  [key: string]: any;
}

interface StockListResponse {
  category: string;
  filename: string;
  headers: string[];
  originalHeaders?: string[];
  data: StockRecord[];
  totalRows: number;
}

type Dimension = 'area' | 'industry';

// 明细表列配置：field 对应数据字段，label 为表头
const DETAIL_COLUMNS: { field: keyof StockRecord | string; label: string }[] = [
  { field: 'ts_code', label: 'TS代码' },
  { field: 'symbol', label: '股票代码' },
  { field: 'name', label: '股票名称' },
  { field: 'area', label: '地域' },
  { field: 'industry', label: '所属行业' },
  { field: 'market', label: '市场类型' },
  { field: 'list_date', label: '上市日期' },
];

export default function MultiDimsPage() {
  const [rows, setRows] = useState<StockRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowDimension, setRowDimension] = useState<Dimension>('area');
  const [selectedFilter, setSelectedFilter] = useState<{
    type: Dimension;
    value: string;
  } | null>(null);

  // 二维表：行/列过滤与排序
  const [pivotRowFilter, setPivotRowFilter] = useState('');
  const [pivotColFilter, setPivotColFilter] = useState('');
  const [pivotRowSort, setPivotRowSort] = useState<'name' | 'total'>('name');
  const [pivotRowSortDir, setPivotRowSortDir] = useState<'asc' | 'desc'>('asc');
  const [pivotColSort, setPivotColSort] = useState<'name' | 'total'>('name');
  const [pivotColSortDir, setPivotColSortDir] = useState<'asc' | 'desc'>('asc');

  // 明细表：列排序与列过滤
  const [detailSortField, setDetailSortField] = useState<string | null>(null);
  const [detailSortDir, setDetailSortDir] = useState<'asc' | 'desc'>('asc');
  const [detailFilters, setDetailFilters] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/csv/stockList?page=1&size=10000');
        if (!res.ok) {
          throw new Error(`加载失败: ${res.statusText}`);
        }
        const json: StockListResponse = await res.json();
        setRows(json.data || []);
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : '加载数据失败');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const pivot = useMemo(() => {
    if (!rows || rows.length === 0) {
      return {
        rowKeys: [] as string[],
        colKeys: [] as string[],
        matrix: {} as Record<string, Record<string, number>>,
        rowTotals: {} as Record<string, number>,
        colTotals: {} as Record<string, number>,
      };
    }

    const rowField: Dimension = rowDimension;
    const colField: Dimension = rowDimension === 'area' ? 'industry' : 'area';

    const rowSet = new Set<string>();
    const colSet = new Set<string>();
    const matrix: Record<string, Record<string, number>> = {};
    const rowTotals: Record<string, number> = {};
    const colTotals: Record<string, number> = {};

    for (const r of rows) {
      const rowVal = (r[rowField] as string | undefined) || '未知';
      const colVal = (r[colField] as string | undefined) || '未知';

      rowSet.add(rowVal);
      colSet.add(colVal);

      if (!matrix[rowVal]) matrix[rowVal] = {};
      matrix[rowVal][colVal] = (matrix[rowVal][colVal] || 0) + 1;
      rowTotals[rowVal] = (rowTotals[rowVal] || 0) + 1;
      colTotals[colVal] = (colTotals[colVal] || 0) + 1;
    }

    const rowKeys = Array.from(rowSet).sort();
    const colKeys = Array.from(colSet).sort();

    return { rowKeys, colKeys, matrix, rowTotals, colTotals };
  }, [rows, rowDimension]);

  // 应用二维表行/列过滤与排序
  const { displayedRowKeys, displayedColKeys } = useMemo(() => {
    const { rowKeys, colKeys, rowTotals, colTotals } = pivot;
    const rFilter = pivotRowFilter.trim().toLowerCase();
    const cFilter = pivotColFilter.trim().toLowerCase();

    let rList = rFilter
      ? rowKeys.filter((k) => k.toLowerCase().includes(rFilter))
      : [...rowKeys];
    let cList = cFilter
      ? colKeys.filter((k) => k.toLowerCase().includes(cFilter))
      : [...colKeys];

    rList.sort((a, b) => {
      if (pivotRowSort === 'name') return pivotRowSortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
      const diff = (rowTotals[a] ?? 0) - (rowTotals[b] ?? 0);
      return pivotRowSortDir === 'asc' ? diff : -diff;
    });

    cList.sort((a, b) => {
      if (pivotColSort === 'name') return pivotColSortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
      const diff = (colTotals[a] ?? 0) - (colTotals[b] ?? 0);
      return pivotColSortDir === 'asc' ? diff : -diff;
    });

    return { displayedRowKeys: rList, displayedColKeys: cList };
  }, [pivot, pivotRowFilter, pivotColFilter, pivotRowSort, pivotRowSortDir, pivotColSort, pivotColSortDir]);

  const filteredRows = useMemo(() => {
    if (!selectedFilter || rows.length === 0) return [];
    const { type, value } = selectedFilter;
    return rows.filter((r) => ((r[type] as string | undefined) || '未知') === value);
  }, [rows, selectedFilter]);

  // 明细表：应用列过滤与排序
  const displayedDetailRows = useMemo(() => {
    let list = [...filteredRows];
    const filters = detailFilters;
    const hasFilter = Object.values(filters).some((v) => v.trim() !== '');
    if (hasFilter) {
      list = list.filter((r) => {
        return DETAIL_COLUMNS.every((col) => {
          const q = (filters[col.field] ?? '').trim().toLowerCase();
          if (!q) return true;
          const val = String(r[col.field] ?? '').toLowerCase();
          return val.includes(q);
        });
      });
    }
    if (detailSortField) {
      list.sort((a, b) => {
        const av = a[detailSortField];
        const bv = b[detailSortField];
        const aStr = av == null ? '' : String(av);
        const bStr = bv == null ? '' : String(bv);
        const cmp = aStr.localeCompare(bStr, undefined, { numeric: true });
        return detailSortDir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [filteredRows, detailFilters, detailSortField, detailSortDir]);

  const handleDetailSort = (field: string) => {
    if (detailSortField === field) {
      setDetailSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setDetailSortField(field);
      setDetailSortDir('asc');
    }
  };

  const setDetailFilter = (field: string, value: string) => {
    setDetailFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handleRowHeaderClick = (rowKey: string) => {
    const type: Dimension = rowDimension;
    if (selectedFilter && selectedFilter.type === type && selectedFilter.value === rowKey) {
      setSelectedFilter(null);
    } else {
      setSelectedFilter({ type, value: rowKey });
    }
  };

  const handleColHeaderClick = (colKey: string) => {
    const type: Dimension = rowDimension === 'area' ? 'industry' : 'area';
    if (selectedFilter && selectedFilter.type === type && selectedFilter.value === colKey) {
      setSelectedFilter(null);
    } else {
      setSelectedFilter({ type, value: colKey });
    }
  };

  const labelForDimension = (dim: Dimension) => {
    return dim === 'area' ? '地域' : '所属行业';
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold mb-2">A股上市公司 - 行业 × 地域 统计</h1>
        <p className="text-sm text-gray-600">
          参照股票列表数据，对 A 股上市公司按 <span className="font-semibold">行业</span> 和{' '}
          <span className="font-semibold">地域</span> 做二维统计。
          点击表头可以快速展开 / 收起一个维度，查看某个地域或行业下的所有公司。
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-semibold">行维度：</span>
          <button
            type="button"
            className={`px-3 py-1 rounded border text-sm ${
              rowDimension === 'area'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300'
            }`}
            onClick={() => setRowDimension('area')}
          >
            地域在行，行业在列
          </button>
          <button
            type="button"
            className={`px-3 py-1 rounded border text-sm ${
              rowDimension === 'industry'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300'
            }`}
            onClick={() => setRowDimension('industry')}
          >
            行业在行，地域在列
          </button>
        </div>

        <div className="text-gray-600">
          共 <span className="font-semibold">{rows.length}</span> 家上市公司
        </div>
      </div>

      {loading && (
        <div className="py-8 text-center text-gray-600">数据加载中...</div>
      )}

      {error && (
        <div className="py-4 mb-4 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
          错误：{error}
        </div>
      )}

      {!loading && !error && pivot.rowKeys.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-600">行过滤:</span>
              <input
                type="text"
                placeholder={`筛选${labelForDimension(rowDimension)}`}
                value={pivotRowFilter}
                onChange={(e) => setPivotRowFilter(e.target.value)}
                className="border rounded px-2 py-1 w-36"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-600">行排序:</span>
              <select
                value={pivotRowSort}
                onChange={(e) => setPivotRowSort(e.target.value as 'name' | 'total')}
                className="border rounded px-2 py-1"
              >
                <option value="name">按名称</option>
                <option value="total">按合计</option>
              </select>
              <button
                type="button"
                className="px-2 py-1 border rounded hover:bg-gray-100"
                onClick={() => setPivotRowSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                title={pivotRowSortDir === 'asc' ? '升序，点击改降序' : '降序，点击改升序'}
              >
                {pivotRowSortDir === 'asc' ? '↑' : '↓'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-600">列过滤:</span>
              <input
                type="text"
                placeholder={`筛选${labelForDimension(rowDimension === 'area' ? 'industry' : 'area')}`}
                value={pivotColFilter}
                onChange={(e) => setPivotColFilter(e.target.value)}
                className="border rounded px-2 py-1 w-36"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-600">列排序:</span>
              <select
                value={pivotColSort}
                onChange={(e) => setPivotColSort(e.target.value as 'name' | 'total')}
                className="border rounded px-2 py-1"
              >
                <option value="name">按名称</option>
                <option value="total">按合计</option>
              </select>
              <button
                type="button"
                className="px-2 py-1 border rounded hover:bg-gray-100"
                onClick={() => setPivotColSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              >
                {pivotColSortDir === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto border rounded-md">
            <table className="min-w-full text-xs md:text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-100 px-2 py-2 text-left border-r border-b">
                    {labelForDimension(rowDimension)}
                  </th>
                  <th className="px-2 py-2 text-right border-b whitespace-nowrap">
                    合计公司数
                  </th>
                  {displayedColKeys.map((colKey) => (
                    <th
                      key={colKey}
                      className="px-2 py-2 text-right border-b cursor-pointer hover:bg-gray-200 whitespace-nowrap"
                      onClick={() => handleColHeaderClick(colKey)}
                      title={`点击查看 "${colKey}" 下的全部公司`}
                    >
                      {colKey}
                      {selectedFilter &&
                        selectedFilter.type ===
                          (rowDimension === 'area' ? 'industry' : 'area') &&
                        selectedFilter.value === colKey && (
                          <span className="ml-1 text-xs text-blue-600">（已选）</span>
                        )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedRowKeys.map((rowKey) => (
                  <tr key={rowKey} className="odd:bg-white even:bg-gray-50">
                    <td
                      className="sticky left-0 z-10 bg-white px-2 py-1 text-left border-r border-t cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                      onClick={() => handleRowHeaderClick(rowKey)}
                      title={`点击查看 "${rowKey}" 下的全部公司`}
                    >
                      <span className="mr-1 text-gray-500">
                        {selectedFilter &&
                        selectedFilter.type === rowDimension &&
                        selectedFilter.value === rowKey
                          ? '▾'
                          : '▸'}
                      </span>
                      {rowKey}
                    </td>
                    <td className="px-2 py-1 text-right border-t">
                      {pivot.rowTotals[rowKey] ?? 0}
                    </td>
                    {displayedColKeys.map((colKey) => {
                      const count = pivot.matrix[rowKey]?.[colKey] ?? 0;
                      return (
                        <td
                          key={colKey}
                          className={`px-2 py-1 text-right border-t ${
                            count > 0 ? 'cursor-pointer hover:bg-blue-50' : 'text-gray-300'
                          }`}
                          onClick={() => {
                            if (count > 0) handleRowHeaderClick(rowKey);
                          }}
                          title={
                            count > 0
                              ? `${labelForDimension(rowDimension)}="${rowKey}"，${labelForDimension(
                                  rowDimension === 'area' ? 'industry' : 'area'
                                )}="${colKey}" 的公司数`
                              : '无公司'
                          }
                        >
                          {count || ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedFilter && filteredRows.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm">
              当前展开：
              <span className="font-semibold">
                {labelForDimension(selectedFilter.type)} = {selectedFilter.value}
              </span>
              ，共 <span className="font-semibold">{displayedDetailRows.length}</span> 家公司
              {displayedDetailRows.length !== filteredRows.length && (
                <span className="text-gray-500 ml-1">
                  （过滤前 {filteredRows.length} 家）
                </span>
              )}
            </div>
            <button
              type="button"
              className="px-3 py-1 rounded border border-gray-300 text-xs text-gray-700 hover:bg-gray-100"
              onClick={() => setSelectedFilter(null)}
            >
              收起
            </button>
          </div>

          <div className="overflow-x-auto border rounded-md">
            <table className="min-w-full text-xs md:text-sm">
              <thead className="bg-gray-100">
                <tr>
                  {DETAIL_COLUMNS.map((col) => (
                    <th
                      key={col.field}
                      className="px-2 py-2 text-left border-b whitespace-nowrap cursor-pointer hover:bg-gray-200 select-none"
                      onClick={() => handleDetailSort(String(col.field))}
                      title={`点击按此列排序（${detailSortField === col.field ? detailSortDir === 'asc' ? '升序，再点变降序' : '降序，再点变升序' : '排序'})`}
                    >
                      {col.label}
                      {detailSortField === col.field && (
                        <span className="ml-1 text-blue-600">{detailSortDir === 'asc' ? ' ↑' : ' ↓'}</span>
                      )}
                    </th>
                  ))}
                </tr>
                <tr className="bg-gray-50">
                  {DETAIL_COLUMNS.map((col) => (
                    <th key={col.field} className="px-1 py-1 border-b">
                      <input
                        type="text"
                        placeholder={`过滤${col.label}`}
                        value={detailFilters[col.field] ?? ''}
                        onChange={(e) => setDetailFilter(String(col.field), e.target.value)}
                        className="w-full min-w-[4rem] border rounded px-1 py-0.5 text-xs"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedDetailRows.map((r) => (
                  <tr key={r.ts_code} className="odd:bg-white even:bg-gray-50">
                    {DETAIL_COLUMNS.map((col) => (
                      <td key={col.field} className="px-2 py-1 border-t whitespace-nowrap">
                        {col.field === 'area' || col.field === 'industry'
                          ? (r[col.field] || '未知')
                          : (r[col.field] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedFilter && filteredRows.length === 0 && (
        <div className="mt-4 text-sm text-gray-600">
          当前条件下没有公司数据。
        </div>
      )}
    </div>
  );
}

