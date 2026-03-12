import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bible Reader',
  description: 'Read the Bible by book and chapter',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 可选：设为空字符串禁用；或指向其他 Umami 实例。不设则用默认地址（若该端 500 需在服务端修）
  const umamiSrc = process.env.NEXT_PUBLIC_UMAMI_SRC ?? 'http://www.quanyuan.live/umami/script.js';
  const umamiWebsiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? '00fe8ddd-43c6-4c19-aa10-4e5f8ac9c8ff';

  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {umamiSrc && (
          <Script
            src={umamiSrc}
            data-website-id={umamiWebsiteId}
            strategy="lazyOnload"
          />
        )}
        <div className="container mx-auto px-4 py-8">
          {children}
        </div>
      </body>
    </html>
  );
}
