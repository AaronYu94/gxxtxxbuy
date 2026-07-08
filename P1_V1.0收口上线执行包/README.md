# GOATEDBUY P1 V1.0 收口上线执行包

> 目标：完成 GOATEDBUY Website V1.0 的可见产品链路上线，让用户从首页粘贴外部商品链接开始，完成 My Haul、订单、QC、发货、wallet 和规则理解的基础闭环。

## P1 和 P0 的关系

- P0 解决上线红线：权限、敏感字段、mock 数据、状态映射、降级策略。
- P1 解决上线体验：页面结构、用户流程、核心交互、埋点、QA 验收。
- P1 上线前必须确认 P0 No-Go 项全部关闭。

## P1 核心目标

用户进入 GOATEDBUY 后，应该能快速理解：

```text
Find it anywhere.
Paste it here.
Ship it with us.
```

平台不做官方 finds，不背书第三方商品；用户从站外找链接，平台负责代购、到仓、QC、合箱、发货、追踪和规则解释。

## 执行文件

| 文件 | 用途 | 主要负责人 |
| --- | --- | --- |
| `01_P1_主控台.md` | P1 任务、Owner、状态、阻塞项和上线节奏。 | PM / 项目负责人 |
| `02_Home首页执行单.md` | 首页 Hero、Paste Link、Journey、Find Anywhere、社群和 Trust Center 入口。 | 产品 / 设计 / 前端 |
| `03_LinkIntake执行单.md` | 商品链接提交、解析、登录保留、人工补充兜底。 | 产品 / 前端 / 后端 |
| `04_MyHaul执行单.md` | My Haul 商品列表、状态分组、可发货判断和空状态。 | 产品 / 前端 / 后端 |
| `05_Orders执行单.md` | 采购订单列表、状态、异常原因和下一步动作。 | 产品 / 前端 / 后端 |
| `06_QCCenter执行单.md` | QC 图片展示、放大查看、轻量下一步和客服入口。 | 产品 / 前端 / 仓库 / QA |
| `07_ShippingParcel执行单.md` | 可发货商品、线路、重量、运费预览、包裹提交和 tracking。 | 产品 / 前端 / 后端 / 物流 |
| `08_WalletCoupon执行单.md` | 基础 coupon / credit 展示、支付页提示和失败回滚口径。 | 产品 / 后端 / 财务 |
| `09_TrustCenterCommunity执行单.md` | Trust Center 规则中心、creator disclaimer、社群轻入口。 | 产品 / 运营 / 法务 |
| `10_埋点与数据看板.md` | P1 埋点事件、字段、漏斗和上线后看板。 | 产品 / 数据 / 前端 |
| `11_QA回归与上线验收.md` | 核心链路、异常链路、浏览器、性能和上线验收。 | QA / 产品 / 技术 |

## P1 主流程

```text
Home
-> Paste Link
-> Link Intake
-> Login / Sign Up if needed
-> My Haul
-> Orders
-> QC Center
-> Shipping / Parcel
-> Wallet / Coupon
-> Tracking
-> Trust Center when confused
```

## P1 上线范围

| 模块 | P1 必须上线 | P1 可降级 | 不在 P1 |
| --- | --- | --- | --- |
| Home | Hero、Paste Link、Start Haul、Journey、Find Anywhere | creator landing 轻入口 | 官方 finds、商品推荐货架 |
| Link Intake | 链接提交、解析状态、失败兜底 | 自动解析失败转人工补充 | 完整多平台高级解析策略 |
| My Haul | 商品列表、状态分组、可发货判断 | Haul Builder 简化版 | Saved Links / Link Inbox |
| Orders | 基础状态和异常提示 | 异常动作走客服 | 完整自动售后 |
| QC Center | 图片展示、放大、联系客服 | 决策按钮隐藏 | 完整 QC 决策流 |
| Shipping | 线路、重量、费用预览、提交包裹 | 费用接口不稳定时保守说明 | 高级线路推荐 |
| Wallet | coupon / credit 展示 | 自动抵扣未打通时只展示 | Savings Stack |
| Trust Center | 费用、QC、发货、退款、仓储、隐私、disclaimer | CMS 未完成用静态规则 | 多语言规则中心 |

## P1 出口标准

- 首页首屏能让用户 3 秒内理解从外部链接开始。
- Paste Link 可用，失败时不阻断用户继续人工补充。
- 未登录用户粘贴链接后，登录/注册不丢失输入内容。
- My Haul 能区分待采购、采购中、已到仓、QC ready、ready to ship。
- Orders 展示真实状态，异常订单有原因和下一步。
- QC 图片清晰可查看，移动端可放大。
- Shipping 明确 estimated shipping 和 final shipping 的区别。
- Wallet 展示基础 coupon / credit，规则和不可用原因清楚。
- Trust Center 可从首页和关键业务节点进入。
- 埋点覆盖首页、链接提交、首单、QC、发货、支付和规则浏览。
- QA 完成核心链路、异常链路、移动端和性能回归。

