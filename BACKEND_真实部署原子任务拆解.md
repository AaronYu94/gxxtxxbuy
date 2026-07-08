# GOATEDBUY Backend 真实部署原子任务拆解

> 目标：把 `BACKEND_真实部署分阶段计划.md` 细化为可以逐个执行的后端原子任务。每个任务都应该能在一次开发 run 中完成、验证、提交，并且不依赖模糊上下文。

## 原子任务标准

一个任务只有同时满足以下条件，才算“可以一次跑完”：

| 标准 | 要求 |
| --- | --- |
| 范围小 | 只处理一个模块、一个接口组、一个 migration 或一个中间件。 |
| 输入明确 | 已知依赖、字段、表、API 路径、权限边界。 |
| 输出明确 | 代码、migration、测试、文档或配置至少有一个可交付物。 |
| 可验证 | 必须有自动测试、命令验证、curl 示例或明确 QA 步骤。 |
| 可回滚 | migration 向后兼容；功能可通过 flag、路由或配置关闭。 |
| 鲁棒性 | 覆盖空值、重复提交、越权、无权限、异常状态、幂等或重试。 |
| 不跨阶段 | 不同时做 auth、订单、支付、仓库等多个大域。 |

## 通用完成定义

每个任务完成前必须检查：

- 有类型定义或 schema 校验。
- 有错误响应格式。
- 有最小单元/集成测试。
- 涉及用户资源时必须做 `user_id` 服务端校验。
- 涉及后台操作时必须做 RBAC 校验。
- 涉及敏感操作时必须写 audit log。
- 涉及状态变更时必须写 status history 或等价日志。
- 涉及外部服务时必须有 timeout、retry 或降级策略。
- 不把 secrets、token、完整地址、支付信息写入日志。

## 任务命名

| 前缀 | 阶段 |
| --- | --- |
| B0 | 工程基础设施 |
| B1 | 鉴权、RBAC、审计底座 |
| B2 | 客户端核心链路 API |
| B3 | 仓库、QC、文件存储 |
| B4 | 包裹、物流、支付 |
| B5 | Wallet、Coupon、Welcome Gift |
| B6 | Admin Console API |
| B7 | 风控、内容、Creator、平台化 |
| B8 | 生产部署、迁移、稳定性 |

## B0：工程基础设施

| ID | 单次任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| B0-01 | 初始化 `/backend` 工程骨架 | 无 | 框架目录、启动脚本、README | 本地启动成功；空服务不连接业务外部依赖也能启动。 |
| B0-02 | 配置环境变量加载器 | B0-01 | env schema、`.env.example` | 缺必填 env 时启动失败并给出明确错误；secrets 不入库。 |
| B0-03 | 增加 `/health`、`/ready`、`/version` | B0-01 | 健康检查接口 | DB 不可用时 `/ready` 失败但 `/health` 可返回服务存活。 |
| B0-04 | 接入 PostgreSQL 客户端 | B0-02 | DB client、连接池配置 | 连接失败有超时；不在日志输出密码。 |
| B0-05 | 接入 migration 工具 | B0-04 | migrations 目录、迁移命令 | 空库可迁移；重复运行不会破坏。 |
| B0-06 | 创建基础 schema migration | B0-05 | `schema_migrations` 或工具元数据 | migration 可在 local/staging 分别执行。 |
| B0-07 | 本地 Docker Compose | B0-04 | `docker-compose.yml` for app/db/redis | 端口冲突说明清楚；数据卷可重建。 |
| B0-08 | Redis/队列客户端骨架 | B0-02 | redis client、queue abstraction | Redis 不可用时服务能明确报 ready fail。 |
| B0-09 | 标准错误响应格式 | B0-01 | error middleware/filter | 400/401/403/404/409/500 格式一致，不泄露 stack。 |
| B0-10 | 请求日志中间件 | B0-01 | request id、method、path、latency | 不记录完整 body；敏感 header 脱敏。 |
| B0-11 | OpenAPI 生成或维护机制 | B0-01 | `/openapi.json` 或文档生成脚本 | CI 可校验 OpenAPI 格式。 |
| B0-12 | 单元测试框架接入 | B0-01 | test runner、示例测试 | `test` 命令可稳定运行。 |
| B0-13 | CI 基础流水线 | B0-12 | lint/test/build workflow | 任一步失败阻止合并。 |
| B0-14 | staging 部署最小服务 | B0-03 | staging URL、部署脚本 | `/health`、`/version` 可访问；部署可回滚镜像。 |

## B1：鉴权、RBAC、审计底座

