# 02 Creator Dashboard 执行单

> 目标：让 creator 查看必要的归因和转化表现，帮助平台运营 creator 生态，同时严格保护用户敏感数据。

## 页面目标

- 展示 creator campaign 的访问、注册、首单、shipping payment、复购汇总。
- 展示 code 状态、活动周期、转化漏斗和趋势。
- 支持运营审核 creator 表现和风险。
- 不展示用户姓名、地址、订单明细、QC、支付、tracking。

## Dashboard 结构

| 区域 | 内容 |
| --- | --- |
| Overview | page visits、registrations、first orders、shipping payments、repeat conversions。 |
| Campaigns | campaign 列表、code、状态、时间、source。 |
| Funnel | visit -> paste link -> sign up -> first order -> shipping paid -> repeat。 |
| Earnings/Rewards | 如业务开放，仅展示汇总和结算状态。 |
| Content guidelines | creator 话术边界和违规提醒。 |
| Alerts | code 过期、异常转化、违规风险。 |

## creator 可见数据

| 可见 | 不可见 |
| --- | --- |
| 汇总访问量 | 用户姓名、邮箱、电话。 |
| 汇总注册数 | 用户地址。 |
| 汇总首单数 | 用户订单明细。 |
| 汇总 shipping payment 数 | QC 图片。 |
| 汇总复购数 | tracking number。 |
| GMV/服务费汇总或区间 | 支付信息。 |
| code 状态 | 后台内部备注。 |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `creator_id` | creator 标识。 |
| `campaign_id` | 活动标识。 |
| `code` | creator code。 |
| `campaign_status` | active / paused / expired。 |
| `page_views` | 页面访问。 |
| `registrations` | 注册汇总。 |
| `first_orders` | 首单汇总。 |
| `shipping_payments` | shipping payment 汇总。 |
| `repeat_conversions` | 复购汇总。 |
| `gmv_bucket` | GMV 区间或汇总。 |
| `risk_flags` | 风险标记。 |

## 权限规则

| 场景 | 规则 |
| --- | --- |
| creator 登录 | 只能访问自己的 dashboard。 |
| 多 campaign | 只能看自己名下 campaign。 |
| 运营角色 | 可查看所有 creator 汇总。 |
| 数据导出 | creator 默认不可导出用户级数据。 |
| 异常转化 | 只展示风险提示，不展示用户隐私。 |

## 风险提示

| 风险 | 触发 |
| --- | --- |
| code abuse | 短时间异常使用、同设备批量注册。 |
| misleading claim | creator 内容含保证真伪、保证到货、官方推荐。 |
| high refund rate | creator 来源订单退款异常高。 |
| suspicious conversion | 转化数据异常跳变。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `creator_dashboard_view` | 访问 dashboard | `creator_id`、`campaign_count` |
| `creator_campaign_detail_view` | 查看 campaign | `creator_id`、`campaign_id` |
| `creator_export_attempt` | 尝试导出 | `creator_id`、`export_type`、`allowed` |
| `creator_guideline_view` | 查看规则 | `creator_id` |

## 验收标准

- creator 只能看自己的汇总数据。
- dashboard 不展示用户敏感信息。
- campaign 漏斗可用。
- code 状态准确。
- 高风险 creator 有提示或风控入口。

