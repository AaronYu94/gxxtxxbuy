# 05 Savings Stack 执行单

> 目标：展示用户真实使用过的 coupon、credit 和 shipping saving，建立账户资产感，但不夸大节省金额或做强刺激消费。

## 页面目标

- 展示真实已发生的优惠记录。
- 让用户知道 coupon / credit 带来的实际抵扣。
- 支持按 order、parcel、shipping、campaign 查看。
- 避免营销式夸大和误导。

## 页面结构

| 区域 | 内容 |
| --- | --- |
| Summary | total saved、coupon saved、credit used、shipping discount。 |
| Savings timeline | 按时间展示优惠使用记录。 |
| By haul | 每次 haul 的优惠和费用节省。 |
| By campaign | creator/referral/campaign 相关优惠。 |
| Rule entry | coupon / credit 规则链接。 |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `saving_id` | 记录 ID。 |
| `user_id` | 用户归属。 |
| `saving_type` | coupon / credit / shipping_discount / referral。 |
| `amount` | 实际抵扣金额。 |
| `currency` | 币种。 |
| `order_id` | 关联订单。 |
| `parcel_id` | 关联包裹。 |
| `campaign_id` | 关联活动。 |
| `creator_code` | 关联 creator。 |
| `status` | applied / reversed / pending。 |
| `created_at` | 发生时间。 |

## 统计口径

| 口径 | 说明 |
| --- | --- |
| Total saved | 只统计 applied 且未 reversed 的真实抵扣。 |
| Pending savings | 支付处理中或未确认，不计入 total。 |
| Reversed savings | 支付失败或退款导致回滚，不计入 total。 |
| Shipping saving | 必须基于真实抵扣或业务确认，不用虚构市场价差。 |

## 禁止展示

- 用未确认 coupon 计入 total saved。
- 把 estimated fee 和 final fee 的差额包装成 savings。
- 和虚构原价对比。
- 使用抽奖、倒计时、强刺激消费设计。

## 降级策略

| 场景 | 策略 |
| --- | --- |
| 历史数据不完整 | 只从 P3 上线后开始统计，并说明。 |
| 财务状态未确认 | 显示 pending，不计入 total。 |
| 支付失败 | 状态 reversed，并展示原因。 |
| 币种不一致 | 按原币种展示，不强行汇总或使用明确汇率规则。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `savings_stack_view` | 页面访问 | `total_saved`、`saving_count` |
| `saving_detail_view` | 查看明细 | `saving_type`、`status` |
| `savings_rule_click` | 查看规则 | `entry_page` |

## 验收标准

- 只展示真实已发生优惠。
- pending / reversed 不计入 total saved。
- 不夸大 savings。
- 用户只能查看自己的 savings。
- Wallet、Checkout、History 中的优惠记录一致。

