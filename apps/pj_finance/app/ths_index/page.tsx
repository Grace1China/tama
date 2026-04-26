'use client';

import DataGrid from '../components/DataGrid';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function ThsIndexPage() {
  return (
    <div className="box-border flex h-[calc(100vh-3.5rem)] min-h-0 flex-col gap-4 overflow-hidden p-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">同花顺指数</h1>
            <p className="mt-1 text-sm text-gray-500">展示同花顺指数列表（parquet 数据源）。</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/ths_index/import">导入概念 Excel</Link>
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white p-3">
        <DataGrid
          category="ths_index"
          tabId="ths_index_grid_v1"
          title="同花顺指数"
          tightChrome
          useServerPagination
          apiPath="/api/parq/ths_index"
          gridHeight="100%"
        />
      </div>
    </div>
  );
}
