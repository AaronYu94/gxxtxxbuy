# 04 My Haul 执行单

> 目标：用 My Haul 替代传统 Cart 心智，让用户知道每个商品处于什么阶段，哪些可以继续采购或发货。

## 页面目标

- 展示用户当前 haul 中的商品。
- 按状态分组，降低新手理解成本。
- 告诉用户哪些商品可采购、哪些已到仓、哪些 QC ready、哪些 ready to ship。
- 给不可操作的商品明确原因。

## 页面结构

| 区域 | 内容 | P1 要求 |
| --- | --- | --- |
| 页面标题 | `My Haul` 或 `Haul Builder` | 不用 Cart 作为主标题。 |
| 概览数据 | 商品数量、待采购数量、已到仓数量、可发货数量 | P0 |
| 状态分组 | Waiting for purchase、Purchasing、On the way、Arrived、QC ready、Ready to ship | P0 |
| 商品卡片 | 图片、标题、规格、数量、价格、状态、下一步 | P0 |
| 操作区 | Submit purchase、View QC、Ship selected、Contact support | P0/P1 |
| 空状态 | `Your haul is empty. Paste an item link to start.` | P0 |

## 商品状态分组

| 分组 | 用户含义 | 允许动作 |
| --- | --- | --- |
| Waiting for purchase | 已加入 haul，未提交采购 | 编辑、删除、提交采购 |
| Purchasing | 平台正在采购 | 查看详情、联系客服 |
| On the way to warehouse | 卖家已发货或国内运输中 | 查看状态 |
| Arrived at warehouse | 商品已到仓，等待 QC | 等待 QC |
| QC ready | QC 图片可查看 | 查看 QC |
| Ready to ship | 可加入国际包裹 | 选择发货 |
| Not ready | 暂不可发货 | 查看原因 |

## 字段要求

| 字段 | 来源 | 页面用途 |
| --- | --- | --- |
| `item_id` | haul item | 商品唯一标识。 |
| `order_id` | order | 关联采购订单。 |
| `title` | item | 商品标题。 |
| `image` | item/qc | 商品图或占位图。 |
| `spec` | item | 规格展示。 |
| `quantity` | item | 数量。 |
| `item_price` | order/item | 商品价格。 |
| `status` | order/warehouse/qc | 状态分组。 |
| `warehouse_status` | warehouse | 到仓判断。 |
| `qc_status` | qc | QC ready 判断。 |
| `weight` | warehouse | ready to ship 判断。 |
| `restriction_reason` | shipping | 不可发货原因。 |

## 异常和空状态

| 场景 | 展示 |
| --- | --- |
| 无商品 | 空状态 + Paste Link CTA。 |
| 状态缺失 | 显示 `Status updating`，不允许发货。 |
| 图片缺失 | 使用通用占位图，不用假商品图。 |
| 价格待确认 | 显示 `Price pending confirmation`。 |
| 不可发货 | 展示具体原因，例如 waiting for QC、missing weight、restricted item。 |
| 接口失败 | 错误提示 + 重试按钮。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `my_haul_view` | 进入 My Haul | `item_count`、`ready_to_ship_count`、`is_login` |
| `haul_item_add` | 商品加入成功 | `item_source`、`user_id`、`session_id` |
| `haul_item_status_view` | 状态分组曝光 | `status_group`、`item_count` |
| `click_submit_purchase` | 点击提交采购 | `item_count`、`order_amount` |
| `click_ship_selected` | 点击发货 | `selected_count`、`ready_to_ship_count` |

## 验收标准

- 页面主命名为 My Haul / Haul Builder。
- 商品状态按用户语言展示，不暴露技术状态码。
- 用户能区分哪些商品已到仓、QC ready、ready to ship。
- 不可发货商品必须展示原因。
- 空 haul 不展示假商品。
- 数据刷新后状态和 Orders / QC / Shipping 保持一致。

