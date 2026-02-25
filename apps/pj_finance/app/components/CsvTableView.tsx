'use client';

import { useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { AgGridReact as AgGridReactType } from 'ag-grid-react';
import type { IDatasource, GridReadyEvent } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export interface CsvTableData {
  headers: string[];
  originalHeaders?: string[];
  data: Record<string, unknown>[];
  totalRows: number;
  filename?: string;
}

function isDateColumn(field: string): boolean {
  const f = field.toLowerCase();
  if (f === 'update_flag') return false;
  return f.endsWith('_date') || f.startsWith('date_');
}

function formatDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const s = String(value);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (s.includes(' ') || s.includes('T')) return s.split(/[\sT]/)[0];
  return s;
}

function isNumericColumn(field: string, data: Record<string, unknown>[]): boolean {
  if (!data?.length) return false;
  if (field.endsWith('_date') || field.endsWith('symbol')) return false;
  const sample = Math.min(10, data.length);
  let n = 0;
  for (let i = 0; i < sample; i++) {
    const v = data[i]?.[field];
    if (v != null && v !== '' && !isNaN(Number(v))) n++;
  }
  return n > sample * 0.5;
}

function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 服务端分页：按页拉取数据，用于 Parquet 等大文件 */
export type FetchPageFn = (
  page: number,
  pageSize: number,
  sortField?: string,
  sortDir?: string
) => Promise<{ data: Record<string, unknown>[]; totalRows: number }>;

interface CsvTableViewProps {
  data: CsvTableData;
  onBack: () => void;
  /** 提供时使用服务端分页（infinite row model），不提供则使用客户端分页 */
  fetchPage?: FetchPageFn;
  /** 服务端分页时的每页条数，默认 50 */
  pageSize?: number;
}

export default function CsvTableView({ data, onBack, fetchPage, pageSize: pageSizeProp = 50 }: CsvTableViewProps) {
  const gridRef = useRef<AgGridReactType>(null);
  const { headers, originalHeaders, data: rowData, totalRows } = data;
  const orig = originalHeaders ?? headers;
  const useServerPagination = !!fetchPage;

  const columnDefs = useMemo(() => {
    return headers.map((header, i) => {
      const field = orig[i];
      const isDate = isDateColumn(field);
      const isNumeric = isNumericColumn(field, rowData);
      return {
        field,
        headerName: header,
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: 120,
        ...(isDate && { valueFormatter: (p: { value: unknown }) => formatDate(p.value) }),
        ...(isNumeric && !isDate && {
          valueFormatter: (p: { value: unknown }) => formatNumber(p.value),
          cellStyle: { textAlign: 'right' },
        }),
      };
    });
  }, [headers, orig, rowData]);

  const defaultColDef = useMemo(
    () => ({ sortable: true, filter: true, resizable: true, minWidth: 120 }),
    []
  );

  const onGridReady = useCallback(
    (event: GridReadyEvent) => {
      if (!useServerPagination || !fetchPage) return;
      const pageSize = pageSizeProp;
      const dataSource: IDatasource = {
        getRows: async (params) => {
          const { startRow, successCallback, failCallback, sortModel } = params;
          const page = Math.floor(startRow / pageSize) + 1;
          const sortField = sortModel?.[0]?.colId;
          const sortDir = sortModel?.[0]?.sort === 'asc' ? 'asc' : 'desc';
          try {
            const res = await fetchPage(page, pageSize, sortField, sortDir);
            const lastRow = res.totalRows <= 0 ? -1 : Math.min(startRow + res.data.length, res.totalRows) - 1;
            successCallback(res.data, lastRow);
          } catch (e) {
            console.error('CsvTableView fetchPage error:', e);
            failCallback();
          }
        },
      };
      (event.api as { setGridOption(key: string, value: unknown): void }).setGridOption('datasource', dataSource);
    },
    [useServerPagination, fetchPage, pageSizeProp]
  );

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <span className="text-sm text-muted-foreground">
          {data.filename} · 共 {totalRows} 行
        </span>
      </div>
      <div className="ag-theme-alpine w-full" style={{ height: 500 }}>
        <AgGridReact
          ref={gridRef}
          rowData={useServerPagination ? undefined : rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          domLayout="normal"
          pagination={true}
          paginationPageSize={pageSizeProp}
          paginationPageSizeSelector={[20, 50, 100, 200]}
          suppressCellFocus={false}
          rowModelType={useServerPagination ? 'infinite' : 'clientSide'}
          cacheBlockSize={useServerPagination ? pageSizeProp : undefined}
          onGridReady={onGridReady}
        />
      </div>
    </div>
  );
}
