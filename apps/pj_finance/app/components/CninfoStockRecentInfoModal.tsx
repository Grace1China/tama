'use client';

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { CninfoStockRecentInfoPanel } from './CninfoStockRecentInfoPanel';

export type CninfoStockRecentInfoModalProps = {
  open: boolean;
  tsCode: string;
  onClose: () => void;
};

/** @deprecated 请使用 StockDetailModal；保留兼容旧调用 */
export function CninfoStockRecentInfoModal({ open, tsCode, onClose }: CninfoStockRecentInfoModalProps) {
  if (!open || typeof document === 'undefined') return null;

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
            <div className="truncate text-xs text-gray-500">{tsCode}</div>
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
        <CninfoStockRecentInfoPanel tsCode={tsCode} active={open} />
      </div>
    </div>,
    document.body,
  );
}
