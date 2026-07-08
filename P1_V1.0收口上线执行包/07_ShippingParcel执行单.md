# 07 Shipping / Parcel 执行单

> 目标：用户能选择 ready to ship 商品，查看线路、重量、费用预估，理解 estimated 和 final shipping 的差异，并提交国际包裹。

## 页面目标

- 展示可发货商品和不可发货原因。
- 展示实际重量、体积重、可用线路、预计费用、预计时效。
- 明确 estimated shipping 和 final shipping 的区别。
- 支持包裹提交、支付结果和 tracking 展示。

## 核心流程

```text
选择 Ready to ship 商品
-> 确认地址
-> 选择 shipping line
-> 查看 Cost Breakdown
-> 使用可用 coupon
-> 提交包裹
-> 支付国际运费
-> 查看 tracking
```

## 页面结构

| 区域 | 内容 |
| --- | --- |
| Ready to ship items | 可发货商品列表、勾选、重量。 |
| Not ready items | 不可发货商品和原因。 |
| Address | 收货国家、地址摘要、缺失提示。 |
| Shipping lines | 线路、预计时效、限制说明。 |
| Cost Breakdown | actual weight、volumetric weight、estimated fee、coupon、final fee。 |
| Submit parcel | 提交按钮、loading、结果。 |
| Tracking | tracking number、物流状态、更新时间。 |

## 字段要求

| 字段 | 页面用途 | P1 要求 |
| --- | --- | --- |
| `parcel_id` | 包裹编号 | 提交后生成。 |
| `item_ids` | 已选商品 | 必填。 |
| `actual_weight` | 实重 | 单位明确。 |
| `volumetric_weight` | 体积重 | 需要说明。 |
| `shipping_line` | 物流线路 | 不可用线路不展示可选。 |
| `estimated_fee` | 预估费用 | 明确不是最终费用。 |
| `final_fee` | 最终费用 | 支付前确认。 |
| `coupon_id` | coupon | 不可用时说明原因。 |
| `address_id` | 收货地址 | 缺失时不可提交。 |
| `tracking_no` | 追踪号 | 未发货时展示 pending。 |
| `shipping_status` | 物流状态 | 展示用户语言。 |

## 费用解释文案

| 场景 | 建议文案 |
| --- | --- |
| 预估费用 | `Estimated shipping may change after final packing and carrier confirmation.` |
| 体积重 | `Some lines charge by volumetric weight when a parcel is large but light.` |
| 最终费用 | `Final shipping is confirmed before payment.` |
| coupon 不可用 | `This coupon is not available for the selected shipping line.` |
| 线路限制 | `This line is unavailable for one or more selected items.` |

## 异常状态

| 场景 | 处理 |
| --- | --- |
| 地址缺失 | 阻止提交，提示补地址。 |
| 无 ready to ship 商品 | 空状态 + 回到 My Haul。 |
| 重量缺失 | 不允许提交，提示等待仓库更新。 |
| 线路不可用 | 展示原因，不展示为可选项。 |
| 运费计算失败 | 提示重试或联系客服。 |
| 支付失败 | coupon / credit 必须回滚。 |
| 物流延迟 | 展示延迟说明和 Trust Center 入口。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `shipping_view` | 进入 Shipping | `ready_to_ship_count`、`country` |
| `shipping_line_select` | 选择线路 | `line`、`estimated_fee`、`parcel_weight` |
| `parcel_submit` | 提交包裹 | `parcel_weight`、`line`、`estimated_fee` |
| `shipping_pay_success` | 国际运费支付成功 | `line`、`final_fee`、`coupon_used` |
| `shipping_pay_fail` | 国际运费支付失败 | `line`、`final_fee`、`fail_reason` |
| `tracking_view` | 查看物流 | `shipping_status`、`line` |

## 验收标准

- 只有 ready to ship 商品可提交发货。
- 不可发货商品必须展示原因。
- estimated 和 final shipping 区别明确。
- 支付前展示最终金额。
- 支付失败后 coupon / credit 状态正确回滚。
- tracking number 为空时不展示假单号。
- 页面不做确定到达日期承诺。

