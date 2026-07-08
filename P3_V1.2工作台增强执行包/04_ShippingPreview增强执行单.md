# 04 Shipping Preview 增强执行单

> 目标：基于国家、线路、实重、体积重、限制商品和 coupon 适用性提供更完整的发货预览，帮助用户更有信心提交包裹。

## 页面目标

- 展示多线路对比。
- 解释费用组成和变化原因。
- 标明限制商品和不可用线路。
- 把 Shipping FAQ 嵌入关键疑惑点。

## 核心流程

```text
Open Shipping Preview from Haul Builder
-> Confirm destination country
-> Compare available lines
-> Review weight and restrictions
-> Apply eligible coupon / credit
-> Submit parcel
```

## 页面结构

| 区域 | 内容 |
| --- | --- |
| Destination | 国家/地区、地址摘要、地址缺失提示。 |
| Parcel summary | 商品数、实重、体积重、限制标签。 |
| Line comparison | 线路、费用区间、时效、tracking、限制、coupon 是否可用。 |
| Cost breakdown | 商品数、重量、estimated fee、coupon、final fee 提示。 |
| Rule helper | 体积重、estimate/final、限制品类 FAQ。 |
| Submit | 生成 parcel 或进入支付。 |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `parcel_draft_id` | 包裹草稿。 |
| `country` | 目的国家。 |
| `address_id` | 地址。 |
| `item_count` | 商品数。 |
| `actual_weight` | 实重。 |
| `volumetric_weight` | 体积重。 |
| `chargeable_weight` | 计费重量。 |
| `restriction_tags` | 限制标签。 |
| `available_lines` | 可用线路。 |
| `unavailable_lines` | 不可用线路和原因。 |
| `estimated_fee_min` | 费用区间下限。 |
| `estimated_fee_max` | 费用区间上限。 |
| `coupon_eligible` | coupon 是否可用。 |

## 线路对比字段

| 字段 | 展示 |
| --- | --- |
| `line_name` | 线路名称。 |
| `delivery_window` | 预计时效范围。 |
| `tracking_supported` | 是否支持 tracking。 |
| `restriction_reason` | 不可用原因。 |
| `fee_estimate` | 预估费用。 |
| `coupon_supported` | coupon 是否支持。 |
| `updated_at` | 线路规则更新时间。 |

## 文案边界

| 允许 | 禁止 |
| --- | --- |
| `Estimated shipping may change after final packing.` | `This estimate is your final cost.` |
| `Delivery window usually starts after dispatch.` | `Guaranteed arrival on a specific date.` |
| `This line may not support some restricted items.` | `All items can ship with this line.` |

## 降级策略

| 场景 | 策略 |
| --- | --- |
| 多线路接口不可用 | 展示默认可用线路或提示联系客服。 |
| 费用接口不稳定 | 展示费用区间和规则说明，不展示精确数字。 |
| 体积重缺失 | 标记 pending，不允许 final payment。 |
| 限制规则缺失 | 展示保守提示，必要时禁止提交。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `shipping_preview_view` | 页面访问 | `country`、`item_count`、`chargeable_weight` |
| `shipping_line_compare` | 查看线路对比 | `available_line_count`、`country` |
| `shipping_line_select` | 选择线路 | `line`、`estimated_fee` |
| `shipping_restriction_view` | 查看限制说明 | `restriction_type`、`line` |
| `shipping_preview_submit` | 提交预览 | `line`、`estimated_fee`、`coupon_used` |

## 验收标准

- 可对比多条线路或明确说明只支持单线路。
- 不可用线路有原因。
- estimated/final 差异清楚。
- 费用预估不做确定承诺。
- 地址、重量、限制缺失时不允许误提交。

