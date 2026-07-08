# 05 Shipping FAQ by Country 执行单

> 目标：按国家/线路解释国际运费、体积重、时效、限制商品和 estimate/final 差异，减少发货前后的费用疑惑。

## 页面目标

- 帮用户理解不同国家/线路的运费和限制。
- 解释体积重、实重、estimated/final shipping。
- 在 Shipping 页面关键节点提供 FAQ 入口。
- 不做确定到达日期承诺。

## P2 覆盖范围

| 范围 | P2 要求 |
| --- | --- |
| 主力国家 | 优先覆盖欧美核心国家，具体列表由业务确认。 |
| 常见问题 | 时效、费用、体积重、限制、清关、延迟。 |
| 页面入口 | Shipping Preview、Trust Center、First Haul Guide。 |
| 内容形态 | FAQ + 国家/线路卡片。 |

## FAQ 信息架构

| 分区 | 问题 |
| --- | --- |
| Shipping basics | 为什么商品到仓后才付国际运费？ |
| Weight | actual weight 和 volumetric weight 有什么区别？ |
| Estimate vs final | 为什么 estimated shipping 会变？ |
| Lines | 不同 shipping line 的差异是什么？ |
| Restrictions | 哪些商品可能无法走某些线路？ |
| Delivery | 为什么物流可能延迟？ |
| Tracking | tracking 什么时候更新？ |
| Coupon | shipping coupon 为什么不能用？ |

## 国家/线路卡片字段

| 字段 | 说明 |
| --- | --- |
| `country` | 国家/地区。 |
| `shipping_line` | 线路名称。 |
| `estimated_delivery_window` | 预计时效范围。 |
| `weight_rule` | 实重/体积重规则说明。 |
| `restricted_items` | 常见限制品类。 |
| `tracking_support` | 是否支持 tracking。 |
| `coupon_eligible` | coupon 是否适用。 |
| `updated_at` | 规则更新时间。 |

## 文案边界

| 允许 | 禁止 |
| --- | --- |
| `Estimated delivery is usually X-Y business days after dispatch.` | `Guaranteed delivery by Friday.` |
| `Final shipping is confirmed after packing.` | `This estimate is the final cost.` |
| `Some items may be restricted by line or destination.` | `All items can ship anywhere.` |

## Shipping 页面接入

| 场景 | 入口 |
| --- | --- |
| 选择线路前 | `Compare shipping lines` |
| 费用预估旁 | `Why can shipping change?` |
| 体积重显示旁 | `What is volumetric weight?` |
| 线路不可用 | `Read line restrictions` |
| tracking pending | `When does tracking update?` |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `shipping_faq_view` | 查看 Shipping FAQ | `entry_page`、`country` |
| `shipping_country_select` | 选择国家 | `country` |
| `shipping_faq_question_open` | 展开问题 | `question_id`、`country` |
| `shipping_rule_click` | 从 Shipping 页面点击规则 | `rule_type`、`line` |

## 验收标准

- Shipping 页面关键疑惑点有 FAQ 入口。
- FAQ 覆盖 estimate/final、体积重、线路限制。
- 不承诺精确到达日期。
- 国家/线路内容有更新时间。
- 移动端 FAQ 可快速展开和收起。

