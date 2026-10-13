# 数据来源、口径与复现

本项目的默认样本是 **2024 年报 × 2025-04-30 行情**，包含 12 家固定 A 股公司。数值来自公开可访问的东方财富数据接口，原始响应已保存在 `data/raw/`，不是手工编造的演示数值。只有“60 日年化波动率”由本地程序从真实日线计算。

这批数据于 **2026-10-13 17:48（北京时间）** 抓取。财报记录的 `UPDATE_DATE` 在 2026-03-10 至 2026-04-30 之间，源站可能在后续报告披露后回填比较数据。**它是当前可得的历史数据，不能当作 2025-04-30 当时的信息集，不支持时点回测结论。** 行情与 PE 的日期来自数据响应，不是抓取日期。默认样本不代表当前市场，也不是全市场排名。

## 文件

| 文件 | 内容 |
| --- | --- |
| `data/snapshot.json` | 前端使用的 12 家公司、指标、逐指标来源、报告期和计算说明 |
| `data/raw/financials-2024.json` | 2024 年报接口原始 JSON |
| `data/raw/valuations-2025-04-30.json` | 2025-04-30 历史估值接口原始 JSON |
| `data/raw/prices-*.json` | 每家公司的后复权历史日线原始 JSON，共 12 份 |
| `data/raw/manifest.json` | 14 次请求的完整 URL、实际抓取时间、文件路径、SHA-256 |
| `scripts/fetch-public-data.py` | 标准库 Python 抓取、校验和计算程序 |

## 字段口径

| 产品字段 | 数据源字段 | 单位与含义 |
| --- | --- | --- |
| `revenueGrowth` | `RPT_LICO_FN_CPD.YSTZ` | %，2024 年营业**总**收入同比，展示时不应缩写成“主营业务增速” |
| `profitGrowth` | `RPT_LICO_FN_CPD.SJLTZ` | %，2024 年归母净利润同比；不是扣非净利润同比 |
| `roe` | `RPT_LICO_FN_CPD.WEIGHTAVG_ROE` | %，2024 年加权平均净资产收益率；不是扣非 ROE |
| `peTtm` | `RPT_VALUEANALYSIS_DET.PE_TTM` | 倍，数据源标记为 2025-04-30 的历史 PE TTM；没有用年报 EPS 重新计算 |
| `volatility` | 日线 `fields2` 中 `f53`（收盘价） | %，截至 2025-04-30 的 60 个日对数收益率年化样本标准差 |
| `industry` | `PUBLISHNAME` | 数据提供方的行业名称，当前分类；不声称是历史时点分类 |

所有增长、收益率、波动率字段都以百分数值保存，例如 `15.38` 表示 15.38%，不再乘 100。JSON 保留源数据精度，界面可保留两位小数。缺失值应保留 `null`，不能补 0。

**边界语义：** 隆基绿能的历史 `PE_TTM=-14.46071896` 为源数据真实负值，应解释为亏损情况下的 PE 不适用；“PE 小于 30 倍”的低估值筛选还应要求 PE 大于 0。不能因为负数较小而判断“便宜”。跨行业相同 PE 门槛只是一条用户筛选规则，不能推导为估值合理的投资结论。

## 上游与核对入口

