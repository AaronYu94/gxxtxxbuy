# GOATEDBUY Backend 真实部署分阶段计划

> 目标：把当前本地 `localStorage` MVP 升级为真实后端系统，支持客户端、后台、仓库/QC、物流、钱包、风控、审计和后续平台化能力。

## 总体原则

- 先 API contract，再开发前后端联调。
- 客户端和后台共用核心业务数据，但必须走不同权限边界。
- P0 安全红线先落地：鉴权、RBAC、越权防护、敏感字段最小返回、审计。
- 订单、QC、包裹、支付、钱包、退款等状态必须以后端状态机为准。
- QC 图片、用户地址、支付信息、后台备注、creator 数据必须分级保护。
- 每个阶段都要有 staging 验收、回滚方案和生产 smoke test。

## 推荐后端形态

| 层 | 建议 |
| --- | --- |
| API 服务 | Node.js/NestJS 或 FastAPI，先单体模块化，后续可拆服务。 |
| 数据库 | PostgreSQL。 |
| 缓存/队列 | Redis + job queue，用于解析链接、图片处理、物流追踪、通知。 |
| 文件存储 | S3/R2/OSS 类对象存储，用于 QC 图片和附件。 |
| 鉴权 | JWT/session + refresh token，后台强制 RBAC。 |
| 支付 | Stripe/PayPal/本地支付聚合，按业务地区确认。 |
| 物流 | 物流线路配置 + 第三方 tracking API。 |
| 部署 | Docker + CI/CD，先 staging/prod 两套环境。 |
| 监控 | API logs、error tracking、metrics、audit logs、uptime checks。 |

## Phase B0：后端基础设施与工程骨架

### 目标

建立真实后端工程、环境、数据库、CI/CD 和基础可观测能力。

### 范围

| 模块 | 内容 |
| --- | --- |
| Repo | 新建 backend 工程，确定框架、目录、代码规范。 |
| 环境 | local、staging、production 三套配置。 |
| 数据库 | PostgreSQL schema migration。 |
| CI/CD | lint、test、build、migration、deploy pipeline。 |
| Secrets | 环境变量和密钥管理，不入库。 |
| Observability | request log、error log、health check、基础 metrics。 |

### 交付物

- `/backend` 工程。
- 数据库 migration 工具。
- `/health`、`/version`、`/ready`。
- staging 部署地址。
- 基础 CI/CD。

### 验收标准

- staging 可部署。
- migration 可重复执行。
- 服务异常可在日志里定位。
- production secrets 不出现在代码仓库。

## Phase B1：账号、鉴权、RBAC 与审计底座

### 目标

先建权限体系，避免后续业务接口裸奔。

### 范围

| 模块 | 内容 |
| --- | --- |
| 用户账号 | 注册、登录、退出、刷新 token。 |
| 用户身份 | 普通用户、creator、后台用户分离。 |
| RBAC | 采购、仓库、客服、运营、财务、风控、管理员。 |
| 权限校验 | 所有用户资源按 `user_id` 服务端校验。 |
| 审计日志 | 后台敏感操作、导出、权限变更留痕。 |
| 敏感字段 | 地址、支付、token、后台备注最小返回。 |

### 核心表

| 表 | 用途 |
| --- | --- |
| `users` | 普通用户。 |
| `admin_users` | 后台用户。 |
| `roles` | 角色。 |
| `permissions` | 权限点。 |
| `role_permissions` | 角色权限映射。 |
| `sessions` | 登录 session / refresh token。 |
| `audit_logs` | 审计日志。 |

### API

| API | 说明 |
| --- | --- |
| `POST /auth/register` | 用户注册。 |
| `POST /auth/login` | 用户登录。 |
| `POST /auth/logout` | 退出。 |
| `GET /me` | 当前用户。 |
| `GET /admin/me` | 当前后台用户和权限。 |
| `GET /admin/audit-logs` | 审计查询。 |

### 验收标准

