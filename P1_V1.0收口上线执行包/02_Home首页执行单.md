# 02 Home 首页执行单

> 目标：用户进入首页 3 秒内理解 GOATEDBUY 的起点是外部链接，平台负责处理 haul，不做官方商品推荐。

## 页面目标

- 让用户立刻知道可以粘贴商品链接开始。
- 解释 agent 流程：采购、到仓、QC、合箱、国际发货。
- 保持中立代理定位，不展示官方 finds 或商品推荐货架。
- 给新手提供社群、first haul 帮助和 Trust Center 入口。

## 首屏结构

| 区域 | 内容 | 要求 |
| --- | --- | --- |
| 主标题 | `Find it anywhere. Paste it here. Ship it with us.` | 必须在首屏明显可见。 |
| 副标题 | 说明用户可从 TikTok、Reddit、Discord、creator spreadsheet、中国电商平台找链接，回到 GOATEDBUY 处理 haul。 | 不承诺平台推荐商品。 |
| Paste Link 输入框 | 支持粘贴链接、清空、提交。 | 移动端首屏可见。 |
| CTA | `Start your haul` | 点击后进入 Link Intake 或登录保留流程。 |
| 辅助链接 | Trust Center / Join Discord / First Haul Help | 只做轻入口。 |

## 页面模块

| 模块 | 内容 | P1 要求 |
| --- | --- | --- |
| Hero | 主标题、副标题、Paste Link、Start Haul | P0 |
| Haul Journey | Paste Link -> We Buy -> Warehouse Arrival -> QC Photos -> Build Haul -> Choose Shipping -> Track Parcel -> Delivered | P0 |
| Find Anywhere | TikTok、Reddit、Discord、creator spreadsheet、Taobao、1688、Weidian、Yupoo | P0 |
| Why GOATEDBUY | 流程透明、QC 可查看、费用解释、规则清楚 | P1 |
| Community | Join Discord、Visit Reddit、First Haul Help | P0 |
| Trust Center Entry | Fees、QC、Shipping、Refund、Privacy | P0 |

## 交互要求

| 操作 | 成功结果 | 异常结果 |
| --- | --- | --- |
| 粘贴空链接并提交 | 不提交 | 提示 `Paste an item link to start your haul.` |
| 粘贴不支持格式 | 进入 Link Intake 失败状态 | 提示可人工补充 |
| 粘贴支持链接 | 进入 Link Intake 解析流程 | 解析超时展示重试和人工补充 |
| 点击 Start Haul | 有链接则提交，无链接则聚焦输入框 | 未登录时保留链接并引导登录 |
| 点击 Trust Center | 打开规则中心 | 配置失败展示静态规则 |
| 点击社群入口 | 跳转社群链接 | 链接失效时展示 fallback |

## 首页禁止内容

- 官方 finds。
- 商品推荐货架。
- 平台对第三方商品的购买价值背书。
- 暗示 GOATEDBUY 保证商品真伪、品牌或质量。
- 隐藏服务费、运费变化或退款限制的文案。

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `home_page_view` | 首页曝光 | `source`、`utm`、`device`、`is_login` |
| `paste_link_start` | 输入框聚焦或首次输入 | `source`、`device`、`is_login`、`creator_code` |
| `paste_link_submit` | 用户提交链接 | `url_domain`、`is_login`、`creator_code` |
| `click_start_haul` | 点击 CTA | `position`、`device`、`is_login` |
| `journey_view` | Journey 模块曝光 | `device` |
| `journey_step_click` | 点击 Journey 步骤 | `step_name`、`device` |

## 验收标准

- 桌面端和移动端首屏都能看到 Paste Link。
- Start Haul 不会在无链接时跳到空页面。
- Timeline 桌面端横向可读，移动端纵向可读。
- 首页没有官方 finds 或商品推荐货架。
- Trust Center 和社群入口可点击。
- 首页配置接口失败时仍有默认静态内容。

