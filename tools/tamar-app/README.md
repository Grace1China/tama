# tamar App

一个可连接的只读应用。进程起来之后，Cursor 里添加 **tamar App**，同一次连接得到三个 MCP 入口：产业链、财务指标对比分析、个股详情。

它不挂进现有工程的自动发现，也不是 3001 页面或 3011 `tama-dual-mcp` 的扩展。三个入口跑在同一个进程里。

默认只听 `127.0.0.1:3012`。不使用 3000、3001、3011。日志和巨潮缓存只写本目录的 `var/`，不写 YAML，不写 parquet，不调用 Tushare，也不构建产业链指数。

## 安装

```bash
cd tools/tamar-app
npm install
```

## 启动

数据根指向已经下载好的本地目录。产业链 YAML 在财务应用里，不在数据根里。

```bash
export TAMA_DATA_ROOT="/Users/daniel/history/明明和心宝/temp"
export TAMAR_TAXONOMY_DIR="/path/to/tama/apps/pj_finance/app/industryLink/taxonomies"
export TAMAR_APP_HOME="$PWD/var"
export TAMAR_APP_HOST="127.0.0.1"
export TAMAR_APP_PORT="3012"
npm start
```

`TAMAR_TAXONOMY_DIR` 可以不设。未设置时会尝试仓库里的 `apps/pj_finance/app/industryLink/taxonomies`。公司代码表默认读该目录，或它的上一级 `industry_company_ts_codes.yaml`。

健康检查：

```bash
curl -s http://127.0.0.1:3012/health
```

返回三个入口、数据根和进程状态。可选 `TAMAR_APP_TOKEN`。设置之后，三个 MCP 路径都要求 `Authorization: Bearer <token>`。

## 在 Cursor 里连接 tamar App

先启动上面的进程，再在 Cursor Settings 里添加自定义 MCP 应用，名称用 **tamar App**。把三个服务器指到本机 3012，不要改已有的 MCP 配置文件。本目录的 `mcp.tamar-app.example.json` 只是示例：

- `tamar-industry`：`http://127.0.0.1:3012/industry/mcp`（产业链）
- `tamar-contrast`：`http://127.0.0.1:3012/contrast/mcp`（财务指标对比分析）
- `tamar-stock`：`http://127.0.0.1:3012/stock/mcp`（个股详情）

HTTP 是这个应用的主形态。如果某个客户端只接受 stdio，可以单独起一个入口，三个入口不要共用一个 stdio 进程：

```bash
TAMAR_APP_TRANSPORT=stdio TAMAR_APP_STDIO_ENTRY=industry npm start
```

`TAMAR_APP_STDIO_ENTRY` 取 `industry`、`contrast` 或 `stock`。

## 和 3001、3011 的关系

| 进程 | 端口 | 作用 |
| --- | --- | --- |
| 财务页面 | 3001 | 原有 Next 页面和 API |
| tama-dual-mcp | 3011 | 本地历史表和巨潮公告 |
| tamar App | 3012 | 本包的三个只读入口 |

三者同时开着互不影响。本服务不刷新页面用的 parquet。

## as_of

行情结果带 `as_of`、`as_of_source`、`queried_at`（Asia/Shanghai）。`as_of` 早于预期最近交易日时 `stale=true`。预期交易日只跳过周末：工作日 15:00 之后视为当日已收盘，此前回退到上一个工作日。文件不存在或没有记录时 `missing=true`。这时不能把结果说成今日收盘。

2026-11-10 核对过的本地数据：个股 K 线和 `daily_basic` 到 **20261109**，东财资金流向可能到 **20261110**，`sw_daily` 可能仍停在 **20261106**。个股卡片不用 `sw_daily`。`daily_basic` 与资金流向的 `as_of` 会分开标。

财报的 `as_of` 是报告期。报告期早于交易日不算行情过期。请求窗口默认 `2014Q1` 到 `2026Q4`；若最新报告期是 `2026Q3`，`2026Q4` 的数值为 null。

## 口径

- `ts_code` 可以是 `688072.SH`，也可以是 6 位代码。688/6 开头为上交所，0/3 为深交所，4/8 为北交所。
- 前复权价 = 不复权价 × 当日复权因子 / 该股最新复权因子。复权因子按行情日做 ASOF。不读取 `qfqDir.parquet`。
- 产业链 d1 优先用不复权 `pct_chg`。d5、d20、d60 分别对照倒序第 6、21、61 根交易日，单位是百分数。
- 指标引擎里的毛利率、净利率、杜邦 ROE 是 `ratio_0_1`，返回里同时给出 `percent_value`。CAGR 和行情涨跌幅本身就是 `percent`。总市值单位是万元。
- `industry_company_lookup` 返回全部产业链命中。拓荆科技、华海清科会同时出现在 tao 和 hbm，并标明来源。对比行只有传入 `taxonomy_id` 或 `lane` 时才按该链覆盖子泳道，不会合成一条混合链。
- 现金流量表用 `cashflow_vip_ss.parquet`，费用列是 `finan_exp`。利润表费用列是 `fin_exp`。一季报、三季报的 `net_profit` 允许为空。
- 回购、增减持、解禁的金额保持源数据单位，多数是人民币元。
- 融资融券的 `margin` 和 `slb_len` 是全市场表，不会当成单只股票。
- 集合竞价读 `auction/latest.json`。当前文件不存在时返回 `missing: true`。

## 工具

产业链 `/industry/mcp`

- `industry_list_taxonomies`
- `industry_get_taxonomy`
- `industry_company_lookup`
- `industry_sublane_companies`
- `industry_price_snapshots`
- `industry_financial_quality`
- `industry_financial_growth`
- `industry_market_breadth`
- `industry_auction_snapshots`
- `industry_card`

财务对比 `/contrast/mcp`

- `contrast_resolve_names`
- `contrast_stock_basic`
- `contrast_metrics_series`
- `contrast_market_series`
- `contrast_kline`
- `contrast_report_links`
- `contrast_main_business`
- `contrast_build_row`

个股 `/stock/mcp`

- `stock_profile`
- `stock_cninfo_disclosures`
- `stock_kline`
- `stock_holders`
- `stock_corporate_actions`
- `stock_shock`
- `stock_margin`
- `stock_financial_statement`
- `stock_forecast`
- `stock_main_business`

## 验证

```bash
npm run typecheck
npm test
```

测试使用同结构的小型夹具，不读取 15GB 的真实 parquet。