- 普通用户不能访问他人数据。
- creator 不能访问用户敏感数据。
- 后台接口无权限返回 403。
- 高风险后台操作进入 `audit_logs`。

## Phase B2：客户端核心链路 API

### 目标

替换前端 `localStorage`，让客户端核心链路接入真实 API。

### 范围

| 模块 | 内容 |
| --- | --- |
| Link Intake | 保存链接、解析状态、人工补充。 |
| My Haul | 商品列表、状态分组、提交采购。 |
| Orders | 采购订单、状态机、异常状态。 |
| Trust Center | 基础规则读取。 |

### 核心表

| 表 | 用途 |
| --- | --- |
| `saved_links` | 用户保存/提交的商品链接。 |
| `haul_items` | 用户 haul 商品。 |
| `purchase_orders` | 采购订单。 |
| `order_status_history` | 订单状态历史。 |
| `policy_pages` | Trust Center 内容。 |

### API

| API | 说明 |
| --- | --- |
| `POST /links` | 保存/提交商品链接。 |
| `POST /links/:id/parse` | 触发链接解析。 |
| `PATCH /links/:id` | 人工补充商品信息。 |
| `POST /links/:id/add-to-haul` | 加入 My Haul。 |
| `GET /haul-items` | 获取 My Haul。 |
| `POST /purchase-orders` | 提交采购订单。 |
| `GET /orders` | 用户订单列表。 |
| `GET /orders/:id` | 用户订单详情。 |
| `GET /policies` | Trust Center 规则。 |

### 验收标准

- 前端不再依赖 `localStorage` 作为业务真源。
- 未登录 paste link 后登录不丢失。
- 订单状态以后端为准。
- 异常订单必须有原因和下一步。

## Phase B3：仓库、QC、文件存储与 90 天仓储

### 目标

支持商品到仓、QC 图片、重量、仓储天数和用户 QC 决策。

### 范围

| 模块 | 内容 |
| --- | --- |
| Warehouse | 入库、称重、仓储开始时间。 |
| QC | 上传 3-5 张 QC 图片，状态更新。 |
| Object Storage | QC 图片私有存储 + 签名访问。 |
| Storage | 90 天免费仓储规则。 |
| QC Action | approve、extra photo、return/exchange、support。 |

### 核心表

| 表 | 用途 |
| --- | --- |
| `warehouse_items` | 仓库状态、重量、入库时间。 |
| `qc_photos` | QC 图片元数据。 |
| `qc_actions` | 用户 QC 决策。 |
| `storage_records` | 仓储天数和规则。 |

### API

| API | 说明 |
| --- | --- |
| `GET /qc/items` | 用户 QC 列表。 |
| `POST /qc/items/:id/approve` | 用户确认 QC。 |
| `POST /qc/items/:id/extra-photo` | 请求补拍。 |
| `POST /admin/warehouse/items/:id/receive` | 后台入库。 |
| `POST /admin/qc/items/:id/photos` | 后台上传 QC 图片。 |
| `PATCH /admin/warehouse/items/:id/weight` | 更新重量。 |

### 验收标准

- QC 图片只有当前用户可访问。
- 无 QC 图片不能显示 QC ready。
- 90 天免费仓储规则可计算。
- 后台修改重量/QC 图片进入审计。

## Phase B4：包裹、国际物流、运费与支付

### 目标

支持用户合箱、线路选择、运费预估、最终运费、支付和 tracking。

### 范围

| 模块 | 内容 |
| --- | --- |
| Parcel | 多商品合箱、包裹草稿、提交包裹。 |
| Shipping Lines | 150+ 线路配置、国家限制、计费规则。 |
| Shipping Preview | 实重、体积重、费用区间、不可用原因。 |
| Payment | 国际运费支付。 |
| Tracking | tracking number 和物流轨迹。 |

### 核心表

