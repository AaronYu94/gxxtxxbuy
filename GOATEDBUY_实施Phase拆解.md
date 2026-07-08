# GOATEDBUY Website Phase 拆解

> 基于 `GOATEDBUY_产品分析与需求文档_V1.0.docx` 拆解。本文用于研发排期、设计评审、上线收口和后续迭代管理。

## 总体原则

- V1.0 先保证核心链路跑通，不追求完整平台化创新。
- 首页只做轻量承接，不做官方 finds、商品推荐货架或平台背书。
- 社群和 creator 负责链接流动，平台负责履约、规则、费用、QC 和数据安全。
- 数据安全、字段一致性、权限隔离、mock 数据清理是上线红线。
- 所有费用、QC、退款、发货、仓储规则必须可解释、可追溯、可由客服引用。

## Phase 0：上线前收口与风险清理

### 阶段目标

在正式 V1.0 上线前，先处理会直接影响上线安全、核心链路和用户信任的基础问题。

### 核心范围

| 模块 | 事项 | 优先级 | 说明 |
| --- | --- | --- | --- |
| 数据安全 | 权限隔离检查 | P0 | 普通用户只能访问自己的订单、地址、QC、包裹、wallet 数据。 |
| 数据安全 | 敏感字段最小返回 | P0 | 前端接口不得返回非必要地址、token、支付、creator/referral 敏感数据。 |
| 数据安全 | 日志脱敏 | P0 | 日志不得记录完整地址、token、支付信息。 |
| 数据安全 | mock 数据清理 | P0 | 生产页面不得展示假商品、测试订单、测试账号。 |
| 字段对齐 | 订单/QC/包裹状态映射 | P0 | 前端展示状态必须和后端真实字段一致。 |
| 配置能力 | 首页、Trust Center、社群入口兜底文案 | P0 | 后台/CMS 不可用时需要静态默认内容。 |
| 降级策略 | 隐藏不稳定模块 | P0 | 字段不完整、流程未打通的模块不上生产入口。 |

### 交付物

- 字段字典与状态映射表。
- 权限校验 checklist。
- mock/test 数据清理清单。
- 生产环境接口返回字段审查结果。
- 不稳定模块隐藏/降级清单。

### 验收标准

- 无用户越权访问。
- 无敏感字段泄露。
- 无 mock 数据展示。
- 订单、QC、包裹、wallet 页面不展示错误状态。
- 所有核心接口异常时有 loading、重试或兜底提示。

## Phase 1：V1.0 收口上线版

### 阶段目标

按期上线，并让用户明确感知 GOATEDBUY 是一个 haul-first 的 agent 工作台：从外部找链接，到平台完成采购、到仓、QC、合箱、发货和追踪。

### 核心用户流程

```text
外部发现商品链接
-> 进入首页
-> Paste Link / Start Haul
-> 链接解析或人工补充
-> 加入 My Haul
-> 提交采购订单
-> 查看订单状态
-> 商品到仓查看 QC
-> 选择可发货商品
-> 查看 Shipping Preview
-> 支付国际运费
-> 追踪包裹
```

### 功能范围

| 模块 | 功能点 | 优先级 | 说明 |
| --- | --- | --- | --- |
| Home | Hero + Paste Link 输入框 | P0 | 首屏 3 秒内说明“Find it anywhere. Paste it here. Ship it with us.” |
| Home | Start Haul CTA | P0 | 支持未登录先输入链接，登录后保留输入内容。 |
| Home | Haul Journey | P0 | Paste Link -> We Buy -> Warehouse Arrival -> QC Photos -> Build Haul -> Choose Shipping -> Track Parcel -> Delivered。 |
| Home | Find Anywhere | P0 | 展示 TikTok、Reddit、Discord、creator spreadsheet、Taobao、1688、Weidian 等外部来源。 |
| Home | Community / Trust Center 入口 | P0 | 首页只放轻入口，不展开过长规则说明。 |
| Link Intake | 商品链接提交与解析 | P0 | 支持主流商品 URL 校验和解析状态展示。 |
| Link Intake | 解析失败人工补充入口 | P1 | 解析失败不阻断用户继续提交。 |
| My Haul | 商品列表与状态分组 | P0 | 使用 My Haul / Haul Builder，不使用 Cart 作为主命名。 |
| Orders | 采购订单状态展示 | P0 | 展示 Order submitted、Purchasing、Seller shipped、Arrived at warehouse、QC photos ready 等用户语言。 |
| Orders | 异常订单提示 | P1 | 缺货、改价、卖家不发货等情况给出下一步。 |
| QC Center | QC 图片展示 | P0 | 图片清晰可放大，移动端可用。 |
| QC Center | 联系客服入口 | P0 | V1.0 先提供轻量下一步，不强行做完整决策流。 |
| Shipping / Parcel | 可发货商品、重量、线路、费用预览 | P0 | 必须解释 estimated shipping 与 final shipping 差异。 |
| Shipping / Parcel | 包裹提交与 tracking 展示 | P0 | 支持 tracking number 和物流状态。 |
| Wallet / Coupon | 基础 coupon / credit 展示 | P0 | 支付页提示可用优惠和不可用原因。 |
| Trust Center | 费用、QC、发货、退款、仓储、隐私规则 | P0 | 无需登录可访问主要规则。 |
| Trust Center | Creator / Community disclaimer | P0 | 明确平台不背书第三方分享商品。 |

