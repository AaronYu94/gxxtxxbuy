# 04 Refund Timeline 执行单

> 目标：让用户能看懂退款为什么发生、处于什么阶段、哪些费用可退或不可退，减少退款焦虑和争议。

## 页面目标

- 展示退款当前状态和时间线。
- 解释退款原因和处理口径。
- 说明可退/不可退费用。
- 给出客服入口和规则链接。

## 适用场景

| 场景 | 说明 |
| --- | --- |
| 缺货 | 卖家无库存，采购无法完成。 |
| 改价未接受 | 用户不接受价格变化。 |
| 采购失败 | 平台无法完成采购。 |
| 卖家不发货 | 长时间未发货后取消。 |
| 退换货 | QC 后用户申请退换。 |
| 支付失败回滚 | coupon / credit / 支付状态需要回滚。 |

## Timeline 状态

| 状态 | 用户文案 | 下一步 |
| --- | --- | --- |
| Refund requested | Refund request received. | 等待处理。 |
| Reviewing | We are reviewing the refund reason. | 可查看规则。 |
| Seller return pending | Waiting for seller return confirmation. | 等待卖家处理。 |
| Approved | Refund approved. | 等待原路返回或 credit。 |
| Processing | Refund is being processed. | 展示预计口径。 |
| Completed | Refund completed. | 展示完成时间。 |
| Rejected | Refund could not be completed. | 展示原因和 support。 |

## 费用规则说明

| 费用 | 是否可退 | 说明 |
| --- | --- | --- |
| 商品金额 | 通常可退，取决于订单状态和卖家处理结果。 | 需按实际规则确认。 |
| 国内运费 | 视卖家/物流状态而定。 | 必须提前说明不确定性。 |
| 服务费 | 按平台规则。 | 不得隐藏不可退规则。 |
| 国际运费 | 未发货通常可退，已发货按物流规则。 | 需说明具体状态。 |
| 增值服务 | 按服务是否已执行。 | 已执行服务可能不可退。 |
| coupon / credit | 按支付结果和退款规则回滚。 | 支付失败必须回滚。 |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `refund_id` | 退款编号。 |
| `order_id` | 关联订单。 |
| `refund_reason` | 退款原因。 |
| `refund_status` | 当前状态。 |
| `refund_amount` | 退款金额。 |
| `refund_method` | 原路退回 / credit。 |
| `fee_breakdown` | 可退/不可退费用明细。 |
| `estimated_time` | 预计处理口径，不做精确承诺。 |
| `updated_at` | 更新时间。 |

## 降级策略

| 场景 | 策略 |
| --- | --- |
| 财务状态未打通 | 展示工单状态 + 联系客服。 |
| 预计时间不确定 | 展示规则口径，不承诺具体到账日。 |
| 可退金额未确认 | 显示 `Amount pending confirmation`。 |
| 规则未配置 | 跳 Trust Center 退款规则或展示静态兜底。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `refund_timeline_view` | 查看退款时间线 | `refund_status`、`refund_reason` |
| `refund_policy_click` | 查看退款规则 | `entry_page`、`refund_reason` |
| `refund_support_click` | 点击客服 | `refund_status`、`order_id` |

## 验收标准

- 用户能看到退款当前状态。
- 可退/不可退费用边界清楚。
- 不承诺无法保证的到账日期。
- 异常订单可跳到 Refund Timeline 或客服。
- 客服话术和页面规则一致。

