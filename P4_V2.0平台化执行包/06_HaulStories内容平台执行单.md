# 06 Haul Stories 内容平台执行单

> 目标：在用户自愿分享的前提下沉淀 Haul Stories，用于社区氛围和增长传播，同时严格保护隐私、审核内容、避免官方商品背书。

## 页面目标

- 用户可从 completed haul 生成 Haul Story。
- 内容默认隐私保护，用户可撤销。
- 平台可审核、隐藏、下架、处理举报。
- 不变成官方 finds 或商品推荐货架。

## 内容结构

| 区域 | 内容 |
| --- | --- |
| Story title | 用户标题。 |
| Haul summary | 商品数、品类、国家、线路、完成时间。 |
| Optional photos | 用户主动选择的图片。 |
| Shipping recap | 线路和大致时效，不展示 tracking。 |
| Savings recap | 真实 savings，可选。 |
| Creator attribution | 用户同意后展示 creator code。 |
| Disclaimer | 第三方内容和用户分享免责声明。 |

## 隐私默认值

| 数据 | 默认处理 |
| --- | --- |
| 地址 | 隐藏。 |
| 姓名/电话 | 隐藏。 |
| 订单号 | 隐藏。 |
| tracking number | 隐藏。 |
| 支付信息 | 隐藏。 |
| QC 图片 | 默认不展示，需用户主动选择。 |
| 用户 ID | 昵称或匿名。 |

## 审核状态

| 状态 | 含义 |
| --- | --- |
| draft | 用户草稿。 |
| pending_review | 待审核。 |
| approved | 已通过。 |
| rejected | 已拒绝。 |
| hidden | 管理员隐藏。 |
| user_revoked | 用户撤销。 |
| reported | 被举报待处理。 |

## 禁止内容

- 违规商品或敏感内容。
- 地址、电话、订单号、tracking。
- 平台或用户对商品真伪作保证。
- 冒充官方推荐。
- creator 夸大承诺。
- 未经同意发布他人隐私。

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `haul_story_create_start` | 开始创建 | `haul_id` |
| `haul_story_submit_review` | 提交审核 | `included_field_count` |
| `haul_story_publish` | 发布成功 | `story_id`、`review_status` |
| `haul_story_report` | 举报 | `story_id`、`report_reason` |
| `haul_story_revoke` | 用户撤销 | `story_id` |

## 验收标准

- Haul Story 必须由用户自愿创建。
- 默认不展示敏感信息。
- 内容有审核和举报机制。
- 用户可撤销。
- 页面不做官方商品推荐或背书。

