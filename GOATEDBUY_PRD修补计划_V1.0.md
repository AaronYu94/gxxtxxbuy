# GOATEDBUY PRD 修补计划 V1.0（全面覆盖）

> 依据：`GOATEDBUY_产品分析与需求文档_V1.0.docx` 逐模块对照当前实现（后端 B0–B8 已完成、前端 app/ 为 demo 级、真实设计为 Artifact 稿）后，形成的收口 + 补齐计划。
>
> 目标：把「实现 vs PRD」的全部缺口拆成可一次跑完、可验收、可回滚的原子任务，覆盖 V1.0 收口红线、V1.1/V1.2/V2.0 剩余、真实链接抓取，以及非功能需求（埋点、性能、兼容、安全）。

## 现状基线（对照结论）

| 维度 | 状态 |
| --- | --- |
| 后端履约链路（Link→Haul→Orders→QC→Shipping→Wallet→Trust） | ✅ 已实现且有回归测试（B2–B6） |
| 数据安全红线（user_id 隔离、字段脱敏、6 角色 RBAC、审计日志、日志脱敏） | ✅ 基本达标（B1/B6/B8-09） |
| V2.0 平台化（Creator dashboard、Country Hub、Haul Stories+审核、风控、审计） | ✅ 约 70%（B7） |
| 链接解析 | 🟡 管道+placeholder 已通（parsing/），真实数据源未接 |
| 前端 | 🟡 demo 级（localStorage），新设计仅 Artifact；无独立官网层 |
| **埋点 / Analytics（4.1 的 14 事件）** | ❌ **完全没做（最大缺口）** |
| Support / 客服工单 | ❌ 未做 |
| Creator landing page / 商品图片持久化 / 导出权限 / User shipping profile / QC preferences | ❌ 未做 |

## 阶段总览

| 阶段 | 名称 | 目标 | 阻塞上线？ |
| --- | --- | --- | --- |
| R0 | 上线红线与字段一致性收口 | mock 隔离、字段对齐、图片持久化、导出管控 | 是（P0） |
| R1 | 埋点 / Analytics 事件系统 | 补齐 4.1 全部 14 事件 + 漏斗看板 | 是（P0，数据红线） |
| R2 | 前端落地（设计→真实 app/ + 官网层） | 新设计固化、拆分官网层、Creator landing | 是（P0 感知差异化） |
| R3 | Support / 客服工单系统 | 用户闭环缺失的一环 | 部分（P1） |
| R4 | V1.1 体验降噪补齐 | Refund Timeline、FAQ、异常文案、coupon 解释 | 否（P1） |
| R5 | V2.0 平台化剩余 | User shipping profile、QC preferences、Stories/Hub 前端 | 否（P2） |
| R6 | 真实链接抓取（替换 placeholder） | 接聚合 API 或自建抓取 + fallback + 缓存 | 否（P1，体验核心） |
| R7 | 性能、兼容与上线验证 | 首屏预算、图片分层、兼容矩阵、压测、上线复测 | 是（P0 收尾） |

## 通用完成定义（每个任务都必须满足）

- 有 schema/输入校验、标准错误响应、最小单元/集成测试。
- 涉及用户资源做 `user_id` 服务端校验；涉及后台做 RBAC；涉及敏感操作写 audit log。
- 外部依赖有 timeout / retry / 降级；日志不写完整地址、token、支付信息。
- **可回滚**：新表向后兼容；新功能可用 feature flag / 路由 / 配置关闭（复用 B8-07 开关体系）。
- 完成后更新本文件状态，并跑 `npm run ci` 保持绿。

---

## R0：上线红线与字段一致性收口（P0）

