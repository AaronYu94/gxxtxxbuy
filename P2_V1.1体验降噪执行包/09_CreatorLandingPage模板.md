# 09 Creator Landing Page 模板

> 目标：让 creator 导流用户快速完成 first haul onboarding，同时明确第三方内容边界，避免 creator 页面变成官方 finds 或商品推荐货架。

## 页面目标

- 展示 creator name / code / CTA。
- 给新用户简短解释如何开始。
- 保留 creator 归因。
- 明确第三方内容免责声明。
- 不展示官方推荐商品，不让 creator 访问用户敏感数据。

## 页面结构

| 区域 | 内容 | 要求 |
| --- | --- | --- |
| Creator header | creator name、头像/标识、coupon code | code 状态必须真实。 |
| CTA | `Paste a link to start your haul` | 主 CTA。 |
| First haul basics | 3-5 步解释流程 | 链接 First Haul Guide。 |
| Coupon explanation | code 可用范围、有效期、限制 | 不夸大优惠。 |
| Disclaimer | 第三方内容免责声明 | 首屏或 CTA 附近可见。 |
| Community link | Discord/Reddit | 可选。 |

## 核心文案模板

```text
Start your haul with [Creator Name]

Use code [CODE] when eligible.
Find an item link anywhere, paste it on GOATEDBUY, and we help with purchasing, warehouse handling, QC photos, and shipping.

GOATEDBUY does not officially recommend, verify, or endorse third-party items shared by creators or community members.
```

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `creator_id` | 归因标识。 |
| `creator_name` | 页面展示。 |
| `creator_avatar` | 可选展示。 |
| `code` | coupon / referral code。 |
| `campaign_id` | 活动归因。 |
| `code_status` | active / expired / paused。 |
| `valid_until` | 有效期。 |
| `coupon_rule` | 使用规则。 |
| `source` | TikTok / Discord / Reddit / bio link。 |

## 禁止内容

- 官方 finds。
- 商品推荐货架。
- GOATEDBUY 对 creator 商品的背书。
- creator 可查看用户订单、地址、QC、支付信息。
- 夸大 coupon 可用范围。
- 保证到货、保证真伪、保证退款。

## 归因规则

```text
creator landing view
-> paste link
-> registration / login
-> first order
-> shipping payment
```

| 场景 | 处理 |
| --- | --- |
| code 有效 | 保留 creator_code 到首单。 |
| code 过期 | 展示过期，不自动套用。 |
| 用户手动换 code | 以后输入 code 为准，保留日志。 |
| 多 creator 来源 | 按业务归因规则，不在前端随意覆盖。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `creator_page_view` | 页面访问 | `creator_id`、`code`、`source` |
| `creator_cta_click` | 点击开始 | `creator_id`、`code`、`cta_name` |
| `creator_code_apply` | 使用 code | `creator_id`、`code_status` |
| `creator_conversion` | 首单转化 | `creator_id`、`code`、`first_order` |
| `creator_disclaimer_view` | 免责声明曝光 | `creator_id`、`entry_page` |

## 验收标准

- 页面可以完成 paste link / start haul。
- code 状态和规则真实。
- 免责声明可见。
- 页面不展示官方商品推荐。
- creator 不可访问用户敏感数据。
- 归因字段能贯穿到首单和 shipping payment。