| ID | 单次任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| B1-01 | 创建 `users` migration | B0-05 | 用户表 | email 唯一；软删除或状态字段明确。 |
| B1-02 | 创建 `admin_users` migration | B1-01 | 后台用户表 | 与普通用户身份分离。 |
| B1-03 | 密码 hash 工具 | B1-01 | hash/verify 工具和测试 | 使用强 hash；测试错误密码失败。 |
| B1-04 | 用户注册 API | B1-03 | `POST /auth/register` | 重复 email 返回 409；输入校验完整。 |
| B1-05 | 用户登录 API | B1-03 | `POST /auth/login` | 错误账号不暴露是否存在；限流预留。 |
| B1-06 | token/session 表和刷新机制 | B1-05 | sessions 表、refresh API | refresh token 可吊销；过期 token 失败。 |
| B1-07 | 用户鉴权中间件 | B1-06 | `requireUser` | 未登录 401；过期 401；非法 token 401。 |
| B1-08 | `/me` API | B1-07 | 当前用户接口 | 不返回敏感字段和 token。 |
| B1-09 | 后台登录 API | B1-02 | `POST /admin/auth/login` | 后台账号和普通账号不能互用。 |
| B1-10 | RBAC 表 migration | B1-09 | roles、permissions、role_permissions | 权限点可 seed；唯一约束完整。 |
| B1-11 | RBAC 中间件 | B1-10 | `requirePermission` | 无权限 403；管理员权限可覆盖。 |
| B1-12 | `/admin/me` API | B1-11 | 当前后台用户权限接口 | 返回权限列表，不返回 password hash。 |
| B1-13 | audit log migration | B1-11 | `audit_logs` 表 | 支持 actor/resource/action/time 索引。 |
| B1-14 | audit writer 工具 | B1-13 | `writeAuditLog()` | 写失败不吞掉高风险错误；敏感字段脱敏。 |
| B1-15 | 后台权限 seed | B1-10 | 采购/仓库/客服/运营/财务/风控/管理员角色 | seed 幂等；重复执行不重复插入。 |
| B1-16 | 权限回归测试 | B1-07/B1-11 | auth/RBAC 测试套件 | 401、403、普通用户越权、后台越权都覆盖。 |

## B2：客户端核心链路 API

| ID | 单次任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| B2-01 | `saved_links` migration | B1-07 | saved links 表 | `user_id` 索引；url 长度和状态枚举。 |
| B2-02 | 保存链接 API | B2-01 | `POST /links` | 空 URL 400；重复链接可返回已存在；只归属当前用户。 |
| B2-03 | 链接平台识别工具 | B2-02 | Taobao/1688/Weidian/Yupoo/Other 识别 | 非法 URL 返回明确错误。 |
| B2-04 | 链接解析任务队列接口 | B0-08/B2-02 | `POST /links/:id/parse` | 异步失败不丢链接；状态进入 failed/needs_details。 |
| B2-05 | 人工补充链接信息 API | B2-01 | `PATCH /links/:id` | 只能修改自己的链接；价格/数量校验。 |
| B2-06 | `haul_items` migration | B2-01 | haul items 表 | 状态枚举和 `user_id` 约束。 |
| B2-07 | 加入 My Haul API | B2-06 | `POST /links/:id/add-to-haul` | 缺 title/spec/price/quantity 400；防重复加入。 |
| B2-08 | My Haul 列表 API | B2-06 | `GET /haul-items` | 只返回当前用户；支持状态筛选。 |
| B2-09 | `purchase_orders` migration | B2-06 | 订单表 | item/order/user 关联完整。 |
| B2-10 | 提交采购订单 API | B2-09 | `POST /purchase-orders` | 只能提交自己的 waiting item；幂等防重复。 |
| B2-11 | 订单列表/详情 API | B2-09 | `GET /orders`、`GET /orders/:id` | 他人订单 404/403；不返回内部备注。 |
| B2-12 | 订单状态历史表 | B2-09 | `order_status_history` | 每次状态变化可追溯。 |
| B2-13 | Trust Center policy migration | B1-11 | `policy_pages` | policy_type 唯一；draft/published 状态。 |
| B2-14 | Trust Center API | B2-13 | `GET /policies` | 只返回 published；CMS 为空有安全兜底。 |
| B2-15 | 前端 API adapter 替换 localStorage 链路 | B2-02 到 B2-14 | client 调 API | API 失败显示 loading/error/重试，不回退假数据。 |

## B3：仓库、QC、文件存储与 90 天仓储

