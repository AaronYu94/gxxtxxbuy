# GOATEDBUY P4 V2.0 平台化执行包

> 目标：在保持中立 agent 边界的基础上，建设 creator-compatible 的平台能力，把用户资产、creator 生态、shipping 偏好、QC 偏好、风控、内容治理和审计沉淀到平台内。

## P4 和前置阶段的关系

- P0：上线红线和数据安全。
- P1：V1.0 核心链路跑通。
- P2：V1.1 降低新手疑惑和客服压力。
- P3：V1.2 工作台增强，沉淀链接、haul、history、savings、creator tracking。
- P4：V2.0 平台化，补 creator dashboard、用户偏好、国家物流中心、内容分享、风控后台和完整审计。

## P4 核心目标

| 目标 | 说明 |
| --- | --- |
| creator-compatible | 支持 creator 查看必要归因和转化，但不暴露用户敏感数据。 |
| personal profile | 沉淀用户 shipping profile 和 QC preferences，提升复购效率。 |
| shipping intelligence | Country Shipping Hub 按国家整理线路、费用、时效、限制和规则。 |
| community content | 用户可自愿分享 Haul Stories，但需隐私保护和内容审核。 |
| risk control | 风控后台处理异常订单、违规内容、敏感商品、滥用优惠。 |
| auditability | 后台敏感操作、导出、权限变更、财务操作全部留痕。 |

## 执行文件

| 文件 | 用途 | 主要负责人 |
| --- | --- | --- |
| `01_P4_主控台.md` | P4 任务、owner、状态、阻塞项和指标。 | PM / 项目负责人 |
| `02_CreatorDashboard执行单.md` | creator dashboard、归因、转化、权限边界。 | 增长 / 数据 / 后端 |
| `03_UserShippingProfile执行单.md` | 用户国家、线路、地址偏好、包裹偏好。 | 产品 / 前端 / 后端 |
| `04_QCPreferences执行单.md` | 用户 QC 偏好、关注点、补拍偏好。 | 产品 / 仓库 / 后端 |
| `05_CountryShippingHub执行单.md` | 国家物流中心、线路、限制、费用解释。 | 产品 / 物流 / 运营 |
| `06_HaulStories内容平台执行单.md` | 用户自愿分享 Haul Stories、隐私、审核。 | 产品 / 运营 / 法务 |
| `07_风控后台执行单.md` | 异常订单、敏感商品、coupon 滥用、creator 风险。 | 风控 / 后端 / 运营 |
| `08_审计日志执行单.md` | 敏感操作、导出、权限变更、财务操作留痕。 | 后端 / 安全 / 合规 |
| `09_后台角色权限治理.md` | 采购、仓库、客服、运营、财务、管理员权限矩阵。 | 安全 / 后端 / 运营 |
| `10_内容审核与合规SOP.md` | 社群、Haul Stories、creator 内容审核和处理。 | 运营 / 法务 |
| `11_数据模型与接口清单.md` | P4 新增对象、字段、接口和权限要求。 | 产品 / 后端 / 数据 |
| `12_埋点与平台看板.md` | P4 creator、profile、risk、audit、content 看板。 | 数据 / 产品 |
| `13_QA回归与验收.md` | P4 权限、风控、审计、内容、埋点验收。 | QA / 安全 / 产品 |

## P4 上线范围

| 模块 | 必须上线 | 可降级 | 不在 P4 |
| --- | --- | --- | --- |
| Creator Dashboard | 汇总访问、首单、shipping、复购、GMV 区间 | creator 自助提现可延后 | creator 查看用户敏感数据 |
| Shipping Profile | 国家、常用线路、地址偏好、包裹偏好 | 高级推荐可延后 | 自动最优线路承诺 |
| QC Preferences | 用户关注点和补拍偏好 | 仓库执行半自动 | 真伪鉴定承诺 |
| Country Shipping Hub | 国家/线路规则、费用、限制、FAQ | 先覆盖主力国家 | 全国家物流百科 |
| Haul Stories | 用户自愿分享、审核、举报 | 先白名单试点 | 默认公开用户订单 |
| Risk Console | 异常订单、违规内容、滥用优惠处理 | 规则引擎可简化 | 全自动风控决策 |
| Audit Log | 敏感操作和导出留痕 | 可先覆盖 P0 高风险操作 | 无审计的后台敏感操作 |

## P4 出口标准

- creator dashboard 只展示必要归因和汇总转化，不展示用户敏感数据。
- 用户 shipping profile 能用于复购和 Shipping Preview，但不做不确定承诺。
- QC preferences 能被仓库/客服理解和执行，且不承诺真伪鉴定。
- Country Shipping Hub 可支持主力国家的规则解释和客服引用。
- Haul Stories 默认隐私保护，用户可撤销，内容可审核和举报。
- 风控后台能处理异常订单、违规内容、敏感商品、coupon 滥用和 creator 风险。
- 审计日志覆盖后台敏感操作、数据导出、权限变更和财务相关操作。

