# V2-00-09 API 与事件约定

## 基本协议

- 新业务 API 使用 HTTPS JSON REST，统一前缀 `/api/v2`。
- 健康检查 `/health`、`/ready`、`/version` 和支付/供应商 webhook 可以保留独立路径。
- URL 使用复数资源和 kebab-case；JSON 字段使用 snake_case。
- 所有时间为 ISO 8601 UTC 秒级字符串；金额使用整数最小货币单位。
- OpenAPI 3.1 是接口契约，新增或修改路由必须同步更新并通过 CI。

## 成功响应

单资源：

```json
{
  "data": {
    "id": "uuid",
    "item_order_no": "GO-ITEM-...",
    "version": 3
  },
  "meta": {
    "request_id": "request-id"
  }
}
```

列表：

```json
{
  "data": [],
  "meta": {
    "request_id": "request-id",
    "page": 1,
    "page_size": 20,
    "total": 0,
    "has_next": false
  }
}
```

列表默认 20 条，可选 50、100，最大 100。普通页面禁止一次加载全量；大规模导出使用异步任务。

## 错误响应

```json
{
  "error": {
    "code": "STATE_CONFLICT",
    "message": "The item cannot enter QC from its current state.",
    "details": {
      "current_status": "seller_dispatched",
      "required_status": "arrived"
    },
    "request_id": "request-id"
  }
}
```

| HTTP | 使用场景 |
| --- | --- |
| 400 | 格式、字段、搜索条件或业务输入无效 |
| 401 | 未认证、会话过期或二次验证缺失 |
| 403 | 后台角色或数据范围不足 |
| 404 | 资源不存在；普通用户访问他人资源也返回 404 |
| 409 | 状态、版本、占用、重复业务或幂等冲突 |
| 422 | 格式正确但业务条件不满足，例如路线不支持限制类型 |
| 429 | 登录、验证码、解析、供应商或导出限流 |
| 502 | 上游返回无效结果 |
| 503 | 功能开关关闭或关键依赖暂不可用 |

错误 code 稳定、可供前端本地化；message 不包含 stack、SQL、token、完整地址或支付敏感数据。

## 身份、权限与数据范围

- 用户和后台员工使用分离的身份和会话。
- Bearer access token 只在 Authorization header 传输；refresh token 可轮换和吊销。
- 后台 API 同时执行 `require_role_action` 和 `apply_data_scope`。
- 高风险操作额外要求短时 `reauth_challenge_id`，服务端验证其动作、用户、资源和有效期。
- 异步任务携带 actor snapshot 和 scope，不得因离开 HTTP 请求而跳过授权。

## 写接口与状态动作

禁止通用状态写入：

`PATCH /item-orders/{id}` 不得接受任意 `status`。

使用命名动作：

- `POST /api/v2/procurement-tasks/{id}/claim`
- `POST /api/v2/item-orders/{id}/purchase-confirmations`
- `POST /api/v2/inbound-packages/scan`
- `POST /api/v2/qc-tasks/{id}/complete`
- `POST /api/v2/parcels/{id}/start-packing`
- `POST /api/v2/after-sales/{id}/purchase-approval`

每个动作定义角色、数据范围、允许前置状态、必填字段、成功状态、异常状态、幂等键和审计动作。

## 幂等

- 资金、订单创建、采购动作、扫码、状态动作、文件完成、供应商回调和异步消费者必须幂等。
- 客户端写请求使用 `Idempotency-Key`，建议 UUID v4；服务端按 actor、route、key 建唯一记录。
- 同一 key、同一请求 hash 返回原结果；同一 key 不同请求体返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 幂等记录保存首次状态码、响应安全摘要、业务资源和有效期。资金类记录不得早于法定/审计保留期删除。
- webhook 以 provider 和 provider event ID 唯一去重，同时校验业务金额和状态。

## 并发与版本