| 表 | 用途 |
| --- | --- |
| `parcels` | 包裹。 |
| `parcel_items` | 包裹商品。 |
| `shipping_lines` | 物流线路。 |
| `shipping_quotes` | 运费预估。 |
| `shipping_payments` | 国际运费支付。 |
| `tracking_events` | 物流轨迹。 |

### API

| API | 说明 |
| --- | --- |
| `POST /parcels/draft` | 创建包裹草稿。 |
| `POST /shipping/preview` | 获取运费预览。 |
| `POST /parcels` | 提交包裹。 |
| `POST /shipping-payments` | 创建国际运费支付。 |
| `GET /parcels/:id/tracking` | tracking。 |
| `GET /admin/shipping-lines` | 后台线路管理。 |
| `PATCH /admin/parcels/:id` | 后台更新包裹状态。 |

### 验收标准

- 只有 ready to ship 商品可提交包裹。
- estimated/final shipping 明确分离。
- 支付失败 coupon/credit 可回滚。
- tracking 不生成假单号。

## Phase B5：Wallet、Coupon、Welcome Gift 与财务规则

### 目标

支持真实 coupon、credit、Welcome Gift、支付回滚和财务审计。

### 范围

| 模块 | 内容 |
| --- | --- |
| Wallet | credit balance、使用记录。 |
| Coupon | 可用、已用、过期、不可用原因。 |
| Welcome Gift | 新用户礼物。 |
| Payment rollback | 支付失败回滚 coupon/credit。 |
| Admin finance | 发券、作废、调整 credit。 |

### 核心表

| 表 | 用途 |
| --- | --- |
| `wallets` | 用户 wallet。 |
| `wallet_transactions` | wallet 流水。 |
| `coupons` | coupon 定义。 |
| `user_coupons` | 用户 coupon。 |
| `coupon_redemptions` | 使用记录。 |

### API

| API | 说明 |
| --- | --- |
| `GET /wallet` | 用户 wallet。 |
| `POST /coupons/redeem-code` | 输入 code。 |
| `POST /welcome-gift/claim` | 领取 Welcome Gift。 |
| `POST /checkout/apply-coupon` | 应用 coupon。 |
| `POST /admin/coupons` | 后台发券。 |
| `PATCH /admin/wallets/:userId/credit` | 后台调整 credit。 |

### 验收标准

- coupon 不可用必须返回原因。
- 支付失败 coupon/credit 状态正确回滚。
- 财务相关后台操作必须审计。
- 避免强刺激消费设计。

## Phase B6：后台 Admin Console API

### 目标

让当前 `/app/admin.html` 接真实后台 API，不再读本地 demo 数据。

### 范围

| 模块 | 内容 |
| --- | --- |
| Procurement | 采购订单状态、异常、退款入口。 |
| Warehouse/QC | 入库、称重、QC 图片。 |
| Shipping Ops | 包裹、线路、tracking、发货状态。 |
| Policy CMS | Trust Center、Shipping Hub、FAQ。 |
| Wallet Ops | 发券、credit 调整。 |
| Role-gated UI | 根据后台权限显示/禁用功能。 |

### API

| API | 说明 |
| --- | --- |
| `GET /admin/orders` | 后台订单队列。 |
| `PATCH /admin/orders/:id/status` | 更新订单状态。 |
| `PATCH /admin/orders/:id/exception` | 更新异常。 |
| `GET /admin/warehouse/items` | 仓库队列。 |
| `GET /admin/parcels` | 包裹队列。 |
| `GET /admin/policies` | 政策内容。 |
| `PATCH /admin/policies/:id` | 修改政策。 |

### 验收标准

- 后台用户必须登录。
- 无权限操作被拒绝。
- 客户端看不到后台备注、内部成本、风险标记。
- 所有状态变更记录操作者。

## Phase B7：风控、内容审核、Creator 与平台化能力

### 目标

进入 V2.0 平台能力：creator dashboard、Haul Stories、风险控制、内容审核、Shipping Hub。

### 范围