### 埋点范围

| 页面 | 事件 |
| --- | --- |
| Home | `home_page_view`、`paste_link_start`、`paste_link_submit`、`click_start_haul`、`journey_view`、`journey_step_click` |
| Link Intake | `link_parse_success`、`link_parse_fail` |
| My Haul | `haul_item_add` |
| Orders | `purchase_order_submit` |
| QC Center | `qc_view` |
| Shipping | `parcel_submit`、`shipping_pay_success`、`shipping_pay_fail` |
| Trust Center | `trust_policy_view` |
| Support | `support_ticket_create` |

### 验收标准

- 首页首屏可见 Paste Link 和 Start Haul。
- 首页不出现官方 finds、商品推荐货架或平台背书内容。
- Timeline 桌面端横向可读，移动端纵向可读。
- 用户提交链接失败后仍可进入人工补充或 support 流程。
- 未登录用户 paste link 后，登录/注册不丢失输入内容。
- 用户能区分哪些商品已到仓、哪些 QC ready、哪些 ready to ship。
- 运费页面明确标注 estimate/final，不做不确定的精确承诺。
- Trust Center 在首页和关键业务页面均可进入。
- 生产环境无 mock 数据、无越权、无敏感字段泄露。

## Phase 2：V1.1 体验降噪版

### 阶段目标

减少新手理解成本和客服压力，把 V1.0 的“能跑通”升级为“更清楚、更少疑惑、更少工单”。

### 功能范围

| 模块 | 功能点 | 优先级 | 说明 |
| --- | --- | --- | --- |
| First Haul Guide | 新手首单教程 | P0 | 解释代购、到仓、QC、合箱、国际运费二次支付。 |
| QC Center | QC 决策按钮 | P0 | Approve、Request extra photo、Return / Exchange、Contact support。 |
| Refund | Refund Timeline | P1 | 解释退款状态、周期、可退/不可退费用。 |
| Shipping | Shipping FAQ by country | P1 | 按国家解释线路、限制、时效、体积重。 |
| Wallet / Coupon | coupon 使用解释 | P1 | 说明适用线路、有效期、不可叠加、支付失败回滚。 |
| Orders | 异常状态优化 | P0 | 缺货、改价、采购失败、卖家不发货必须有原因和下一步。 |
| Community | 社群置顶规则 | P1 | first-haul-help、qc-help、shipping-help、haul-reviews、creator-codes 等频道规则。 |
| Creator | creator landing page 模板 | P1 | creator name、coupon code、start haul CTA、first haul basics、免责声明。 |

### 核心指标

- 首单用户客服咨询率下降。
- QC 查看率提升。
- QC 确认率提升。
- 国际运费支付率提升。
- 异常订单投诉下降。

### 验收标准

- 用户在 QC 后知道下一步可做什么。
- 异常订单不只展示模糊状态，必须展示原因和下一步。
- First Haul Guide 能从首页、社群入口、订单/发货关键节点进入。
- creator landing page 不展示官方推荐商品，不让 creator 访问用户敏感数据。

## Phase 3：V1.2 工作台增强版

### 阶段目标

从普通 agent 网站升级为 personal haul workspace，让用户把链接、订单、QC、发货、历史记录和优惠资产沉淀在平台内。

### 功能范围

