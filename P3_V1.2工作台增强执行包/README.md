# GOATEDBUY P3 V1.2 工作台增强执行包

> 目标：在 V1.0 核心链路和 V1.1 降噪体验稳定后，把 GOATEDBUY 从普通 agent 网站升级为 personal haul workspace，让用户愿意把链接、haul、QC、发货、优惠、历史和 creator 归因沉淀在平台内。

## P3 和前置阶段的关系

- P0：数据安全和上线红线。
- P1：Home -> Link Intake -> My Haul -> Orders -> QC -> Shipping 主链路。
- P2：新手引导、QC 决策、退款、Shipping FAQ、coupon 解释、社群/客服降噪。
- P3：增强用户工作台，让用户保存链接、组合 haul、复盘历史、理解 savings，并支持 creator campaign tracking。

## P3 核心目标

| 目标 | 说明 |
| --- | --- |
| 沉淀链接资产 | 用户可以先保存外部商品链接，后续再处理。 |
| 强化 haul 组合 | 用户能更清楚地选择哪些商品组成一次发货。 |
| 提升发货决策 | Shipping Preview 更完整，减少运费和线路不确定感。 |
| 建立账户资产感 | Savings Stack 展示 coupon、credit、shipping saving 的真实累计。 |
| 促进复购 | Haul History 让用户回看历史订单、线路、费用和发货记录。 |
| 支持自愿传播 | Shareable haul recap 让用户在保护隐私前提下分享 haul。 |
| 提升增长归因 | creator campaign tracking 从首单扩展到复购和 shipping payment。 |

## 执行文件

| 文件 | 用途 | 主要负责人 |
| --- | --- | --- |
| `01_P3_主控台.md` | P3 任务、owner、状态、阻塞项和指标。 | PM / 项目负责人 |
| `02_LinkInbox执行单.md` | Saved Links / Link Inbox 链接保存、分组、处理。 | 产品 / 前端 / 后端 |
| `03_HaulBuilder完整版执行单.md` | 完整 Haul Builder、商品组合、可发货判断、包裹草稿。 | 产品 / 前端 / 后端 / 仓库 |
| `04_ShippingPreview增强执行单.md` | 更完整的线路、重量、国家、限制、费用预估。 | 产品 / 物流 / 后端 |
| `05_SavingsStack执行单.md` | coupon、credit、shipping saving 的真实累计和展示。 | 产品 / 财务 / 数据 |
| `06_HaulHistory执行单.md` | 历史 haul、订单、QC、发货、coupon 使用记录。 | 产品 / 前端 / 后端 |
| `07_ShareableHaulRecap执行单.md` | 用户自愿分享 haul recap，隐私保护和内容审核。 | 产品 / 运营 / 法务 |
| `08_CreatorCampaignTracking执行单.md` | creator 首单、复购、GMV、shipping payment 归因。 | 增长 / 数据 / 后端 |
| `09_工作台信息架构与导航.md` | Workspace IA、导航、状态聚合和入口优先级。 | 产品 / 设计 |
| `10_数据模型与接口清单.md` | P3 新增对象、字段、接口和状态依赖。 | 产品 / 后端 / 数据 |
| `11_埋点与复购看板.md` | P3 事件、复购、link save、history、creator campaign 看板。 | 数据 / 产品 |
| `12_QA回归与验收.md` | P3 功能、异常、隐私、埋点和性能验收。 | QA / 产品 |

## P3 上线范围

| 模块 | 必须上线 | 可降级 | 不在 P3 |
| --- | --- | --- | --- |
| Link Inbox | 保存链接、解析状态、加入 haul | 标签/批量操作可简化 | 社交化公开链接库 |
| Haul Builder | 商品选择、包裹草稿、可发货判断 | 高级优化推荐可延后 | 自动最优发货 AI |
| Shipping Preview | 国家/线路/重量/限制/费用增强 | 部分国家先静态规则 | 完整物流成本平台 |
| Savings Stack | 真实 coupon、credit、shipping saving 记录 | 可先只做列表 | 夸张营销式 savings |
| Haul History | 历史 haul、订单、QC、发货记录 | 筛选可简化 | 完整财务报表 |
| Shareable Recap | 用户自愿生成分享页 | P2 优先级，可试点 | 默认公开分享 |
| Creator Tracking | creator 首单和复购归因 | dashboard 可延后 | creator 查看用户敏感数据 |

## P3 出口标准

- 用户能保存链接，并从 Link Inbox 加入 My Haul。
- 用户能在 Haul Builder 中选择 ready to ship 商品，生成包裹草稿。
- Shipping Preview 能结合国家、线路、实重、体积重和限制商品解释费用。
- Savings Stack 只展示真实已发生优惠，不夸大节省金额。
- Haul History 能展示历史采购、QC、发货、coupon 使用记录。
- Shareable haul recap 默认隐藏地址、支付、订单号等敏感信息。
- creator campaign tracking 能追踪首单和复购，但 creator 不能查看用户敏感数据。
- P3 埋点能衡量 30 日复购、平均 haul 数、link save 到下单转化、creator campaign 效果。

