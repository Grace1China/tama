'use client';

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import KLineChart from './KLineChart';

interface KLineModalProps {
  open: boolean;
  tsCode: string;
  stockName?: string;
  onClose: () => void;
}

export default function KLineModal({ open, tsCode, stockName, onClose }: KLineModalProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1400] flex items-start justify-center bg-black/50 pt-4 pb-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-[calc(100vh-2rem)] w-[min(1100px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">
              K线图
              {stockName && <span className="ml-1 text-gray-500 font-normal">— {stockName}</span>}
            </h2>
            <div className="text-xs text-gray-400">{tsCode}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* K线图 */}
        <div className="flex-1 min-h-0 overflow-auto">
          <KLineChart tsCode={tsCode} height={Math.max(500, window.innerHeight - 140)} />
        </div>
      </div>
    </div>,
    document.body
  );
}
