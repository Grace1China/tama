# CSV数据查看器

一个基于Next.js的CSV文件查看器，用于展示财务数据。

## 功能特性

- 📊 查看三个目录下的CSV文件：
  - `fiIndicator` - 财务指标数据
  - `indicator` - 交易指标数据
  - `profit` - 利润表数据
- 🎨 现代化的UI设计
- 📱 响应式布局，支持移动端
- 🔄 实时切换不同数据源
- 📈 表格展示，支持滚动查看大量数据

## 安装和运行

### 1. 安装依赖

```bash
npm install
```

### 2. 运行开发服务器

```bash
npm run dev
```

### 3. 打开浏览器

访问 [http://localhost:3000](http://localhost:3000)

## 项目结构

```
数据宝/
├── app/
│   ├── api/
│   │   └── csv/
│   │       └── [category]/
│   │           └── route.ts    # API路由，读取CSV文件
│   ├── globals.css              # 全局样式
│   ├── layout.tsx               # 根布局
│   └── page.tsx                 # 主页面
├── fiIndicator/                 # 财务指标CSV文件目录
├── indicator/                   # 交易指标CSV文件目录
├── profit/                      # 利润表CSV文件目录
├── package.json
├── next.config.js
└── tsconfig.json
```

## 技术栈

- **Next.js 14** - React框架
- **TypeScript** - 类型安全
- **PapaParse** - CSV解析库
- **CSS** - 样式设计

## 使用说明

1. 在页面顶部点击不同的标签页切换数据源
2. 表格会自动加载对应目录下的CSV文件
3. 可以滚动查看所有数据
4. 表格支持横向滚动以查看所有列

## 构建生产版本

```bash
npm run build
npm start
```

