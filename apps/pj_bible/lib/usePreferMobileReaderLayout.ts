'use client';

import { useSyncExternalStore } from 'react';

/** 与 Tailwind md 分界一致：及以下视为使用手机阅读版面（单列 /mobile/whole） */
const MOBILE_BOOK_READER_MEDIA = '(max-width: 767px)';

function subscribeMobileReaderMedia(callback: () => void): () => void {
  const mq = window.matchMedia(MOBILE_BOOK_READER_MEDIA);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function snapshotMobileReader(): boolean {
  return window.matchMedia(MOBILE_BOOK_READER_MEDIA).matches;
}

/** 服务端与首帧假定为桌面路径，水合后按视口切换 */
function serverSnapshotMobileReader(): boolean {
  return false;
}

/**
 * 书卷入口页等：窄屏时链接应指向 /book/mobile/whole/...，避免再进桌面横滑版。
 */
export function usePreferMobileReaderLayout(): boolean {
  return useSyncExternalStore(
    subscribeMobileReaderMedia,
    snapshotMobileReader,
    serverSnapshotMobileReader,
  );
}