- 可变资源响应包含 `version`。
- 普通更新提交 `If-Match` 或 `expected_version`，版本不符返回 `409 VERSION_CONFLICT`。
- 钱包、库存占用、拣货、退款和审批使用数据库事务和行锁或等价原子条件。
- 数据库唯一约束是最终防线，不能只依赖先查后写。

## 查询、筛选和排序

- 精确业务编号字段使用 `*_no`，默认完整匹配。
- 时间范围使用 `created_from`、`created_to`，结束时间语义必须在 OpenAPI 说明。
- 多选状态使用重复 query 或逗号分隔中的一种并全局一致。
- 默认排序为 `updated_at desc`；任务队列可使用截止时间和优先级，但必须稳定追加 `id` 排序。
- 客服和运营用户搜索缺少明确条件时返回 `400 SEARCH_CRITERIA_REQUIRED`。

## 事件规范

内部领域事件使用统一 envelope：

```json
{
  "event_id": "uuid",
  "event_type": "warehouse.qc.completed.v1",
  "occurred_at": "2026-07-10T02:30:00Z",
  "aggregate_type": "stock_item",
  "aggregate_id": "uuid",
  "aggregate_version": 4,
  "actor": {
    "type": "admin",
    "id": "uuid",
    "role": "warehouse_operator"
  },
  "correlation_id": "request-id",
  "causation_id": "command-or-event-id",
  "payload": {}
}
```

- event type 使用 `{domain}.{subject}.{past_tense}.v{n}`。
- payload 只放消费者需要的最小字段，不放完整用户、地址、token、支付或身份原文。
- 生产事件通过数据库 outbox 与业务事务一起提交，再由 worker 投递。
- 消费者以 `event_id` 去重；处理完成记录 handler version、时间和结果。
- 失败按退避重试，超过上限进入死信；死信重放要求权限、原因和审计。
- 事件 schema 只做向后兼容新增；破坏性变更提升事件版本。

## 首批领域事件

| 事件 | 主要消费者 |
| --- | --- |
| `payment.top_up.succeeded.v1` | 钱包入账、用户通知、财务统计 |
| `order.parent.paid.v1` | 采购自动分配、订单通知 |
| `procurement.exception.created.v1` | 用户通知、24 小时任务 |
| `warehouse.inbound.arrived.v1` | QC 任务、用户通知 |
| `warehouse.qc.completed.v1` | 库存单元、五日退货起点、用户通知 |
| `warehouse.stock.expiring.v1` | 15/7/3/0 天通知 |
| `parcel.packing.completed.v1` | 国际运费计费和通知 |
| `parcel.outbound.v1` | 物流同步和用户通知 |
| `parcel.delivered.v1` | 完成状态、会员成长值、推广佣金 |
| `after_sales.merchant_refund.recorded.v1` | 财务平台退款任务 |
| `wallet.refund.posted.v1` | 业务状态完成、用户通知 |
| `identity.risk_locked.v1` | 会话限制和安全邮件 |

## 外部 webhook

- 必须验签，并校验时间窗、防重放、provider event ID、业务交易号、金额、币种和用户归属。
- 原始 payload 只保存受限安全摘要或加密归档，不进入普通日志。
- 接收接口快速落库后返回；业务处理异步执行。
- 重复、乱序、未知交易、金额不符和已终结状态均有独立结果和告警级别。

## 文件接口

- 上传前服务端签发用途受限的上传授权，限制 MIME、大小、数量、业务对象和过期时间。
- 完成上传后服务端校验实际 bytes、MIME、hash 和图片尺寸，再绑定业务对象。
- 私有下载使用短时签名 URL；列表只返回缩略图。
- 文件 key 不包含邮箱、地址、业务顺序或可猜测数据库 ID。

## 可观测与审计

每个请求和事件携带 `request_id`/`correlation_id`。日志记录路由、状态码、耗时、错误 code 和安全资源标识，不记录完整请求 body。登录、敏感查询、导出、审批、配置、状态强制、资金和文件访问按 `07_角色权限与数据范围矩阵.md` 写不可删除审计。