| ID | 单次任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| B3-01 | 对象存储客户端封装 | B0-02 | storage adapter | 上传失败有错误；bucket/key 不写死生产值。 |
| B3-02 | 私有文件签名 URL 工具 | B3-01 | signed URL helper | 过期时间可配置；不能公开 bucket。 |
| B3-03 | `warehouse_items` migration | B2-09 | 仓库 item 表 | 关联 order/item/user；入库时间字段。 |
| B3-04 | 后台入库 API | B3-03/B1-11 | `POST /admin/warehouse/items/:id/receive` | 仅仓库/管理员；重复入库幂等。 |
| B3-05 | 更新重量 API | B3-03 | `PATCH /admin/warehouse/items/:id/weight` | 重量必须 >0；写 audit。 |
| B3-06 | `qc_photos` migration | B3-01 | QC 图片表 | 每张图有 owner、item、storage key。 |
| B3-07 | 后台上传 QC 图片 API | B3-06 | `POST /admin/qc/items/:id/photos` | 限 3-5 张或业务配置；图片类型/大小校验。 |
| B3-08 | 用户 QC 列表 API | B3-06 | `GET /qc/items` | 只返回当前用户 QC；签名 URL 短有效期。 |
| B3-09 | QC approve API | B3-06 | `POST /qc/items/:id/approve` | 无图不可 approve；状态同步 ready_to_ship 前需重量。 |
| B3-10 | extra photo 请求 API | B3-06 | `POST /qc/items/:id/extra-photo` | 防重复请求；生成客服/仓库任务。 |
| B3-11 | 90 天免费仓储计算 | B3-03 | storage deadline service | 按入库时间计算；时区一致。 |
| B3-12 | 仓储状态 API | B3-11 | 返回 free_until、days_left | 空入库时间不计算假期限。 |
| B3-13 | QC/仓储前端接 API | B3-08 到 B3-12 | QC 页面真实数据 | 无图/加载失败/越权状态正确。 |

## B4：包裹、物流、运费与支付

| ID | 单次任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| B4-01 | `shipping_lines` migration | B3 | 线路表 | 国家、状态、限制、计费规则字段。 |
| B4-02 | shipping line seed/import | B4-01 | 线路 seed/import 脚本 | 幂等；支持 150+ 线路批量导入。 |
| B4-03 | `parcels` migration | B3 | 包裹表 | 状态枚举；user_id、address_id 预留。 |
| B4-04 | `parcel_items` migration | B4-03 | 包裹商品表 | 同一 item 不可同时在多个待支付 parcel。 |
| B4-05 | 创建包裹草稿 API | B4-03/B4-04 | `POST /parcels/draft` | 只允许 ready_to_ship；防重复。 |
| B4-06 | 运费预览服务 | B4-01 | quote calculator | 实重/体积重/线路限制异常可解释。 |
| B4-07 | Shipping Preview API | B4-06 | `POST /shipping/preview` | 返回可用/不可用线路及原因。 |
| B4-08 | 提交包裹 API | B4-05/B4-07 | `POST /parcels` | quote 过期需重算；地址缺失 400。 |
| B4-09 | `shipping_payments` migration | B4-08 | 运费支付表 | payment intent/status/amount 记录。 |
| B4-10 | 创建运费支付 API | B4-09 | `POST /shipping-payments` | 金额以后端 final_fee 为准；幂等 key。 |
| B4-11 | 支付 webhook 处理 | B4-10 | webhook endpoint | 验签；重复 webhook 幂等。 |
| B4-12 | tracking 表 migration | B4-08 | `tracking_events` | parcel/status/time/location。 |
| B4-13 | tracking 查询 API | B4-12 | `GET /parcels/:id/tracking` | 无 tracking 返回 pending，不造假单号。 |
| B4-14 | 后台发货状态 API | B4-12/B1-14 | `PATCH /admin/parcels/:id/status` | 写 audit；状态流转合法。 |
| B4-15 | 前端 Shipping 接真实 API | B4-07 到 B4-13 | Shipping 页面替换本地状态 | 支付失败、quote 过期、线路不可用都可处理。 |

## B5：Wallet、Coupon、Welcome Gift 与财务规则

