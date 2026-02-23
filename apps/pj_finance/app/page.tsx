import Link from 'next/link';
import {
  List,
  Calculator,
  TrendingUp,
  FileText,
  BarChart3,
} from 'lucide-react';

const categories = [
  { id: 'stockList', name: '股票列表', path: '/stockList', icon: List, desc: '查看所有股票基本信息' },
  { id: 'fiIndicator', name: '财务指标', path: '/fiIndicator', icon: Calculator, desc: '分析公司财务健康状况' },
  { id: 'indicator', name: '交易指标', path: '/indicator', icon: TrendingUp, desc: '查看股票交易相关指标' },
  { id: 'profit', name: '利润表', path: '/profit', icon: FileText, desc: '查看公司利润数据' },
  { id: 'ths_index', name: '同花顺指数', path: '/ths_index', icon: BarChart3, desc: '查看同花顺行业指数' },
];

export default function Home() {
  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">欢迎使用数据宝</h1>
        <p className="mt-2 text-gray-600">选择左侧菜单中的模块开始查看数据，或点击下方快捷入口</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((category) => (
          <Link
            key={category.id}
            href={category.path}
            className="group flex items-start gap-4 p-4 rounded-lg border border-gray-200 bg-white hover:border-primary hover:shadow-md transition-all"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
              <category.icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">{category.name}</h2>
              <p className="mt-1 text-sm text-gray-500">{category.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

