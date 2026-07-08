# 05 Orders 执行单

> 目标：让用户清楚知道采购订单处于什么阶段，异常订单为什么发生、下一步该做什么。

## 页面目标

- 展示采购订单列表和详情。
- 显示真实采购、卖家发货、到仓、QC ready 等状态。
- 异常订单必须给出原因和下一步。
- 避免用户因为模糊状态反复找客服。

## 页面结构

| 区域 | 内容 |
| --- | --- |
| 订单列表 | 商品图、标题、规格、金额、当前状态、创建时间。 |
| 筛选 | All、Purchasing、On the way、Arrived、QC ready、Exception。 |
| 订单详情 | 状态时间线、商品信息、支付信息摘要、国内物流、异常说明。 |
| 下一步动作 | View QC、Contact support、Refund status、Choose another spec。 |

## 状态时间线

```text
Order submitted
-> Purchasing
-> Seller shipped
-> On the way to warehouse
-> Arrived at warehouse
-> QC photos ready
-> Ready to ship
```

## 异常状态

| 异常 | 用户文案 | 下一步 |
| --- | --- | --- |
| 缺货 | `This item is out of stock.` | 退款 / 换规格 / 联系客服 |
| 改价 | `The seller changed the price.` | 确认差价 / 取消 / 联系客服 |
| 卖家不发货 | `The seller has not shipped yet.` | 等待 / 联系客服 |
| 采购失败 | `We could not purchase this item.` | 退款 / 联系客服 |
| 规格错误 | `The selected option may not match your request.` | 联系客服 |
| 退款中 | `Your refund is being processed.` | 查看退款说明 |

## 字段要求

| 字段 | 页面用途 |
| --- | --- |
| `order_id` | 订单编号。 |
| `payment_status` | 判断是否已支付。 |
| `purchase_status` | 采购状态。 |
| `seller_shipping_status` | 卖家发货状态。 |
| `domestic_tracking` | 国内物流。 |
| `warehouse_status` | 到仓状态。 |
| `qc_status` | QC ready 判断。 |
| `exception_reason` | 异常原因。 |
| `created_at` | 创建时间。 |
| `updated_at` | 最后更新时间。 |

## 降级策略

| 场景 | 策略 |
| --- | --- |
| 国内物流缺失 | 展示 `Tracking pending`，不展示假单号。 |
| 状态接口延迟 | 展示最后更新时间。 |
| 异常原因缺失 | 展示联系客服，不给随机原因。 |
| 退款流程未打通 | 展示退款说明和客服入口。 |
| 状态枚举未对齐 | 不允许上线该状态，回到 P0 修复。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `orders_view` | 进入订单页 | `order_count`、`exception_count` |
| `order_detail_view` | 查看订单详情 | `order_id`、`order_status` |
| `purchase_order_submit` | 提交采购订单 | `order_amount`、`coupon_used`、`creator_code` |
| `order_exception_view` | 查看异常订单 | `exception_reason`、`order_status` |
| `click_contact_support` | 点击客服 | `entry_page`、`order_status` |

## 验收标准

- 订单状态真实准确，不由前端写死。
- 异常订单必须有原因和下一步。
- 无国内物流时不展示假 tracking。
- 订单详情和 My Haul / QC 状态一致。
- 未登录用户不能访问订单数据。
- 用户看得懂当前阶段和下一步。

