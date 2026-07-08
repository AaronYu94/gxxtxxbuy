# 08 Creator Campaign Tracking 执行单

> 目标：把 creator 归因从首单 coupon 扩展到注册、首单、shipping payment 和复购，但 creator 只能看必要的汇总转化，不可访问用户敏感数据。

## 页面/系统目标

- 记录 creator campaign 从访问到复购的关键事件。
- 支持运营衡量 creator ROI。
- 支持 campaign 级别对比。
- 不向 creator 暴露用户地址、订单明细、支付信息、QC 图片。

## 归因链路

```text
creator_page_view / creator code
-> paste_link_submit
-> registration
-> haul_item_add
-> purchase_order_submit
-> shipping_pay_success
-> repeat_order / repeat_shipping
```

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `creator_id` | creator 标识。 |
| `campaign_id` | campaign 标识。 |
| `creator_code` | code。 |
| `source` | TikTok / Discord / Reddit / bio link。 |
| `landing_page_id` | 落地页。 |
| `session_id` | 会话。 |
| `user_id_hash` | 脱敏用户标识。 |
| `first_order_id` | 内部归因，不给 creator 明细。 |
| `first_shipping_paid_at` | 首次 shipping payment。 |
| `repeat_order_count` | 复购次数汇总。 |
| `gmv_bucket` | GMV 区间或汇总，不展示用户级明细。 |

## 归因规则

| 场景 | 规则 |
| --- | --- |
| 首次访问带 code | 写入 session 和用户归因候选。 |
| 注册前 paste link | 登录后保留 creator_code。 |
| 用户手动输入新 code | 按业务规则覆盖或记录多触点。 |
| code 过期 | 不再归因新订单，保留历史。 |
| 多 creator 触点 | 需要明确 first-touch / last-touch / coupon-used 规则。 |

## creator 可见数据

| 可见 | 不可见 |
| --- | --- |
| 页面访问量 | 用户姓名、地址、电话。 |
| 注册数 | 用户完整订单明细。 |
| 首单数 | QC 图片。 |
| shipping payment 数 | 支付信息。 |
| 复购汇总 | tracking number。 |
| GMV/服务费汇总或区间 | 单个用户敏感行为明细。 |

## 运营看板

| 指标 | 口径 |
| --- | --- |
| creator page visits | creator_page_view UV/PV。 |
| paste link conversion | paste_link_submit / creator_page_view。 |
| first order conversion | purchase_order_submit / creator_page_view。 |
| shipping conversion | shipping_pay_success / purchase_order_submit。 |
| repeat conversion | repeat order users / first order users。 |
| campaign ROI | 收入或 GMV / campaign cost。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `creator_campaign_touch` | 带 campaign 访问 | `creator_id`、`campaign_id`、`source` |
| `creator_attribution_set` | 写入归因 | `creator_id`、`campaign_id`、`rule` |
| `creator_first_order` | 首单归因 | `creator_id`、`campaign_id` |
| `creator_shipping_conversion` | shipping payment 归因 | `creator_id`、`campaign_id` |
| `creator_repeat_conversion` | 复购归因 | `creator_id`、`campaign_id`、`repeat_count` |

## 验收标准

- creator_code 可贯穿注册、首单、shipping payment。
- 多触点归因规则明确。
- creator 只看到汇总或脱敏数据。
- code 过期后不可继续产生新归因。
- 看板能支持 campaign ROI 复盘。