| ID | 任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| R0-01 | 前端 demo/假数据 gating | 无 | `?demo=1` 或构建标志才启用 localStorage 假数据；生产默认 API-only | 生产模式未连 API 时不展示任何假业务数据；切换有测试/说明。 |
| R0-02 | 商品图片持久化 | B2 | migration 给 `saved_links`/`haul_items` 加 `images jsonb`；parse worker 写入；前端展示缩略图 | 无图不崩；图 URL 只读展示；PRD Link Intake 的 `image` 字段落库。 |
| R0-03 | 数据导出权限管控 | B1/B8-09 | 受控导出端点（用户/订单/地址）：RBAC + 记录操作人/时间/范围 + 审计 | 无权限 403；导出必写审计；无导出功能的域明确禁用。 |
| R0-04 | 前后端字段对齐核对表 | B2–B6 | `deploy/production/field-alignment.md`：每个 API 响应字段 ↔ 前端消费字段核对 | 差异清单为空或有跟踪项；消灭「前端展示与后端不匹配的状态」。 |
| R0-05 | 生产红线复核补强 | B8-01 | `env:check` 增加前端 demo gate、导出开关校验 | 缺项无法上线；与 B8-09 安全清单联动。 |

## R1：埋点 / Analytics 事件系统（P0 · 最大缺口）

> 对应 PRD 4.1（14 个事件）+ 第 7 节指标口径。内部 audit_logs ≠ 产品埋点，需独立体系。

| ID | 任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| R1-01 | 事件采集后端 | B0/B1 | `analytics_events` migration + `POST /events`（批量）：event_name、props、user_id、session_id、source、utm、creator_code、ts | 匿名可上报；字段脱敏（无地址/token/支付）；批量幂等；限流。 |
| R1-02 | 前端埋点 SDK | R1-01 | 轻量 `track(event, props)`：批量缓冲 + 失败重试 + 不阻塞渲染 + 页面卸载 flush | 网络失败不丢事件（本地队列）；不阻塞首屏。 |
| R1-03 | 首页/入口事件接入 | R1-02 | home_page_view、paste_link_start、paste_link_submit、click_start_haul、journey_view/step_click | 事件字段与 PRD 4.1 一致；来源/UTM/creator_code 带上。 |
| R1-04 | 履约链路事件接入 | R1-02 | link_parse_success/fail、haul_item_add、purchase_order_submit、qc_view、qc_action | 覆盖成功/失败路径；qc_action 区分确认/补拍/退换。 |
| R1-05 | 支付/规则/增长事件接入 | R1-02 | parcel_submit、shipping_pay_success/fail、trust_policy_view、support_ticket_create、creator_page_view/conversion | 支付事件与真实回调一致，不重复计数。 |
| R1-06 | 归因贯通 | R1-01/B7 | UTM + creator_code + 来源渠道 → events + 注册/首单归因（复用 B7 attribution） | 无 code 也不报错；注册/首单可回溯来源。 |
| R1-07 | 漏斗与指标看板（最小） | R1-01 | paste→注册→首单→QC→包裹→支付 漏斗 + 第 7 节指标口径；或导出到外部分析 | 口径与 PRD 一致；数据权限错误数可监控。 |
| R1-08 | 埋点回归 | R1-03..07 | 事件 schema 校验 + 关键事件端到端测试 | schema 不符拒收；关键漏斗事件有覆盖。 |

## R2：前端落地（设计 → 真实 app/ + 官网层）（P0）

| ID | 任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| R2-01 | 设计系统固化 | 无 | 把「logistics-grade」tokens/组件落成 `styles`，替换蓝色 demo 皮；明暗双主题 | 组件一致；对比度达标；不破坏现有交互。 |
| R2-02 | 拆分官网层 Public Website | R2-01 | 独立轻量首页：Hero+Paste Link+Journey+Find Anywhere+社群/Trust 入口；不承载详细功能、不做 finds | 首屏可懂「站外找链接、站内处理」；无官方货架。 |
| R2-03 | 客户端工作台重构到新设计 | R2-01 | My Haul/Orders/QC/Shipping/Wallet/Creator 全部迁到新设计，保留 API 接线 | 真实 API 链路不回退假数据；loading/error/重试态统一。 |
| R2-04 | Creator landing page | R2-01/B7 | 页面：creator name/code、Start haul CTA、first haul basics、third-party disclaimer + 归因 | creator 不可见用户敏感数据；带 disclaimer；归因落库。 |
| R2-05 | 移动端 H5 与跳转适配 | R2-02/03 | H5 响应式 + TikTok/社群 WebView 跳转验证 | 移动端 Journey 纵向可读；跳转不丢链接/参数。 |
| R2-06 | 前端统一降级态 | R2-03 | loading/空/error/重试 组件；接口超时降级文案 | 任一核心接口失败都有兜底，不出现空白/卡死。 |