1. 东方财富[年报业绩报表](https://data.eastmoney.com/bbsj/202412.html)。结构化接口域名 `datacenter-web.eastmoney.com`，路径 `/api/data/v1/get`，报告名 `RPT_LICO_FN_CPD`，过滤 `REPORTDATE='2024-12-31'` 和 12 个证券代码。各公司的来源链接在 `provenance` 中。
2. 东方财富[估值分析](https://data.eastmoney.com/gzfx/detail/600519.html)。同一路径，报告名 `RPT_VALUEANALYSIS_DET`，过滤 `TRADE_DATE='2025-04-30'` 和 12 个证券代码，直接保存 `PE_TTM`。源站历史记录可能修订，不能声称锁定在历史时点。
3. 东方财富行情接口域名 `push2his.eastmoney.com`，路径 `/api/qt/stock/kline/get`。参数 `klt=101` 日线、`fqt=2` 后复权、`beg=20250101`、`end=20250430`。上交所 `secid=1.代码`，深交所 `secid=0.代码`。保存完整响应再做本地计算。
4. 独立抽查：巨潮资讯披露的[同花顺 2024 年年度报告，第 6 页](https://static.cninfo.com.cn/finalpage/2025-02-25/1222627630.PDF#page=6)列示营业收入同比 17.47%、归母净利润同比 30.00%、加权 ROE 24.80%，与本样本四舍五入后的结果一致。此次仅对这一公司做了年报原文交叉核对，不能声称 12 家都已逐份年报审计。

这些公开接口没有在项目中提供长期可用性保证。首次展示使用已保存的原始响应；刷新失败应显示失败状态，不应编造数据或静默标成“实时”。如需将数据分发到公开商业服务，应另行核对数据源的使用及再分发条款。

## 波动率计算

程序取截至 2025-04-30 的最后 **61 个后复权收盘价**，日期为 2025-01-27 至 2025-04-30，产生 60 个交易日对数收益率：

```text
r[t] = ln(close[t] / close[t-1])
volatility = sample_standard_deviation(r, ddof=1) × sqrt(252) × 100
```

不以自然日补点，不把停牌日填成零收益，不混入未来 K 线，不以最高价/最低价计算“波动率”。不足 61 个有效正收盘价、日期重复、末交易日不匹配时返回 `null` 和原因。使用源站当前提供的后复权序列；后续修订可能改变结果，因此原始文件是本次交付的精确复现依据。

## 复现

在项目目录执行：

```sh
# 离线：校验原始文件哈希，从原始响应重建同一 snapshot。
python3 scripts/fetch-public-data.py

# 可选联网刷新：重新读取公开源并替换原始响应，随后重建。
# 上游历史修订可能使新结果与本次交付不同。
python3 scripts/fetch-public-data.py --refresh
```

不需要第三方 Python 包，不读取 API 密钥。脚本使用实际 UTC 抓取时间写入 manifest；字段 `asOf` 使用财报报告期或交易日期。`snapshot.isPointInTime` 明确为 `false`。

本次校验通过：12 个唯一代码、14 份原始响应哈希、每家公司 61 个收盘价与 60 个有效日收益率。所有 5 项数值均有真实来源或可复现计算。默认数据没有为了展示“数据缺失”而人为挖空；缺失分支应通过测试用例或真实的接口缺失响应验证。

## 扶摇接口接入合同（2026-10-13 核查）

以下仅为接入说明，没有使用文档示例数值冒充真实数据，也没有取得用户凭证或执行付费调用。

| 接口 | 必需参数 / 关键返回 |
| --- | --- |
| `GET /api/a-share/financials/indicators` | `thscode=300033.SZ&report=2024-4`；`data.abilities[].indicators[]` 中 `index_id`、`value` |
| `GET /api/a-share/valuations/snapshot` | `thscodes` 英文逗号分隔；`data.item[].pe_ttm`；`data.timestamp` 毫秒或 null |
| `GET /api/a-share/prices/historical` | 单个 `thscode`，`interval=1d`，`start`、`end` 毫秒时间戳，`adjust=backward`；`data.item[].date_ms`、`close_price` |

Base URL 为 `https://fuyao.aicubes.cn`，必需请求头 `X-api-key`。HTTP 状态恒为 200 时仍需检查响应 `code===0`。财务指标值为字符串或 null，应按字段解析；百分比无需除以 100 后再展示。文档中 `operating_income_yoy_growth_ratio` 名称是“营业收入同比”、`net_profit_yoy_growth_ratio` 是“净利润同比”，没有保证与此历史样本的“营业总收入”和“归母净利润”完全同口径；正式切源时需要确认，不能无提示替换。ROE 字段为 `index_weighted_avg_roe`。

估值接口仅提供最新快照、默认一次最多 100 个原始 token，不支持历史估值。`data.timestamp` 是相关上游元数据中的最大有效时间，不代表所有字段同时更新。负值和 null 原样保留。缺失的股票可能根本不出现在返回数组中。

历史日线每次单股、窗口跨度不超过 10 年，复权参数支持 `none/forward/backward`，默认 `forward`。生成波动率时应显式固定复权口径、检查实际返回日期、价格有效性和数量。

官方来源：[财务指标](https://fuyao.aicubes.cn/docs/api-reference/financial-indicators/) · [估值](https://fuyao.aicubes.cn/docs/api-reference/valuations/) · [日线](https://fuyao.aicubes.cn/docs/api-reference/prices/)。
