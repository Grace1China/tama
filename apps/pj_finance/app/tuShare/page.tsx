'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { apiBase } from '@/lib/apiBase';
import CsvTableView from '../components/CsvTableView';
import type { CsvTableData } from '../components/CsvTableView';
import { FolderOpen, FileSpreadsheet, ChevronRight, Home } from 'lucide-react';

type ViewMode = 'list' | 'file';

export default function TuSharePage() {
  const [pathSegments, setPathSegments] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [csvData, setCsvData] = useState<CsvTableData | null>(null);
  const [entries, setEntries] = useState<{ dirs: string[]; files: string[] }>({ dirs: [], files: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPath = pathSegments.join('/');

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pathParam = currentPath ? `?path=${encodeURIComponent(currentPath)}` : '';
      const res = await fetch(`${apiBase}/api/tuShare/entries${pathParam}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setEntries({ dirs: json.dirs || [], files: json.files || [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载目录失败');
      setEntries({ dirs: [], files: [] });
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    if (viewMode === 'list') loadEntries();
  }, [viewMode, loadEntries]);

  const handleOpenDir = (name: string) => {
    setPathSegments((prev) => [...prev, name]);
  };

  const handleBreadcrumb = (index: number) => {
    setPathSegments((prev) => prev.slice(0, index));
  };

  const handleOpenFile = async (filename: string) => {
    const filePath = currentPath ? `${currentPath}/${filename}` : filename;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/tuShare/csv?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setSelectedFilePath(filePath);
      setCsvData({
        headers: json.headers || [],
        originalHeaders: json.originalHeaders,
        data: json.data || [],
        totalRows: json.totalRows ?? 0,
        filename: json.filename,
      });
      setViewMode('file');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载文件失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBackFromFile = () => {
    setViewMode('list');
    setSelectedFilePath(null);
    setCsvData(null);
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">TuShare 数据目录</h1>

      {/* 面包屑 */}
      <nav className="flex items-center gap-1 text-sm flex-wrap">
        <Link
          href="#"
          onClick={(e) => {
            e.preventDefault();
            handleBreadcrumb(0);
          }}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <Home className="h-4 w-4" />
          根目录
        </Link>
        {pathSegments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <button
              type="button"
              onClick={() => handleBreadcrumb(i + 1)}
              className="text-muted-foreground hover:text-foreground"
            >
              {seg}
            </button>
          </span>
        ))}
      </nav>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {viewMode === 'list' && (
        <>
          {loading ? (
            <p className="text-muted-foreground">加载中…</p>
          ) : (
            <div className="space-y-4">
              {entries.dirs.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-muted-foreground mb-2">子目录</h2>
                  <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {entries.dirs.map((name) => (
                      <li key={name}>
                        <button
                          type="button"
                          onClick={() => handleOpenDir(name)}
                          className="flex items-center gap-2 w-full rounded-lg border p-3 text-left hover:bg-muted/50"
                        >
                          <FolderOpen className="h-5 w-5 text-amber-500" />
                          {name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {entries.files.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-muted-foreground mb-2">CSV 文件</h2>
                  <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {entries.files.map((name) => (
                      <li key={name}>
                        <button
                          type="button"
                          onClick={() => handleOpenFile(name)}
                          className="flex items-center gap-2 w-full rounded-lg border p-3 text-left hover:bg-muted/50"
                        >
                          <FileSpreadsheet className="h-5 w-5 text-green-600" />
                          {name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!loading && entries.dirs.length === 0 && entries.files.length === 0 && (
                <p className="text-muted-foreground">当前目录为空</p>
              )}
            </div>
          )}
        </>
      )}

      {viewMode === 'file' && csvData && (
        <div className="min-h-[500px]">
          <CsvTableView data={csvData} onBack={handleBackFromFile} />
        </div>
      )}
    </div>
  );
}
