# 08 Wallet / Coupon 执行单

> 目标：用户能看懂可用 coupon / credit，知道优惠适用范围、不可用原因和支付失败后的回滚规则。

## 页面目标

- 展示 available coupons、shipping coupons、credit、used/expired coupons。
- 在采购或发货支付页自动提示可用优惠。
- 不可用时说明原因。
- 避免强刺激消费设计。

## 页面结构

| 区域 | 内容 |
| --- | --- |
| Credit balance | 当前 credit 余额。 |
| Available coupons | 可用 coupon 列表。 |
| Shipping coupons | 仅发货可用 coupon。 |
| Used / Expired | 已用和过期记录。 |
| Rule entry | coupon 使用规则和退款回滚说明。 |

## 字段要求

| 字段 | 页面用途 |
| --- | --- |
| `coupon_id` | coupon 标识，不直接暴露无意义 ID。 |
| `coupon_type` | order coupon / shipping coupon / credit。 |
| `amount` | 抵扣金额或比例。 |
| `valid_until` | 有效期。 |
| `applicable_line` | 适用线路。 |
| `status` | available / used / expired / not_applicable。 |
| `credit_balance` | credit 余额。 |
| `not_applicable_reason` | 不可用原因。 |

## coupon 状态

| 状态 | 用户展示 | 可操作 |
| --- | --- | --- |
| available | Available | 可使用 |
| used | Used | 不可使用 |
| expired | Expired | 不可使用 |
| not_applicable | Not available for this order/line | 不可使用，展示原因 |
| locked | Pending payment | 支付处理中暂锁 |

## 规则要求

| 场景 | 要求 |
| --- | --- |
| coupon 过期 | 不可使用，展示过期日期。 |
| 线路不适用 | 展示不适用原因。 |
| 不可叠加 | 明确只能选择一个或按业务规则展示。 |
| 支付失败 | coupon / credit 状态回滚。 |
| 退款 | 按规则说明是否返还。 |
| credit 余额 | 不可展示负数或未确认余额。 |

## 禁止设计

- 过度倒计时。
- 赌博式抽奖。
- 强诱导消费文案。
- 不透明扣费。
- 隐藏 coupon 限制条件。

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `wallet_view` | 进入 Wallet | `available_coupon_count`、`credit_balance` |
| `coupon_apply` | 使用 coupon | `coupon_type`、`amount`、`context` |
| `coupon_not_applicable_view` | 查看不可用原因 | `coupon_type`、`reason` |
| `coupon_rollback` | 支付失败回滚 | `coupon_id`、`context`、`fail_reason` |
| `credit_apply` | 使用 credit | `amount`、`context` |

## 验收标准

- 用户能看到可用、已用、过期 coupon。
- 支付页能提示可用优惠。
- 不可用 coupon 有原因。
- 支付失败后 coupon / credit 状态正确回滚。
- 不出现强刺激消费设计。
- coupon 金额计算准确。

