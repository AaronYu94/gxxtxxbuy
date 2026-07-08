# 06 Coupon 使用解释执行单

> 目标：让用户理解 coupon / credit 可用范围、不可用原因、是否可叠加、支付失败如何回滚，减少支付和优惠争议。

## 页面目标

- 在 Wallet 和支付页解释 coupon 规则。
- coupon 不可用时给出具体原因。
- 支付失败后明确 coupon / credit 回滚。
- 避免过度刺激消费设计。

## 解释位置

| 页面 | 展示内容 |
| --- | --- |
| Wallet | coupon 类型、金额、有效期、适用范围、状态。 |
| Checkout | 可用 coupon、不可用原因、抵扣金额。 |
| Shipping Payment | shipping coupon 是否适用该线路。 |
| Refund Timeline | coupon / credit 是否返还。 |
| Trust Center | 完整规则。 |

## 不可用原因枚举

| 原因 | 用户文案 |
| --- | --- |
| expired | This coupon has expired. |
| used | This coupon has already been used. |
| line_not_eligible | This coupon is not available for the selected shipping line. |
| order_min_not_met | This order does not meet the minimum amount. |
| cannot_stack | This coupon cannot be combined with another discount. |
| user_not_eligible | This coupon is not available for this account. |
| payment_pending | This coupon is locked while payment is pending. |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `coupon_id` | coupon 标识。 |
| `coupon_type` | order / shipping / referral / credit。 |
| `amount` | 金额或比例。 |
| `valid_until` | 有效期。 |
| `applicable_line` | 适用线路。 |
| `min_order_amount` | 最低金额。 |
| `stackable` | 是否可叠加。 |
| `status` | available / used / expired / locked / not_applicable。 |
| `not_applicable_reason` | 不可用原因。 |
| `rollback_status` | 支付失败回滚状态。 |

## 支付失败回滚

```text
Apply coupon / credit
-> Payment pending
-> Payment success: mark used
-> Payment fail: unlock coupon / restore credit
```

## 禁止设计

- 过度倒计时。
- 抽奖式刺激消费。
- 隐藏不可叠加规则。
- 支付失败后 coupon 显示已用但无法恢复。
- 用 Savings 夸大用户节省金额。

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `coupon_explain_view` | 查看 coupon 说明 | `entry_page`、`coupon_type` |
| `coupon_not_applicable_view` | 查看不可用原因 | `reason`、`context` |
| `coupon_apply` | 使用 coupon | `coupon_type`、`amount`、`context` |
| `coupon_rollback` | 支付失败回滚 | `coupon_id`、`rollback_status`、`fail_reason` |

## 验收标准

- 不可用 coupon 有具体原因。
- 支付失败后 coupon / credit 能正确回滚或提示处理中。
- Wallet、支付页、Trust Center 规则一致。
- 不使用强刺激消费设计。
- coupon 解释能被客服引用。

