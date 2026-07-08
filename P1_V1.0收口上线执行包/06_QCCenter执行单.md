# 06 QC Center 执行单

> 目标：QC 是信任核心。P1 至少要让用户清楚查看 QC 图片，并知道下一步该联系谁或去哪里发货。

## 页面目标

- 展示到仓商品的 QC 图片。
- 支持图片缩略图、大图查看和移动端清晰浏览。
- 告诉用户 QC 后下一步是什么。
- 不对商品真伪、品牌、购买价值做官方背书。

## 页面结构

| 区域 | 内容 |
| --- | --- |
| 商品信息 | 商品图、标题、规格、数量、订单编号、到仓时间。 |
| QC 图片 | 缩略图列表、大图预览、图片数量。 |
| 状态说明 | QC photos ready / QC pending / Issue reported。 |
| 下一步 | Contact support、Go to Shipping、Read QC policy。 |
| 规则入口 | QC policy、Return/refund policy。 |

## P1 功能范围

| 功能 | P1 策略 |
| --- | --- |
| QC 图片展示 | 必须上线。 |
| 图片放大查看 | 必须上线。 |
| 移动端查看 | 必须可用。 |
| Approve | 可隐藏，若流程未打通不要展示。 |
| Request extra photo | 可降级为联系客服。 |
| Return / Exchange | 可降级为联系客服。 |
| QC 评论 | 不在 P1。 |

## 字段要求

| 字段 | 页面用途 | P1 要求 |
| --- | --- | --- |
| `item_id` | 商品标识 | 必填。 |
| `order_id` | 订单关联 | 必填。 |
| `qc_photo_urls` | QC 图片 | 为空时不能展示 QC ready。 |
| `qc_status` | QC 状态 | 和 Orders / My Haul 一致。 |
| `warehouse_received_time` | 到仓时间 | 可为空，但要保守展示。 |
| `photo_count` | 图片数量 | 可由前端计算。 |
| `extra_photo_status` | 补拍状态 | P1 未打通则隐藏。 |
| `return_status` | 退换状态 | P1 未打通则隐藏。 |

## 图片要求

| 项目 | 要求 |
| --- | --- |
| 缩略图 | 快速加载，点击打开大图。 |
| 大图 | 移动端可缩放或至少清晰查看。 |
| 失败图 | 显示加载失败和重试，不用假 QC 图片。 |
| 图片数量 | 显示 `1 of N` 或等价信息。 |
| 隐私 | 图片 URL 不应被其他用户越权访问。 |

## 禁止文案

- `Authentic guaranteed`
- `Best quality`
- `GOATEDBUY recommended`
- `Worth buying`
- 任何对品牌、真伪、购买价值的官方背书

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `qc_view` | 查看 QC 页面 | `item_id`、`photo_count`、`qc_status` |
| `qc_photo_open` | 打开大图 | `item_id`、`photo_index` |
| `qc_action` | V1.1 后决策动作 | `action_type`、`item_id` |
| `click_qc_support` | 点击联系客服 | `item_id`、`qc_status` |
| `click_qc_policy` | 点击 QC 规则 | `entry_page`、`item_id` |

## 验收标准

- QC ready 的商品必须有 QC 图片。
- 图片在移动端可清楚查看。
- 图片失败不展示假图。
- 用户知道下一步可以联系 support、去 Shipping 或查看规则。
- 页面不对商品真伪、品牌、购买价值背书。
- 他人无法通过图片 URL 或 item ID 查看当前用户 QC。

