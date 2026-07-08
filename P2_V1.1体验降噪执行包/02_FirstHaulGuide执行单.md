# 02 First Haul Guide 执行单

> 目标：让 first-time haul buyers 在首单前后理解完整流程，减少“怎么下单、为什么还要付国际运费、QC 怎么看”的基础咨询。

## 页面目标

- 用新手语言解释 agent 流程。
- 告诉用户每一步平台做什么、用户要做什么。
- 解释费用结构和二次支付。
- 引导用户去 Paste Link、My Haul、QC、Shipping 和 Trust Center。

## 入口要求

| 入口 | 位置 | P2 要求 |
| --- | --- | --- |
| Home | Hero 附近或 Community 区域 | 可见但不抢主 CTA。 |
| Link Intake | 解析失败或新手提示 | 引导用户理解如何提交链接。 |
| My Haul | 空状态和首个商品加入后 | 引导用户理解 haul 状态。 |
| Orders | 首单订单详情 | 解释采购到仓流程。 |
| QC Center | QC ready 页面 | 解释 QC 能做什么。 |
| Shipping | Shipping Preview 附近 | 解释国际运费和体积重。 |
| Community | Discord/Reddit 置顶 | 使用同一链接。 |

## 内容结构

| 模块 | 主要内容 | CTA |
| --- | --- | --- |
| Start with a link | 从 TikTok、Reddit、Discord、creator spreadsheet、中国电商平台找链接。 | Paste a link |
| We buy it for you | 平台采购、卖家发货到仓库。 | View orders |
| Warehouse arrival | 商品到仓后更新状态。 | View My Haul |
| QC photos | 仓库拍 QC 图片，用户发货前查看。 | View QC policy |
| Build your haul | 用户选择已到仓且 ready to ship 的商品合箱。 | Go to My Haul |
| Choose shipping | 选择线路，理解实重、体积重、estimated/final。 | Read shipping FAQ |
| Track parcel | 支付国际运费后发货追踪。 | View parcels |
| Support and refunds | 异常订单、退款、补拍、退换联系 support。 | Contact support |

## 文案原则

- 用短句和流程语言，不写大段规则。
- 明确“商品链接来自站外，平台负责处理流程”。
- 不做商品推荐，不暗示平台背书。
- 费用解释必须早出现，尤其是国际运费二次支付。
- 所有复杂规则跳转 Trust Center 或对应 FAQ。

## 必须解释的问题

| 问题 | 回答要点 |
| --- | --- |
| 为什么先付商品钱，后付国际运费？ | 商品先采购到仓，仓库称重/打包后才能确认国际运费。 |
| QC 是什么？ | 仓库拍摄商品照片，帮助用户发货前查看商品情况。 |
| QC 是否代表真假鉴定？ | 不代表，平台不对品牌真伪或购买价值背书。 |
| 为什么 estimated shipping 会变？ | 最终打包、实重、体积重、线路限制可能影响费用。 |
| 什么时候可以发货？ | 商品到仓、QC ready、重量/限制信息完整后。 |
| 异常订单怎么办？ | 页面会显示原因和下一步，必要时联系 support。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `first_haul_guide_view` | 页面访问 | `entry_page`、`is_login`、`is_first_order_user` |
| `first_haul_step_view` | 步骤曝光 | `step_name`、`entry_page` |
| `first_haul_cta_click` | 点击 CTA | `cta_name`、`step_name` |
| `first_haul_support_click` | 点击 support | `entry_page`、`step_name` |

## 验收标准

- 首页、社群、订单/QC/Shipping 关键节点可进入。
- 内容解释首单完整流程和国际运费二次支付。
- 明确 QC 不等于鉴定或平台背书。
- 移动端可读，不出现大段难读文字。
- CTA 能回到对应业务页面。