## R3：Support / 客服工单系统（P1）

| ID | 任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| R3-01 | support_tickets migration | B1/B2 | 工单表：user/order/type/status/优先级 + 消息表 | 状态枚举 + user 归属约束。 |
| R3-02 | 用户建单/查单 API | R3-01 | POST/GET `/support/tickets`（来源含 QC 补拍/退换/异常） | 只看自己工单；重复建单可控；输入校验。 |
| R3-03 | 客服后台工单队列 | R3-01/B6 | 队列 + 回复 + 状态流转（RBAC `support:write` + 审计） | 无权限 403；状态流转合法；写审计。 |
| R3-04 | 前端 Support 入口 + 工单页 | R2/R3-02 | QC/Orders/Shipping 页跳转 + 工单详情/回复 | 入口在关键节点可达；空态清晰。 |
| R3-05 | support_ticket_create 埋点 | R1/R3-02 | 事件接入 | 与 R1-05 对齐。 |

## R4：V1.1 体验降噪补齐（P1）

| ID | 任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| R4-01 | First Haul Guide 内容化 | B2-13 | CMS 驱动的新手引导（替代硬编码） | 内容可后台配置；有默认兜底。 |
| R4-02 | Refund Timeline | B2/R3 | 退款时间线状态 + 规则页 | 状态与后台真实流程一致；无假承诺。 |
| R4-03 | Shipping FAQ by country 接入 | B7-14 | 前端接 Country Shipping Hub（后端已有） | 只展示 published；过期内容标记。 |
| R4-04 | Coupon 使用解释 UI | B5-08 | 适用范围/不可叠加/最低金额原因展示（后端 eligibility 已有） | 不可用有明确原因；金额计算准确。 |
| R4-05 | 异常订单文案优化 | B6-04 | 异常状态给「下一步」：等退款/联系客服/改规格 | 不出现模糊状态；与 exception_reason 对齐。 |

## R5：V2.0 平台化剩余（P2）

| ID | 任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| R5-01 | User Shipping Profile | B4 | 常用地址/国家/线路偏好 migration + API + 前端 | 仅本人可见；地址字段脱敏于日志。 |
| R5-02 | QC Preferences | B3 | 用户 QC 偏好（默认补拍、拍摄要求）migration + API | 偏好影响 QC 流程；有默认值。 |
| R5-03 | Haul Stories 前端 | B7-06..09 | 用户自愿分享 + 隐私默认 private（后端已有） | 默认不公开；发布需审核。 |
| R5-04 | Country Shipping Hub 公共页 | B7-14 | 公共国家运费页前端 | 无需登录可访问；只 published。 |

## R6：真实链接抓取（替换 placeholder）（P1）

| ID | 任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| R6-01 | 数据源选型与合规评估 | parsing/ | 决策记录（聚合 API vs 自建）+ 成本/合规/风控评估 | 明确走哪条、风险已评估。 |
| R6-02 | 平台 Adapter 实现 | R6-01 | Taobao mtop 签名器 / 1688 / Weidian adapter，fixture 单测 | 签名/解析纯函数可测；网络层可注入。 |
| R6-03 | 短链 + 淘口令解析 | R6-02 | 跟随重定向 + 淘口令还原 resolver | 失败降级人工；超时可控。 |
| R6-04 | fallback 链 + 缓存 | R6-02 | `[真实源, placeholder]` 链 + 按 item_id 缓存 + 价格按需刷新 | 主源挂自动降级；缓存不返回过期价。 |
| R6-05 | 图片抓取与存储 | R6-02/R0-02 | 商品图/Yupoo 相册抓取 + 私有存储/代理 + 展示 | 图失败不阻断；防盗链处理。 |
| R6-06 | 抓取运维与告警 | R6-02/B8-06 | 代理池、token 刷新、失败率告警 | 风控/封禁有告警；限速礼貌请求。 |

