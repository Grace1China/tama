import type { Metadata } from 'next';
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
        <div className="container mx-auto px-4 py-8">
          {children}
        </div>
      </body>
    </html>
  );
}