| 模块 | 功能点 | 优先级 | 说明 |
| --- | --- | --- | --- |
| Link Inbox | Saved Links / Link Inbox | P0 | 用户可先保存外部商品链接，后续再加入 haul。 |
| My Haul | Haul Builder 完整版 | P0 | 支持更完整的商品组合、可发货判断和包裹构建。 |
| Shipping | 更完整 Shipping Preview | P0 | 基于实重、体积重、线路、国家、限制商品给出更稳定预估。 |
| Wallet | Savings Stack | P1 | 展示 coupon、credit、shipping saving 的累计记录。 |
| History | Haul History | P0 | 沉淀历史订单、发货国家、常用线路、复购数据。 |
| Share | Shareable haul recap | P2 | 用户可自愿分享 haul recap，需注意隐私和内容审核。 |
| Growth | creator campaign tracking | P1 | creator 导流首单和复购归因。 |

### 核心指标

- 30 日复购率提升。
- 用户平均 haul 数提升。
- creator 首单转化提升。
- 用户从首页/社群回到工作台的比例提升。

### 验收标准

- 用户能保存链接并在后续继续处理。
- Haul History 可清楚展示历史采购、QC、发货、coupon 使用记录。
- Savings 展示基于真实支付和优惠数据，不夸大节省金额。
- 分享功能必须默认保护订单、地址、支付等敏感信息。

## Phase 4：V2.0 平台化版本

### 阶段目标

在保持中立 agent 边界的基础上，建设 creator-compatible 的平台能力，同时把用户资产、信任规则、风控和审计沉淀在平台内。

### 功能范围

| 模块 | 功能点 | 优先级 | 说明 |
| --- | --- | --- | --- |
| Creator | Creator dashboard | P0 | 查看必要归因和转化数据，不开放用户敏感数据。 |
| User Profile | User shipping profile | P0 | 沉淀国家、常用线路、地址偏好、包裹偏好。 |
| QC | QC preferences | P1 | 用户可配置关注点，例如尺码、logo、瑕疵、包装。 |
| Shipping | Country Shipping Hub | P1 | 按国家整理线路、限制、时效、费用解释。 |
| Community | 用户自愿分享 Haul Stories | P2 | 必须有内容审核和隐私保护。 |
| Risk | 风控后台 | P0 | 处理异常订单、违规内容、敏感商品、滥用优惠等风险。 |
| Audit | 完整审计日志 | P0 | 后台敏感操作、导出、权限变更、财务操作留痕。 |

### 核心指标

- 复购率提升。
- creator 留存提升。
- GMV 提升。
- 客服效率提升。
- 风险事件下降。

### 验收标准

- creator 只能查看归因和转化所需数据。
- 用户分享内容必须经过隐私保护和内容审核。
- 后台敏感操作可追溯。
- 平台仍不做官方 finds 或商品价值背书。

## 跨 Phase 依赖

| 依赖项 | 涉及 Phase | 说明 |
| --- | --- | --- |
| 账号与权限系统 | Phase 0-4 | 所有用户数据、creator 数据、后台数据的访问边界。 |
| 链接解析接口 | Phase 1-3 | 支持 Taobao、1688、Weidian、Yupoo 等来源，失败可人工补充。 |
| 订单与采购后台 | Phase 1-4 | 状态同步、异常处理、退款售后。 |
| 仓库/QC 系统 | Phase 1-4 | 到仓、QC 图片、重量、状态、补拍。 |
| 物流与运费系统 | Phase 1-4 | 线路、实重、体积重、estimate/final、tracking。 |
| Coupon / Wallet 系统 | Phase 1-4 | coupon、credit、支付回滚、ROI 监控。 |
| CMS / 配置后台 | Phase 0-2 | 首页、Trust Center、社群入口、creator landing page。 |
| 埋点与归因 | Phase 1-4 | 首页漏斗、首单漏斗、QC、shipping、creator campaign。 |

## 上线红线

- 不允许普通用户访问他人订单、地址、QC、包裹、wallet 数据。
- 不允许 creator 查看用户敏感数据。
- 不允许生产页面展示 mock 商品、测试订单、测试账号。
- 不允许前端展示和后端不匹配的订单/QC/发货状态。
- 不允许隐藏服务费、运费差异、不可退费用或 coupon 限制。
- 不允许首页出现官方 finds、官方推荐商品货架或平台商品背书。
- 不允许日志记录完整地址、token、支付信息。

## 建议排期口径

| Phase | 时间范围 | 目标 |
| --- | --- | --- |
| Phase 0 | 上线前并行处理 | 清理上线红线和核心依赖风险。 |
| Phase 1 | 上线前 1-2 周 | 完成 V1.0 收口上线。 |
| Phase 2 | 上线后 2-4 周 | 降低新手疑惑和客服压力。 |
| Phase 3 | 上线后 1-2 个月 | 增强 personal haul workspace 能力。 |
| Phase 4 | 上线后 3-6 个月 | 建设 creator-compatible 平台化能力。 |

