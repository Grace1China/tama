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
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <script defer src="http://www.quanyuan.live/umami/script.js" data-website-id="00fe8ddd-43c6-4c19-aa10-4e5f8ac9c8ff"></script>
        <div className="container mx-auto px-4 py-8">
          {children}
        </div>
      </body>
    </html>
  );
}
