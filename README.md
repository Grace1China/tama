# Next.js Monorepo

pnpm workspace，包含两个 Next.js 应用和一个共享包。

## 目录结构

```
├── apps/
│   ├── pj_finance/   # 金融项目 (端口 3000)
│   └── pj_bible/     # 圣经项目 (端口 3001)
├── packages/
│   └── shared/       # 共享代码（工具、类型、通用组件等）
├── package.json
└── pnpm-workspace.yaml
```

## 环境要求

- Node.js >= 18
- npm 7+（内置 workspaces）或 pnpm

## 安装

```bash
npm install
# 或
pnpm install
```

## 开发

```bash
# 仅启动 pj_finance (http://localhost:3000)
npm run dev:finance

# 仅启动 pj_bible (http://localhost:3001)
npm run dev:bible

# 同时启动两个应用（后台并行）
npm run dev
```

## 构建

```bash
# 构建所有应用
npm run build

# 单独构建
npm run build:finance
npm run build:bible
```

## 使用共享包

在 `apps/pj_finance` 或 `apps/pj_bible` 中：

```ts
import { greet, sharedVersion } from 'shared';
```

两个应用的 `next.config.js` 已配置 `transpilePackages: ['shared']`，无需额外构建 shared。

## 代码迁移

1. 将原 pj_finance 的页面、组件、API 等迁入 `apps/pj_finance/`（保留现有 `app/` 结构即可）。
2. 将原 pj_bible 的代码迁入 `apps/pj_bible/`。
3. 公共逻辑、类型、UI 组件可放入 `packages/shared/src/`，再在各自 app 中通过 `import from 'shared'` 使用。

## 其他命令

- `npm run lint`：在所有子项目中执行 lint
- `npm run clean`：删除各项目中的 `.next` 和 `node_modules`
