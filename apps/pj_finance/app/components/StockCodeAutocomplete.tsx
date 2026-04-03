'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

type StockSearchItem = {
  ts_code: string;
  symbol?: string;
  name?: string;
  cnspell?: string;
  industry?: string;
};

interface StockCodeAutocompleteProps {
  onSelectTsCode: (tsCode: string) => void;
}

export default function StockCodeAutocomplete({ onSelectTsCode }: StockCodeAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [stockUniverse, setStockUniverse] = useState<StockSearchItem[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stockUniverse.slice(0, 20);
    return stockUniverse
      .filter((s) => {
        const tsCode = String(s.ts_code ?? '').toLowerCase();
        const symbol = String(s.symbol ?? '').toLowerCase();
        const name = String(s.name ?? '').toLowerCase();
        const cnspell = String(s.cnspell ?? '').toLowerCase();
        return tsCode.includes(q) || symbol.includes(q) || name.includes(q) || cnspell.includes(q);
      })
      .slice(0, 20);
  }, [query, stockUniverse]);

  const commitSelectedStock = (item: StockSearchItem) => {
    const code = String(item.ts_code ?? '').trim().toUpperCase();
    if (!code) return;
    const name = String(item.name ?? '').trim();
    onSelectTsCode(code);
    setQuery(name ? `${name} (${code})` : code);
    setSuggestOpen(false);
  };

  const commitTypedCodeIfValid = () => {
    const raw = query.trim();
    if (!raw) return;
    const m = raw.match(/(\d{6}\.(?:SZ|SH|BJ))/i);
    if (m) {
      const code = m[1].toUpperCase();
      onSelectTsCode(code);
      setQuery(code);
      return;
    }
    const exact = stockUniverse.find((s) => String(s.name ?? '').trim() === raw);
    if (exact) commitSelectedStock(exact);
  };

  useEffect(() => {
    let cancelled = false;
    const fetchStockUniverse = async () => {
      setSuggestLoading(true);
      try {
        const res = await fetch('/api/csv/stockList?page=1&size=10000');
        const json = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(json?.data) ? json.data : [];
        const list: StockSearchItem[] = rows
          .map((r: any) => ({
            ts_code: String(r?.ts_code ?? '').trim(),
            symbol: String(r?.symbol ?? '').trim(),
            name: String(r?.name ?? '').trim(),
            cnspell: String(r?.cnspell ?? '').trim(),
            industry: String(r?.industry ?? '').trim(),
          }))
          .filter((r: StockSearchItem) => r.ts_code);
        setStockUniverse(list);
      } catch {
        if (!cancelled) setStockUniverse([]);
      } finally {
        if (!cancelled) setSuggestLoading(false);
      }
    };
    fetchStockUniverse();
    return () => {
      cancelled = true;
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative">
      <Input
        id="tsCode"
        type="text"
        placeholder="代码/名称，例如: 000001.SZ 或 丸美生物"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSuggestOpen(true);
        }}
        onFocus={() => {
          if (hideTimerRef.current != null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
          }
          setSuggestOpen(true);
        }}
        onBlur={() => {
          commitTypedCodeIfValid();
          hideTimerRef.current = window.setTimeout(() => {
            setSuggestOpen(false);
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (suggestions.length > 0) {
              commitSelectedStock(suggestions[0]);
            } else {
              commitTypedCodeIfValid();
            }
            return;
          }
          if (e.key === 'Escape') setSuggestOpen(false);
        }}
        className="w-64"
      />
      {suggestOpen && (
        <div className="absolute z-50 mt-1 w-full max-h-72 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {suggestLoading ? (
            <div className="px-3 py-2 text-sm text-gray-500">加载中...</div>
          ) : suggestions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">无匹配结果</div>
          ) : (
            suggestions.map((item) => (
              <button
                key={item.ts_code}
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitSelectedStock(item);
                }}
              >
                <div className="text-sm text-gray-900">{item.name || item.ts_code}</div>
                <div className="text-xs text-gray-500">
                  {item.ts_code}
                  {item.industry ? ` · ${item.industry}` : ''}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
