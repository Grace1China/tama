# 产业链因子事件库

本目录用 JSONL 先落地因子事件数据。JSONL 的每一行是一条独立 JSON，方便追加、diff、抽样检查，也方便后续迁移到 SQLite 或 Postgres。

## 文件结构

- `manifest.yaml`: 数据文件、schema 和状态枚举的索引。
- `collection_channels.yaml`: 当前可采集渠道、启用状态和依赖条件。
- `data/raw_messages.jsonl`: 原始消息池，存新闻、公告、研报摘要、手动录入消息。
- `data/events.jsonl`: 从原始消息中识别出的因子事件。
- `data/impacts.jsonl`: 因子事件映射到产业链和二级子泳道的影响。
- `schemas/*.schema.json`: 三类 JSONL 行记录的字段约束。
- `examples/*.jsonl`: 示例数据，不作为正式数据源。
- `scripts/*.mjs`: 原始消息采集与追加脚本。

正式 `data/*.jsonl` 可在第一次写入时创建。不要把示例数据复制到正式数据文件里。

## 操作流程

1. 写入原始消息
   - 新消息先追加到 `data/raw_messages.jsonl`。
   - 用 `raw_hash` 做去重，建议对 `source + source_url + title + published_at + content` 生成稳定 hash。
   - 当前已可用渠道：
     - `llm_web_search`: 使用元宝、ChatGPT、Perplexity 等带联网搜索能力的大模型按提示词输出 JSONL。
     - `deepseek_candidates`: 使用 DeepSeek API 生成候选消息，再由 Codex/人工联网验证。
     - `manual`: 手动录入新闻、研报摘要、会议纪要、临时线索。
     - `cninfo_disclosure`: 通过巨潮 p_info3085 采集单个公司的公告标题。

2. 识别因子事件
   - 用规则或 LLM 读取 `raw_messages.jsonl`。
   - 命中 `../factor_taxonomy/factors/*.yaml` 后，追加一条或多条记录到 `data/events.jsonl`。
   - 同一条原始消息可以生成多个事件。

3. 映射产业链影响
   - 根据因子文件的 `beneficiaries[].positive_sub_lanes` 生成 `data/impacts.jsonl`。
   - `chain_id` 必须对应 `../taxonomies/{chain_id}.yaml`。
   - `sub_lane_title` 必须完全匹配对应 taxonomy 的二级标题。

4. 人工确认
   - 新事件默认 `status: pending`。
   - 确认后改写为 `confirmed`，误判写成 `rejected`，过期写成 `archived`。
   - JSONL 不适合原地更新，建议采用追加修订记录或用脚本重写文件。

5. 前端消费
   - 产业链页面可按 `chain_id + sub_lane_title` 读取最近 `confirmed` 事件。
   - 因子页可按 `factor_id` 聚合事件列表和影响链条。

## ID 约定

- `raw_message.id`: `raw_YYYYMMDD_{shortHash}`
- `event.id`: `evt_YYYYMMDD_{factor_id}_{shortHash}`
- `impact.id`: `imp_{eventShortId}_{chain_id}_{n}`
- `dedupe_key`: 用于事件去重，建议包含 `factor_id + event_type + event_date + key_fact_hash`。

## 采集命令

使用大模型联网搜索采集：

1. 打开 [llm_web_search_raw_messages.md](./prompts/llm_web_search_raw_messages.md)，替换 `{{factor_id}}`、`{{query_scope}}`、`{{lookback_window}}` 等变量。
2. 把提示词提交给元宝或其它带 web search 的模型。
3. 将模型返回的 JSONL 保存为临时文件，例如 `/tmp/ai_capex_raw_messages.jsonl`。
4. 去重追加到正式 raw_messages：

```bash
node apps/pj_finance/app/industryLink/factor_events/scripts/append_raw_messages_jsonl.mjs \
  --input /tmp/ai_capex_raw_messages.jsonl
```

使用 DeepSeek API 生成候选消息：

```bash
DEEPSEEK_API_KEY=你的key \
node apps/pj_finance/app/industryLink/factor_events/scripts/collect_deepseek_candidates.mjs \
  --factor-id ai_capex \
  --query-scope "海外云厂商资本开支、AI数据中心、光模块、电力设备、液冷" \
  --lookback-window "最近30天" \
  --max-items 10
```

候选文件会输出到：

```text
apps/pj_finance/app/industryLink/factor_events/candidates/ai_capex_raw_messages.candidates.jsonl
```

这些候选消息不要直接入库。先由 Codex 或人工按 `metadata.search_queries` 和 `source_url` 做联网验证，确认后再导入正式 `data/raw_messages.jsonl`。

手动追加一条消息：

```bash
node apps/pj_finance/app/industryLink/factor_events/scripts/append_raw_message.mjs \
  --title "云厂商上修AI基础设施资本开支指引" \
  --content "某云厂商表示下一财年将继续增加AI数据中心、网络和电力基础设施投入。" \
  --source manual \
  --published-at "2026-06-15T09:00:00+08:00"
```

采集单个公司的巨潮公告标题：

```bash
node apps/pj_finance/app/industryLink/factor_events/scripts/collect_cninfo_disclosures.mjs \
  --ts-code 000001.SZ \
  --max 80
```

预演但不写入正式 JSONL：

```bash
node apps/pj_finance/app/industryLink/factor_events/scripts/append_raw_message.mjs \
  --title "测试消息" \
  --content "仅测试 raw_messages 写入结构" \
  --dry-run
```

## 强度和置信度

- `strength`: 1-5，表示事件对因子的影响强度。
- `confidence`: 1-5，表示识别可靠性。
- `impact_strength`: 1-5，表示事件对某个二级子泳道的影响强度。

## 方向枚举

- `positive`: 正向
- `negative`: 负向
- `neutral`: 中性
- `mixed`: 多空混合

## 状态枚举

- `pending`: 待确认
- `confirmed`: 已确认
- `rejected`: 已驳回
- `archived`: 已归档