| ID | 单次任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| B5-01 | `wallets` migration | B1 | 用户钱包表 | 每个用户唯一 wallet。 |
| B5-02 | `wallet_transactions` migration | B5-01 | 钱包流水 | amount 正负、reason、source。 |
| B5-03 | wallet 查询 API | B5-02 | `GET /wallet` | 只返回当前用户；余额不能为 NaN。 |
| B5-04 | `coupons` migration | B5-01 | coupon 定义表 | code 唯一；状态和有效期。 |
| B5-05 | `user_coupons` migration | B5-04 | 用户 coupon 表 | user/coupon 唯一。 |
| B5-06 | 输入 code API | B5-05 | `POST /coupons/redeem-code` | 过期/无效/重复返回明确原因。 |
| B5-07 | Welcome Gift API | B5-05 | `POST /welcome-gift/claim` | 每用户只领一次；可配置开关。 |
| B5-08 | coupon eligibility 服务 | B5-05/B4 | 适用范围判断 | 线路不适用、最低金额、不叠加都有原因。 |
| B5-09 | apply coupon API | B5-08 | `POST /checkout/apply-coupon` | 只做锁定/预占；支付失败可回滚。 |
| B5-10 | 支付失败回滚任务 | B5-09/B4-11 | rollback job | webhook 重复不重复回滚。 |
| B5-11 | 后台发券 API | B5-04/B1-14 | `POST /admin/coupons` | 运营/财务权限；写 audit。 |
| B5-12 | 后台调整 credit API | B5-02/B1-14 | `PATCH /admin/wallets/:userId/credit` | 财务权限；必须 reason；写 audit。 |
| B5-13 | 前端 Wallet 接真实 API | B5-03 到 B5-09 | Wallet 页面替换本地状态 | 不可用原因展示；支付失败回滚可见。 |

## B6：Admin Console API

| ID | 单次任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| B6-01 | Admin overview API | B1/B2/B3/B4 | `GET /admin/overview` | 按权限返回可见统计。 |
| B6-02 | 后台订单队列 API | B2/B1 | `GET /admin/orders` | 采购/客服可见；分页和筛选。 |
| B6-03 | 后台订单状态变更 API | B2/B1-14 | `PATCH /admin/orders/:id/status` | 状态合法；写 history 和 audit。 |
| B6-04 | 后台订单异常 API | B2/B1-14 | `PATCH /admin/orders/:id/exception` | 异常原因必填；可触发 risk case。 |
| B6-05 | 后台仓库队列 API | B3/B1 | `GET /admin/warehouse/items` | 仓库权限；分页。 |
| B6-06 | 后台包裹队列 API | B4/B1 | `GET /admin/parcels` | 物流/客服权限；不暴露支付敏感信息给无权限角色。 |
| B6-07 | Policy CMS 列表 API | B2-13/B1 | `GET /admin/policies` | 运营权限；draft/published 都可见。 |
| B6-08 | Policy CMS 更新 API | B2-13/B1-14 | `PATCH /admin/policies/:id` | 版本号递增；写 audit。 |
| B6-09 | Admin 前端接 API | B6-01 到 B6-08 | admin.html 替换 localStorage | 无权限按钮禁用或隐藏；错误提示清楚。 |
| B6-10 | Admin API 权限回归 | B6 全部 | 测试套件 | 各角色能/不能做什么都有覆盖。 |

## B7：风控、内容审核、Creator 与平台化能力

| ID | 单次任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| B7-01 | creators/campaigns migration | B1/B5 | creator、campaign 表 | code 唯一；状态枚举。 |
| B7-02 | creator attribution 表 | B7-01 | attribution 表 | session/user/order 关联可为空处理。 |
| B7-03 | 记录 creator touch API | B7-02 | `POST /creator-campaign/touch` | 不记录敏感信息；幂等。 |
| B7-04 | creator dashboard API | B7-02/B1 | `GET /creator/dashboard` | 只返回汇总/脱敏数据。 |
| B7-05 | creator dashboard 前端 | B7-04 | dashboard 页面/组件 | creator 不能看到用户地址、订单明细、QC。 |
| B7-06 | `haul_stories` migration | B4/B6 | story 表 | privacy_level、review_status。 |
| B7-07 | 创建 Haul Story API | B7-06 | `POST /haul-stories` | 默认 private/unlisted；敏感字段白名单。 |
| B7-08 | 内容审核队列 API | B7-06/B1 | `GET /admin/content-review` | 审核权限；分页。 |
| B7-09 | 内容审核动作 API | B7-08/B1-14 | approve/reject/hide | 写 audit；用户可撤销。 |
| B7-10 | `risk_cases` migration | B1 | 风险 case 表 | risk_type/status/owner。 |
| B7-11 | 创建/更新 risk case API | B7-10/B1-14 | risk console API | 状态流转合法；写 audit。 |
| B7-12 | coupon abuse 规则任务 | B5/B7-10 | 风控 job | 阈值可配置；误伤可关闭。 |
| B7-13 | Country Shipping Hub migration | B4 | country rules 表 | country/line/version/published。 |
| B7-14 | Country Shipping Hub API | B7-13 | public country shipping API | 只返回 published；过期内容标记。 |
| B7-15 | Admin Risk/Content 前端接 API | B7-08/B7-11 | 后台风控和审核真实接口 | 权限、空状态、失败状态正确。 |

