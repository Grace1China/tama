# tama / pj_finance MCP Server

This is a shared Streamable HTTP MCP server for local research over `apps/pj_finance` data.
Claude, Cursor, and Codex can connect to the same long-running process while keeping independent MCP sessions.

## Run

在仓库根目录，一条命令启动 Web + MCP：

```bash
npm run dev:finance:stack
```

Endpoints:

- MCP: `http://127.0.0.1:3001/mcp`
- Health: `http://127.0.0.1:3001/health`

仅启动共享 MCP：

```bash
npm run dev:mcp:http -w pj_finance
```

stdio 仅保留兼容和单客户端调试：

```bash
npm run dev:mcp:stdio -w pj_finance
```

## Client configuration

先启动共享服务，然后让三个客户端都指向同一 URL。

Codex CLI:

```bash
codex mcp add tama-finance --url http://127.0.0.1:3001/mcp
```

Cursor project/global MCP JSON:

```json
{
  "mcpServers": {
    "tama-finance": {
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

Claude Code:

```bash
claude mcp add --transport http tama-finance http://127.0.0.1:3001/mcp
```

If a particular desktop UI does not expose URL-based MCP configuration, configure its matching
CLI/project MCP file or use the product's “remote/HTTP MCP” form.

## Network and authentication

The default bind address is loopback-only and is intended for clients on this machine.

Optional environment variables:

- `MCP_HOST`: default `127.0.0.1`.
- `MCP_PORT`: default `3001`.
- `MCP_AUTH_TOKEN`: optional bearer token required on `/mcp`.
- `MCP_ALLOWED_ORIGINS`: comma-separated browser origins.
- `MCP_ALLOWED_HOSTS`: required when binding `0.0.0.0` or `::`.

Example with bearer authentication:

```bash
MCP_AUTH_TOKEN='replace-me' npm run dev:mcp:http -w pj_finance
codex mcp add tama-finance \
  --url http://127.0.0.1:3001/mcp \
  --bearer-token-env-var TAMA_MCP_TOKEN
```

For access from another machine, use HTTPS behind a reverse proxy or an SSH tunnel. Do not expose
the unauthenticated plaintext endpoint directly to the internet.

## Tools

### 通用金融数据

- `cninfo_list_disclosures(ts_code, limit?)`
  - Uses the existing server-side `p_info3085` helper.
  - Accepts `600176.SH` or `600176`.

- `cninfo_download_annual_report(ts_code, year)`
  - Finds the full annual report PDF for the requested year.
  - Saves under `apps/pj_finance/temp/cninfo/report/`.
  - Returns local path, title, announcement date, and CNINFO PDF URL.

- `cninfo_search_pdf(ts_code, year, keywords, context_chars?)`
  - Searches an already-downloaded annual report, or downloads it first.
  - Uses local Python PDF extraction (`fitz` first, `pypdf` fallback).
  - Returns per-keyword hit counts, page numbers, and snippets.

- `finance_metrics(ts_code, annual_years?)`
  - Reads local parquet files from `apps/pj_finance/temp/tuShare/`.
  - Returns annual revenue, parent net profit, gross margin, operating cash flow, balance sheet summary, and a lightweight TTM snapshot.

- `parquet_query(table, ts_code?, fields?, start_date?, end_date?, limit?)`
  - Safe whitelist query; no arbitrary SQL input.
  - Tables: `income`, `cashflow`, `balance`, `fina_indicator`, `daily_basic`, `sw_daily`, `index_member_all`, `index_classify_SW2021`.

### 产业链

- `industry_taxonomy_list()`
  - Lists enabled taxonomy IDs, labels, display order, and unique company counts.

- `industry_taxonomy_get(id)`
  - Reads one complete taxonomy YAML from `app/industryLink/taxonomies`.

- `industry_company_context(company_name)`
  - Scans all taxonomy YAML files.
  - Returns matched chain, stage, sub-track, selected reason, industry role, elasticity factors, reasons, risks, and links.

- `industry_chain_index_preview(taxonomy_id)`
  - Extracts eligible companies from an existing industry-chain taxonomy.
  - Resolves `ts_code` from the card or `industry_company_ts_codes.yaml`.
  - Supports scalar company overrides: `指数纳入`, `业务纯度`, `指数权重`.

- `industry_chain_index_build(taxonomy_id, start_date, end_date, weight_method?, max_weight?, base_value?, output_path?, price_parquet?, market_cap_parquet?)`
  - Builds a research price index from the current taxonomy companies.
  - Default method is `chain_balanced`: equal budget per sub-track, then
    `sqrt(float market cap) × purity score` within the sub-track, with a 10% constituent cap.
  - Other methods: `equal`, `float_mv`, `capped_float_mv`, `manual`.
  - Uses Tushare qfq prices and `daily_basic.circ_mv` unless local parquet inputs are supplied.
  - Writes daily index rows and base-date constituent weights into one parquet file under
    `mcp/data/industry_chain_index/` by default.
  - See `mcp/INDUSTRY_CHAIN_INDEX.md` for methodology and editing rules.

- `industry_company_evidence(taxonomy_id, company_name, year?, apply?, analysis_fields?)`
  - Processes exactly one company in one taxonomy file under `app/industryLink/taxonomies/`.
  - Examples of `taxonomy_id`: `tao`, `copper`, `optical_communication`, `space_compute`.
  - Uses `industry_company_ts_codes.yaml` to map company name to `ts_code`.
  - Calls the existing local tools internally:
    - `finance_metrics` for annual revenue / parent net profit growth.
    - `cninfo_search_pdf` for 2025 annual report evidence; if the PDF is not local, it downloads only this one company's annual report via `cninfo_download_annual_report`.
  - Extracts evidence for these card fields: `产品`, `成长性`, `行业空间`, `护城河`, `技术壁垒`.
  - Writes an audit log to `app/industryLink/research_logs/<taxonomy_id>_<公司>_<年份>_evidence.md`.
  - `apply=false` by default: collect annual-report evidence and generate an evidence draft only.
  - `apply=true`: requires complete `analysis_fields` and writes those researched conclusions back into the selected taxonomy YAML.
  - Raw keyword-hit slices are evidence, not analysis, and cannot be written directly to taxonomy YAML.

Example tool arguments:

```json
{
  "taxonomy_id": "tao",
  "company_name": "中际旭创",
  "year": 2025,
  "apply": true,
  "analysis_fields": {
    "产品": "基于年报页码归纳的产品结构",
    "成长性": "解释收入、利润及异常同比口径",
    "行业空间": "结合年报或研报来源判断产品市场空间",
    "护城河": "归纳客户、规模、认证、量产和供应链能力",
    "技术壁垒": "归纳核心工艺、研发平台和量产难点"
  }
}
```

Recommended workflow: run `industry_company_evidence` one company at a time. Do not batch all companies against CNINFO, so that annual-report downloads remain gentle and reviewable.

## Notes

- The main server uses the official MCP TypeScript SDK and Streamable HTTP.
- Each client initialization receives an independent MCP session; tools and local data are shared.
- CNINFO tools require network access.
- Parquet tools require the local `temp/tuShare` symlink/data to exist.
- PDF search requires a Python environment with `fitz` or `pypdf` available.