## R7：性能、兼容与上线验证（P0 收尾）

| ID | 任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| R7-01 | 首屏性能预算 | R2 | 移动 ≤2.5s / 桌面 ≤2s：CDN、缩略图、懒加载 | 达标并有度量。 |
| R7-02 | QC 图片分层加载 | B3/R2 | 缩略图 + 大图分层；移动端清晰 | 弱网可用；不拖垮首屏。 |
| R7-03 | 兼容性矩阵验证 | R2 | iOS/Android/Chrome/Safari/Edge/WebView + TikTok 跳转 | 关键路径全绿。 |
| R7-04 | 压测 | R1/R2 | 首页/解析/注册登录/下单 压测报告 | 峰值下成功率 ≥99%。 |
| R7-05 | 成功率/告警接入 | B8-06 | 核心流程成功率监控（提交链接/下单/QC/包裹/支付） | 低于阈值告警。 |
| R7-06 | 上线前 P0 安全回归 + mock 复测 | B8-09/R0-01 | 越权/敏感字段/导出/日志/假数据 全复测 | 数据权限错误数 = 0。 |
| R7-07 | i18n 脚手架 | R2 | 英文优先 + 多语言预留 | 文案抽离，可扩展。 |

---

## 推荐执行顺序

1. **先清红线（并行）**：R0-01/02/04（假数据 gating、图片、字段对齐）+ R1-01/02（埋点底座）。
2. **补数据验证能力**：R1-03..08（全事件接入 + 漏斗）——V1.0 数据红线。
3. **前端落地**：R2-01/02/03（设计固化 + 官网层 + 工作台重构）。
4. **闭环补齐**：R3（Support）+ R4（V1.1 降噪）。
5. **体验核心**：R6（真实抓取，选型后按 fallback 链接入）。
6. **平台化剩余**：R5。
7. **上线收尾**：R7 全量 + R0-03/05 + R7-06 复测。

## PRD 可追溯映射（缺口 → 阶段）

| PRD 位置 | 缺口 | 覆盖阶段 |
| --- | --- | --- |
| 4.1 数据埋点（14 事件） | 完全缺失 | R1 |
| 2.1 官网层 vs 工作台分离 | 无独立官网 | R2-02 |
| 3.9 Creator landing page | 未做页面 | R2-04 |
| 3.2 Link Intake `image` 字段 | 图片未持久化 | R0-02 / R6-05 |
| 3.4/3.5 Support 入口、工单 | 无工单系统 | R3 |
| 4.4 导出限制 | 无管控 | R0-03 |
| 4.4 mock 数据清理 | 前端仍有假数据 | R0-01 / R7-06 |
| 迭代 V1.1（Refund/FAQ/异常） | 部分缺 | R4 |
| 迭代 V2.0（shipping profile/QC pref） | 缺 | R5 |
| 3.2 真实链接解析 | placeholder | R6 |
| 4.2/4.3 性能/兼容 | 未验证 | R7 |

## 上线红线 Checklist（R0+R7-06 汇总）

- [ ] 生产不展示任何 mock/假业务数据（R0-01）
- [ ] 前后端字段对齐、无「展示与后端不匹配的状态」（R0-04）
- [ ] 用户越权访问 = 0，敏感字段不外泄（R7-06 / B8-09）
- [ ] 导出受控 + 审计（R0-03）
- [ ] 埋点关键漏斗事件可用，数据权限错误数可监控（R1-07）
- [ ] `npm run ci` 绿 + `env:check` 通过（B8-01）
