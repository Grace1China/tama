'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { tsCodeToCninfoScode } from '@/lib/cninfoScode';

type P3085Record = Record<string, string | number | null | undefined>;

function sortRecordsByTimeDesc(records: P3085Record[]): P3085Record[] {
  return [...records].sort((a, b) => {
    const ta = Date.parse(String(a.F001D ?? '').replace(/-/g, '/'));
    const tb = Date.parse(String(b.F001D ?? '').replace(/-/g, '/'));
    const na = Number.isFinite(ta) ? ta : 0;
    const nb = Number.isFinite(tb) ? tb : 0;
    return nb - na;
  });
}

function isPdfRecord(r: P3085Record): boolean {
  const fmt = String(r.F004V ?? '').toUpperCase();
  const url = String(r.F003V ?? '');
  return fmt.includes('PDF') && /^https?:\/\//i.test(url);
}

export type CninfoStockRecentInfoModalProps = {
  open: boolean;
  tsCode: string;
  onClose: () => void;
};

export function CninfoStockRecentInfoModal({ open, tsCode, onClose }: CninfoStockRecentInfoModalProps) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [payload, setPayload] = useState<{ total?: number; records?: P3085Record[] } | null>(null);
  const [selectedPdfUrl, setSelectedPdfUrl] = useState<string | null>(null);
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);

  const scode = useMemo(() => tsCodeToCninfoScode(tsCode), [tsCode]);

  const load = useCallback(async () => {
    if (!scode) {
      setErr('无法解析证券代码');
      setPayload(null);
      return;
    }
    setLoading(true);
    setErr(null);
    setPayload(null);
    setSelectedPdfUrl(null);
    setExpandedRowKey(null);
    try {
      const res = await fetch(`/api/cninfo/p-info3085?scode=${encodeURIComponent(scode)}`);
      const json = await res.json();
      if (!res.ok) {
        setErr(typeof json?.error === 'string' ? json.error : `请求失败 ${res.status}`);
        return;
      }
      const resultcode = (json as { resultcode?: number }).resultcode;
      if (resultcode != null && resultcode !== 200) {
        setErr(String((json as { resultmsg?: string }).resultmsg ?? `巨潮 resultcode=${resultcode}`));
        return;
      }
      const total = (json as { total?: number }).total;
      const raw = (json as { records?: unknown }).records;
      const records = Array.isArray(raw) ? (raw as P3085Record[]) : [];
      setPayload({ total, records });
      const firstPdf = sortRecordsByTimeDesc(records).find((r) => isPdfRecord(r));
      if (firstPdf?.F003V) setSelectedPdfUrl(String(firstPdf.F003V));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [scode]);

  useEffect(() => {
    if (open && scode) void load();
  }, [open, scode, load]);

  const sortedRecords = useMemo(
    () => sortRecordsByTimeDesc(payload?.records ?? []),
    [payload?.records]
  );

  const pdfRecords = useMemo(() => sortedRecords.filter(isPdfRecord), [sortedRecords]);

  if (!open || typeof document === 'undefined') return null;

  const title = scode ? `${tsCode}（巨潮 p_info3085 · ${scode}）` : tsCode;

  return createPortal(
    <div
      className="fixed inset-0 z-[1410] flex items-start justify-center bg-black/40 pt-4 pb-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-[calc(100vh-2rem)] w-[min(1200px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="min-w-0 pr-4">
            <div className="text-sm font-semibold text-gray-900">巨潮 · 证券公开信息</div>
            <div className="truncate text-xs text-gray-500">{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-gray-200 lg:border-b-0 lg:border-r">
            <div className="shrink-0 border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {loading
                ? '加载中…'
                : err
                  ? `加载失败：${err}`
                  : payload
                    ? `共 ${payload.total ?? sortedRecords.length} 条，本页展示 ${sortedRecords.length} 条（按发布时间倒序）`
                    : '无数据'}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {sortedRecords.length > 0 && (
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-gray-100 text-gray-700">
                    <tr>
                      <th className="border-b border-gray-200 px-2 py-2 font-medium whitespace-nowrap">
                        发布时间
                      </th>
                      <th className="border-b border-gray-200 px-2 py-2 font-medium">标题</th>
                      <th className="border-b border-gray-200 px-2 py-2 font-medium whitespace-nowrap">类型</th>
                      <th className="border-b border-gray-200 px-2 py-2 font-medium whitespace-nowrap">操作</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-800">
                    {sortedRecords.map((r) => {
                      const rowKey = String(r.TEXTID ?? r.RECID ?? `${r.F001D}-${r.F002V}`);
                      const pdf = isPdfRecord(r) ? String(r.F003V) : '';
                      return (
                        <tr key={rowKey} className="border-b border-gray-100 hover:bg-gray-50/80">
                          <td className="max-w-[140px] whitespace-nowrap px-2 py-1.5 align-top text-gray-600">
                            {r.F001D ?? '—'}
                          </td>
                          <td className="min-w-[200px] max-w-[420px] px-2 py-1.5 align-top">
                            <div className="font-medium text-gray-900">{r.F002V ?? '—'}</div>
                            {expandedRowKey === rowKey && (
                              <pre className="mt-1 max-h-40 overflow-auto rounded border border-gray-100 bg-gray-50 p-2 text-[10px] leading-snug text-gray-600">
                                {JSON.stringify(r, null, 2)}
                              </pre>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 align-top">{r.F004V ?? '—'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 align-top">
                            <div className="flex flex-wrap gap-1">
                              {pdf ? (
                                <button
                                  type="button"
                                  className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-800 hover:bg-blue-100"
                                  onClick={() => setSelectedPdfUrl(pdf)}
                                >
                                  PDF预览
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="rounded border border-gray-200 px-2 py-0.5 text-gray-600 hover:bg-gray-100"
                                onClick={() =>
                                  setExpandedRowKey((v) => (v === rowKey ? null : rowKey))
                                }
                              >
                                {expandedRowKey === rowKey ? '收起字段' : '原始字段'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="flex min-h-[280px] w-full shrink-0 flex-col bg-gray-50 lg:w-[44%] lg:max-w-[520px]">
            <div className="shrink-0 border-b border-gray-200 px-3 py-2 text-xs font-medium text-gray-700">
              PDF 浏览
            </div>
            <div className="shrink-0 space-y-2 border-b border-gray-200 p-2">
              {pdfRecords.length === 0 ? (
                <p className="text-xs text-gray-500">本批数据中无 PDF 直达链接</p>
              ) : (
                <>
                  <p className="text-[10px] text-gray-500">
                    部分 PDF 因站点策略无法在框内打开，可用「新窗口」查看。
                  </p>
                  <div className="max-h-28 overflow-y-auto space-y-1">
                    {pdfRecords.slice(0, 80).map((r) => {
                      const url = String(r.F003V);
                      const id = String(r.TEXTID ?? r.RECID ?? url);
                      return (
                        <div key={id} className="flex items-start gap-1">
                          <button
                            type="button"
                            className={`shrink-0 rounded px-1.5 py-0.5 text-left text-[10px] leading-tight ${
                              selectedPdfUrl === url
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-blue-700 ring-1 ring-gray-200 hover:bg-blue-50'
                            }`}
                            title={String(r.F002V ?? '')}
                            onClick={() => setSelectedPdfUrl(url)}
                          >
                            {String(r.F001D ?? '').slice(0, 10)}
                          </button>
                          <span
                            className="min-w-0 flex-1 truncate text-[10px] text-gray-600"
                            title={String(r.F002V ?? '')}
                          >
                            {r.F002V}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {pdfRecords.length > 80 ? (
                    <p className="text-[10px] text-gray-400">
                      仅列出前 80 个 PDF，更多请用左侧表格「PDF预览」。
                    </p>
                  ) : null}
                </>
              )}
              {selectedPdfUrl ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <a
                    href={selectedPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-700 underline"
                  >
                    新窗口打开 PDF
                  </a>
                </div>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 p-2">
              {selectedPdfUrl ? (
                <iframe
                  title="PDF 预览"
                  src={selectedPdfUrl}
                  className="h-full min-h-[320px] w-full rounded border border-gray-200 bg-white"
                />
              ) : (
                <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-gray-400">
                  选择左侧「PDF预览」或右侧列表中的日期以预览
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-3 py-2 text-[10px] text-gray-500">
          数据来自巨潮资讯接口 p_info3085；常见字段：F002V 标题、F001D 时间、F003V 链接、F004V 格式。
        </div>
      </div>
    </div>,
    document.body
  );
}
