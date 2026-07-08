# GOATEDBUY P2 V1.1 体验降噪执行包

> 目标：在 V1.0 核心链路可跑通后，降低 first-time haul buyers 的理解成本和客服咨询压力，把“能用”升级为“更清楚、更少疑惑、更少争议”。

## P2 和前置阶段的关系

- P0：上线红线，确保权限、数据安全、状态真实、mock 清理。
- P1：V1.0 收口上线，确保 Home -> Link Intake -> My Haul -> Orders -> QC -> Shipping 主链路可跑通。
- P2：V1.1 体验降噪，围绕新手教程、QC 决策、退款、Shipping FAQ、coupon 解释、异常订单和社群规则减少工单。

## P2 核心目标

| 目标 | 说明 |
| --- | --- |
| 降低首单理解成本 | 用户理解为什么要先采购、到仓、QC、再合箱发货。 |
| 降低费用争议 | 用户理解服务费、国内运费、国际运费、estimated/final shipping。 |
| 降低 QC 疑惑 | 用户知道 QC 后可确认、补拍、退换或联系客服。 |
| 降低退款焦虑 | 用户看到退款阶段、预计处理口径和可退/不可退边界。 |
| 降低异常订单工单 | 缺货、改价、卖家不发货、采购失败都有原因和下一步。 |
| 统一社群和客服口径 | Discord/Reddit/creator 页面、Trust Center、客服话术使用同一规则。 |

## 执行文件

| 文件 | 用途 | 主要负责人 |
| --- | --- | --- |
| `01_P2_主控台.md` | P2 任务、owner、状态、阻塞项和指标。 | PM / 项目负责人 |
| `02_FirstHaulGuide执行单.md` | 首单教程、入口、内容结构和验收。 | 产品 / 运营 / 设计 |
| `03_QC决策流程执行单.md` | Approve、补拍、退换、客服入口和状态机。 | 产品 / 前端 / 后端 / 仓库 |
| `04_RefundTimeline执行单.md` | 退款阶段、规则、可退不可退、客服引用口径。 | 产品 / 财务 / 客服 / 后端 |
| `05_ShippingFAQByCountry执行单.md` | 按国家/线路解释时效、限制、体积重和费用变化。 | 产品 / 物流 / 运营 |
| `06_Coupon使用解释执行单.md` | coupon 适用范围、不可用原因、回滚和支付页解释。 | 产品 / 财务 / 后端 |
| `07_异常订单优化执行单.md` | 缺货、改价、卖家不发货、采购失败等异常状态优化。 | 产品 / 采购 / 后端 / 客服 |
| `08_社群置顶规则执行单.md` | Discord/Reddit 频道、置顶规则、官方话术边界。 | 社区运营 / 法务 |
| `09_CreatorLandingPage模板.md` | creator landing page 模板、归因、免责声明和禁区。 | 增长 / 运营 / 前端 |
| `10_客服运营话术与SOP.md` | 首单、QC、退款、Shipping、coupon 常见问题话术。 | 客服 / 运营 / 产品 |
| `11_埋点与降噪看板.md` | V1.1 降噪相关事件和指标看板。 | 数据 / 产品 / 前端 |
| `12_QA回归与验收.md` | P2 核心功能、异常链路、内容和埋点验收。 | QA / 产品 |

## P2 上线范围

| 模块 | 必须上线 | 可降级 | 不在 P2 |
| --- | --- | --- | --- |
| First Haul Guide | 新手教程页面和关键入口 | 静态内容先上线 | 互动式课程 |
| QC Decision | Approve、Request extra photo、Return/Exchange、Contact support | 未打通动作走客服 | 复杂争议仲裁 |
| Refund Timeline | 退款状态和规则说明 | 只展示阶段和客服入口 | 自动财务对账平台 |
| Shipping FAQ | 国家/线路 FAQ、体积重、限制说明 | 先覆盖主力国家 | 完整国家物流百科 |
| Coupon Explain | 不可用原因、支付失败回滚说明 | 自动应用未打通时只展示 | Savings Stack |
| Order Exception | 异常原因和下一步 | 复杂动作走客服 | 完整自动售后 |
| Community Rules | 频道规则和官方边界 | 静态规则先上线 | 完整内容审核系统 |
| Creator Landing | 模板、coupon code、CTA、免责声明 | 少量 creator 试点 | Creator dashboard |

## P2 出口标准

- First Haul Guide 可以从首页、社群入口、订单/QC/Shipping 关键节点进入。
- QC ready 后用户至少能执行 Approve、Request extra photo、Return/Exchange、Contact support 中已打通的动作；未打通动作不能假装可用。
- Refund Timeline 能解释退款阶段、预计口径、可退/不可退费用。
- Shipping FAQ 覆盖主力国家和常见问题：时效、体积重、限制商品、estimate/final。
- coupon 不可用必须展示原因，支付失败后回滚规则清楚。
- 异常订单不只展示状态，必须有原因、下一步和客服入口。
- 社群置顶规则明确官方不背书第三方商品。
- creator landing page 不展示官方商品推荐，不泄露用户敏感数据。
- 上线后可监控客服咨询率、QC 确认率、国际运费支付率和异常订单投诉。