## B8：生产部署、迁移与稳定性

| ID | 单次任务 | 依赖 | 交付物 | 鲁棒性验收 |
| --- | --- | --- | --- | --- |
| B8-01 | production env 配置清单 | B0-B7 | env checklist | 缺项无法部署；secrets 不入库。 |
| B8-02 | 数据库备份策略 | B0/B4/B5 | backup job 和恢复文档 | 可恢复演练；备份加密。 |
| B8-03 | migration dry run 流程 | B0-05 | staging dry run checklist | 破坏性 migration 禁止直接上线。 |
| B8-04 | API base URL 切换 | B2/B6 | 前端环境配置 | staging/prod 可分离；回滚容易。 |
| B8-05 | production smoke test 脚本 | B2-B6 | smoke test checklist/script | login/link/order/qc/shipping/wallet/admin 都覆盖。 |
| B8-06 | 监控和告警 | B0/B4/B5 | error rate、latency、payment、queue alerts | 支付/webhook/队列失败有告警。 |
| B8-07 | 灰度开关 | B2-B6 | feature flags | 可关闭支付、shipping line、coupon、creator。 |
| B8-08 | 回滚 runbook | B8-01 | 回滚文档 | 前端、API、DB、支付、物流分别有策略。 |
| B8-09 | 安全回归清单 | B1-B7 | P0 security checklist | 越权、敏感字段、导出、日志全部复测。 |
| B8-10 | 生产发布复盘模板 | B8 全部 | release report template | 上线后错误、指标、遗留问题可记录。 |

## 每个任务的执行模板

复制下面模板给开发/Agent 即可：

```md
任务 ID：
任务名称：
目标：
依赖：
允许修改范围：
不允许修改：
输入/字段/API：
实现要求：
鲁棒性要求：
测试要求：
验收命令：
回滚方式：
完成后更新文档：
```

## 推荐第一批执行顺序

第一批建议只做后端底座，不碰业务：

1. B0-01 初始化 `/backend` 工程骨架
2. B0-02 配置环境变量加载器
3. B0-03 增加 `/health`、`/ready`、`/version`
4. B0-04 接入 PostgreSQL 客户端
5. B0-05 接入 migration 工具
6. B0-09 标准错误响应格式
7. B0-10 请求日志中间件
8. B0-12 单元测试框架接入
9. B0-13 CI 基础流水线

第二批再做鉴权和权限：

1. B1-01 创建 `users` migration
2. B1-02 创建 `admin_users` migration
3. B1-03 密码 hash 工具
4. B1-04 用户注册 API
5. B1-05 用户登录 API
6. B1-06 token/session 表和刷新机制
7. B1-07 用户鉴权中间件
8. B1-10 RBAC 表 migration
9. B1-11 RBAC 中间件
10. B1-13 audit log migration
11. B1-14 audit writer 工具

## 不能合并执行的任务

这些任务必须拆开做，不能为了省事放在同一次 run：

| 不要合并 | 原因 |
| --- | --- |
| Auth + Order API | 权限问题会掩盖业务 bug。 |
| QC 图片上传 + 对象存储权限 + 前端展示 | 文件访问安全必须单独验证。 |
| Shipping Preview + Payment webhook | 金额和支付状态风险高，必须分步。 |
| Coupon eligibility + Payment rollback | 优惠计算和财务回滚要分别测试。 |
| Admin RBAC + Admin 页面 | 先验证 API 权限，再接 UI。 |
| Risk Console + Audit Log | audit 是底座，不应依赖风险模块才出现。 |
| Production migration + feature launch | migration 先 dry run，再灰度功能。 |

## 单任务鲁棒性检查清单

每个任务完成后回答这些问题：

- 空输入会怎样？
- 重复请求会怎样？
- 资源不存在会怎样？
- 访问他人资源会怎样？
- 无权限后台角色会怎样？
- 外部服务超时会怎样？
- 状态重复推进会怎样？
- 日志里有没有敏感信息？
- 是否有测试覆盖成功和失败路径？
- 是否有回滚或关闭方式？

