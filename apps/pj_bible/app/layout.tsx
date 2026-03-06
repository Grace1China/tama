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
        <Script
          defer
          src="http://localhost:3001/script.js"
          data-website-id="61d289f8-07c4-4868-8115-e0d7966ee619"
        />
        <div className="container mx-auto px-4 py-8">
          {children}
        </div>
      </body>
    </html>
  );
}
