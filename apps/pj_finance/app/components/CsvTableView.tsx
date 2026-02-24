'use client';

import { useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { AgGridReact as AgGridReactType } from 'ag-grid-react';
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

interface CsvTableViewProps {
  data: CsvTableData;
  onBack: () => void;
}

export default function CsvTableView({ data, onBack }: CsvTableViewProps) {
  const gridRef = useRef<AgGridReactType>(null);
  const { headers, originalHeaders, data: rowData } = data;
  const orig = originalHeaders ?? headers;

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

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <span className="text-sm text-muted-foreground">
          {data.filename} · 共 {data.totalRows} 行
        </span>
      </div>
      <div className="ag-theme-alpine w-full" style={{ height: 500 }}>
        <AgGridReact
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          domLayout="normal"
          pagination={true}
          paginationPageSize={50}
          paginationPageSizeSelector={[20, 50, 100, 200]}
          suppressCellFocus={false}
        />
      </div>
    </div>
  );
}
