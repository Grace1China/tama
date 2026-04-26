'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ThsIndexImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('请先选择 xlsx 文件');
      setMessage('');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/parq/ths_index/import', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(String(json?.message ?? json?.error ?? '导入失败'));
      setMessage(
        `导入成功：${json?.ts_code ?? '-'} ${json?.name ?? ''}，本次导入 ${json?.importedRows ?? 0} 条，当前成分 ${json?.currentCount ?? 0} 条。`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="box-border flex min-h-[calc(100vh-3.5rem)] flex-col gap-4 p-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h1 className="text-lg font-semibold text-gray-900">同花顺概念导入</h1>
        <p className="mt-1 text-sm text-gray-500">
          文件名格式：<code>ts_code-概念名称.xlsx</code>，例如 <code>886033-共封装光学(CPO).xlsx</code>。
        </p>
        <p className="mt-1 text-sm text-gray-500">
          导入后会写入 <code>temp/tuShare/ths_index.parquet</code> 与 <code>temp/tuShare/ths_index_member.parquet</code>，
          并保证 <code>ts_code + con_code</code> 唯一。
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <form className="flex flex-wrap items-center gap-3" onSubmit={onSubmit}>
          <Input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="max-w-xl"
          />
          <Button type="submit" disabled={loading}>
            {loading ? '导入中...' : '开始导入'}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/ths_index">返回同花顺指数页面</Link>
          </Button>
        </form>
        {message ? <div className="mt-3 text-sm text-emerald-600">{message}</div> : null}
        {error ? <div className="mt-3 text-sm text-red-500">{error}</div> : null}
      </div>
    </div>
  );
}
