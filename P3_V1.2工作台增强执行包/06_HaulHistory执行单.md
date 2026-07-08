# 06 Haul History 执行单

> 目标：沉淀用户历史 haul，让用户能回看每次采购、QC、发货、coupon 使用和物流记录，促进复购。

## 页面目标

- 展示历史 haul 列表和详情。
- 支持按状态、国家、线路、时间筛选。
- 展示历史 QC、发货、tracking、coupon/credit 使用。
- 提供 re-haul 或 start new haul 入口。

## 页面结构

| 区域 | 内容 |
| --- | --- |
| History summary | 总 haul 数、完成数、常用国家、常用线路。 |
| Filter | All、Delivered、In transit、Refunded、Cancelled、By country、By date。 |
| Haul card | haul 名称、商品数、目的国、线路、状态、完成时间。 |
| Haul detail | 商品、订单、QC、包裹、费用、coupon、tracking。 |
| Re-engage CTA | Start another haul、Save similar link、View shipping profile。 |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `haul_id` | haul 标识。 |
| `user_id` | 用户归属。 |
| `haul_name` | 用户命名或系统默认。 |
| `item_count` | 商品数。 |
| `order_ids` | 采购订单。 |
| `parcel_id` | 包裹。 |
| `country` | 目的国家。 |
| `shipping_line` | 线路。 |
| `haul_status` | delivered / in_transit / cancelled / refunded。 |
| `total_item_amount` | 商品金额。 |
| `shipping_fee` | 国际运费。 |
| `coupon_used` | coupon 使用。 |
| `tracking_no` | tracking，可脱敏或按权限展示。 |
| `completed_at` | 完成时间。 |

## 隐私规则

| 数据 | 展示策略 |
| --- | --- |
| 地址 | History 只展示国家/地区和地址摘要，不展示完整地址。 |
| 支付信息 | 不展示支付敏感信息。 |
| tracking | 仅当前用户可见。 |
| QC 图片 | 仅当前用户可见，分享时默认不带。 |
| 订单号 | 当前用户可见，分享页隐藏。 |

## 空状态和召回

| 场景 | 展示 |
| --- | --- |
| 无历史 | `Your haul history will appear here after your first shipment.` |
| 完成首单 | 展示 Start another haul CTA。 |
| 长期未复购 | 展示保存链接或 shipping profile 引导。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `haul_history_view` | 页面访问 | `haul_count`、`delivered_count` |
| `haul_history_detail_view` | 查看详情 | `haul_id`、`haul_status` |
| `start_another_haul_click` | 点击复购 CTA | `last_haul_status`、`country` |
| `history_filter_apply` | 使用筛选 | `filter_type` |

## 验收标准

- 用户只能查看自己的 history。
- 历史状态和 Orders / Shipping 一致。
- 历史 coupon / credit 和 Savings Stack 一致。
- 不展示完整地址和支付敏感信息。
- 有明显复购入口。

