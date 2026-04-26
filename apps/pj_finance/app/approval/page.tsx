'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

type Suggestion = {
  id: string;
  type: 'rebalance' | 'swap';
  action: 'buy' | 'sell';
  ts_code: string;
  name: string;
  shares: number;
  reason: string;
  created_at: string;
};

type LogEntry = {
  id: string;
  suggestion_id: string;
  action: 'approved' | 'rejected';
  ts_code: string;
  name: string;
  shares: number;
  type: string;
  reason: string;
  timestamp: string;
};

export default function ApprovalPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [sugRes, logRes] = await Promise.all([
        fetch('/api/portfolio?resource=suggestions'),
        fetch('/api/portfolio?resource=log'),
      ]);
      const sugJson = await sugRes.json();
      const logJson = await logRes.json();
      setSuggestions(Array.isArray(sugJson?.data) ? sugJson.data : []);
      setLogs(Array.isArray(logJson?.data) ? logJson.data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAction = async (sugId: string, action: 'approve' | 'reject') => {
    setActioningId(sugId);
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, suggestion_id: sugId }),
      });
      if (res.ok) {
        const json = await res.json();
        setSuggestions((prev) => prev.filter((s) => s.id !== sugId));
        if (json?.log) setLogs((prev) => [...prev, json.log]);
      }
    } catch { /* ignore */ }
    setActioningId(null);
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="w-full p-8 flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 p-4">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">调仓审批流</h1>
          <p className="text-sm text-gray-500 mt-1">审批由系统生成的调仓建议，同意后自动更新持仓</p>
        </div>
        <Link href="/holdings">
          <Button variant="outline">← 返回持仓看板</Button>
        </Link>
      </div>

      {/* suggestions */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">
          待审批建议
          <span className="ml-2 text-sm font-normal text-gray-400">({suggestions.length} 条)</span>
        </h2>

        {suggestions.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <div className="text-gray-400 text-sm">暂无待审批的调仓建议</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {suggestions.map((sug) => {
              const isRebalance = sug.type === 'rebalance';
              const isBuy = sug.action === 'buy';
              const isActioning = actioningId === sug.id;

              return (
                <div
                  key={sug.id}
                  className={`rounded-lg border-l-4 bg-white shadow-sm p-5 space-y-3 ${
                    isRebalance ? 'border-l-blue-500 border border-blue-100' : 'border-l-amber-500 border border-amber-100'
                  }`}
                >
                  {/* card header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                        isRebalance ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                      }`}>
                        {isRebalance ? '大类再平衡' : '内部优胜劣汰'}
                      </span>
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                        isBuy ? 'bg-red-50 text-red-700 ring-1 ring-red-200' : 'bg-green-50 text-green-700 ring-1 ring-green-200'
                      }`}>
                        {isBuy ? '买入' : '卖出'}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">{formatTime(sug.created_at)}</span>
                  </div>

                  {/* details */}
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-bold text-gray-900">{sug.name}</span>
                      <span className="text-sm text-gray-500">{sug.ts_code}</span>
                    </div>
                    <div className="text-sm text-gray-700 mt-1">
                      {isBuy ? '买入' : '卖出'} <span className="font-semibold">{sug.shares}</span> 股
                    </div>
                  </div>

                  {/* reason */}
                  <div className="rounded-md bg-gray-50 p-3">
                    <div className="text-xs text-gray-500 mb-1">推荐逻辑</div>
                    <div className="text-sm text-gray-700 leading-relaxed">{sug.reason}</div>
                  </div>

                  {/* action buttons */}
                  <div className="flex items-center gap-3 pt-1">
                    <Button
                      size="sm"
                      onClick={() => handleAction(sug.id, 'approve')}
                      disabled={isActioning}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {isActioning ? '处理中...' : '✓ 同意执行'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAction(sug.id, 'reject')}
                      disabled={isActioning}
                      className="text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                    >
                      ✕ 驳回
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* execution log */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">
          执行日志
          <span className="ml-2 text-sm font-normal text-gray-400">({logs.length} 条)</span>
        </h2>

        {logs.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-6 text-center">
            <div className="text-gray-400 text-sm">暂无执行记录</div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">时间</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">操作</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">类型</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">标的</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">股数</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">逻辑</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...logs].reverse().map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{formatTime(entry.timestamp)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                        entry.action === 'approved'
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                          : 'bg-red-50 text-red-700 ring-1 ring-red-200'
                      }`}>
                        {entry.action === 'approved' ? '已执行' : '已驳回'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{entry.type}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-gray-900">{entry.name}</span>
                      <span className="text-gray-400 ml-1 text-xs">{entry.ts_code}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-700">{entry.shares}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 max-w-xs truncate" title={entry.reason}>{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