| 模块 | 内容 |
| --- | --- |
| Creator Dashboard | creator 汇总数据，不给用户敏感明细。 |
| Campaign Tracking | 首单、shipping payment、复购归因。 |
| Haul Stories | 用户自愿分享、审核、举报、撤销。 |
| Risk Console | 异常订单、违规内容、coupon 滥用。 |
| Country Shipping Hub | 国家/线路规则、FAQ、公告。 |

### 核心表

| 表 | 用途 |
| --- | --- |
| `creators` | creator。 |
| `creator_campaigns` | creator campaign。 |
| `creator_attributions` | 归因记录。 |
| `haul_stories` | 用户分享内容。 |
| `content_reviews` | 内容审核。 |
| `risk_cases` | 风险 case。 |
| `country_shipping_rules` | 国家物流规则。 |

### 验收标准

- creator dashboard 不泄露用户敏感数据。
- Haul Stories 默认保护隐私。
- 风险 case 可分派、处理、关闭。
- 内容审核动作进入审计。

## Phase B8：生产上线、迁移与稳定性

### 目标

从本地 MVP 切到真实 API 和生产环境。

### 上线步骤

| 步骤 | 内容 |
| --- | --- |
| 1 | staging 全链路回归。 |
| 2 | 生产数据库 migration dry run。 |
| 3 | 生产环境 secrets 和域名配置。 |
| 4 | 前端切 API base URL。 |
| 5 | 小流量灰度。 |
| 6 | 生产 smoke test。 |
| 7 | 监控错误率、接口延迟、支付、订单状态。 |
| 8 | 放量或回滚。 |

### 回滚策略

| 类型 | 策略 |
| --- | --- |
| 前端问题 | 回滚静态资源版本。 |
| API 问题 | 回滚服务镜像。 |
| migration 问题 | 使用向后兼容 migration，禁止破坏性即时变更。 |
| 支付问题 | 关闭支付入口，保留订单和 wallet 状态。 |
| 物流问题 | 隐藏不稳定线路，保留客服入口。 |

### 验收标准

- production smoke test 通过。
- 关键接口错误率在阈值内。
- 日志、监控、告警可用。
- 备份和恢复演练完成。
- 没有 P0 安全红线问题。

## 推荐实施顺序

| 优先级 | 阶段 | 原因 |
| --- | --- | --- |
| 1 | B0 + B1 | 没有工程底座和权限，后续业务接口不安全。 |
| 2 | B2 | 让客户端核心链路摆脱 localStorage。 |
| 3 | B3 | QC 图片和仓库是 agent 信任核心。 |
| 4 | B4 + B5 | 形成完整付费发货闭环。 |
| 5 | B6 | 后台接真实 API，运营可处理订单。 |
| 6 | B7 | 平台化、creator、内容和风控。 |
| 7 | B8 | 生产灰度和稳定性。 |

## 第一阶段建议排期

| 周期 | 目标 |
| --- | --- |
| Week 1 | B0 工程骨架、数据库、CI/CD、staging。 |
| Week 2 | B1 鉴权、RBAC、审计、用户/后台登录。 |
| Week 3 | B2 Link Intake、My Haul、Orders API。 |
| Week 4 | B3 Warehouse/QC/图片存储。 |
| Week 5 | B4 Parcel/Shipping Preview。 |
| Week 6 | B5 Wallet/Coupon/Welcome Gift。 |
| Week 7 | B6 Admin Console API。 |
| Week 8 | staging 全链路回归 + production 灰度准备。 |

## 当前前端需要改造的点

| 当前 | 真实后端后 |
| --- | --- |
| `localStorage` 保存用户数据 | 替换为 API + 用户登录态。 |
| 本地状态推进订单 | 后台采购/仓库状态机推进。 |
| QC 占位图 | 对象存储真实 QC 图片。 |
| coupon 本地写入 | Wallet/Coupon API。 |
| Admin 读同一份 localStorage | Admin API + RBAC。 |
| Audit Log 本地数组 | 后端不可篡改审计日志。 |

