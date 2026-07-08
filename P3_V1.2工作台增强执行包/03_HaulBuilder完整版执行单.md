# 03 Haul Builder 完整版执行单

> 目标：把 My Haul 从商品列表升级为真正的 Haul Builder，让用户围绕一次国际发货选择商品、理解可发货性、生成包裹草稿。

## 页面目标

- 聚合 ready to ship 商品。
- 展示不可发货商品和原因。
- 支持选择商品组成 haul / parcel draft。
- 显示重量、费用预估、coupon 可用性和下一步。

## 核心流程

```text
Open Haul Builder
-> View ready / not ready items
-> Select items
-> Review weight and restrictions
-> Create parcel draft
-> Go to Shipping Preview
```

## 页面结构

| 区域 | 内容 |
| --- | --- |
| Haul overview | 商品总数、ready to ship、QC ready、not ready、预估重量。 |
| Ready items | 可选商品列表、勾选、重量、体积提示。 |
| Not ready items | 不可选商品和原因。 |
| Parcel draft | 已选商品、总重量、体积重提示、coupon 可用性。 |
| Next step | Preview shipping、Save draft、Clear selection。 |
| Help entry | Shipping FAQ、First Haul Guide。 |

## 可发货判断

| 条件 | 是否可发货 |
| --- | --- |
| 商品已到仓 | 必须满足。 |
| QC ready 或 approved | 必须满足。 |
| 重量信息完整 | 必须满足。 |
| 未加入其他待支付 parcel | 必须满足。 |
| 无线路限制或有可用线路 | 必须满足。 |
| 退换/补拍处理中 | 不可发货。 |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `item_id` | 商品标识。 |
| `order_id` | 订单关联。 |
| `warehouse_status` | 到仓状态。 |
| `qc_status` | QC 状态。 |
| `actual_weight` | 实重。 |
| `volumetric_weight_estimate` | 体积重预估。 |
| `restriction_tags` | 限制标签。 |
| `ready_to_ship` | 是否可发货。 |
| `not_ready_reason` | 不可发货原因。 |
| `parcel_draft_id` | 包裹草稿 ID。 |
| `selected_item_ids` | 已选商品。 |

## 不可发货原因

| 原因 | 用户文案 |
| --- | --- |
| waiting_for_arrival | Waiting for warehouse arrival. |
| waiting_for_qc | Waiting for QC photos. |
| qc_action_pending | QC action is still pending. |
| missing_weight | Warehouse weight is not ready yet. |
| restricted_item | This item may be restricted for selected lines. |
| already_in_parcel | This item is already in another parcel. |
| return_pending | Return or exchange is in progress. |

## 操作规则

| 操作 | 规则 |
| --- | --- |
| 选择商品 | 只能选择 ready to ship 商品。 |
| Save draft | 保存选择和地址/国家上下文。 |
| Preview shipping | 进入 Shipping Preview，带上 selected_item_ids。 |
| Clear selection | 清空当前选择，不删除商品。 |
| Edit item | 已采购商品不可随意改规格，只能查看或联系客服。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `haul_builder_view` | 页面访问 | `ready_count`、`not_ready_count` |
| `haul_item_select` | 选择商品 | `item_id`、`ready_to_ship` |
| `parcel_draft_create` | 创建草稿 | `selected_count`、`estimated_weight` |
| `parcel_draft_save` | 保存草稿 | `parcel_draft_id`、`selected_count` |
| `preview_shipping_click` | 点击预览 | `selected_count`、`country` |

## 验收标准

- 只有 ready to ship 商品可选择。
- 不可发货原因清楚。
- 生成 parcel draft 后可进入 Shipping Preview。
- My Haul、QC、Orders 状态同步。
- 不允许重复把同一商品加入多个待支付包裹。

