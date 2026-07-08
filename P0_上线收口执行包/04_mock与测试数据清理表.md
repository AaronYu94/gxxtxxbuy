# 04 mock 与测试数据清理表

> 用途：确保生产环境不出现假商品、测试订单、测试 QC、测试账号、测试 coupon 或写死数据。

## 清理原则

- 生产页面不得展示 mock 商品、假订单、假 QC 图片、假 coupon。
- 前端不得写死订单状态、价格、运费、QC ready、tracking number。
- 没有真实数据时展示空状态、引导动作或保守说明。
- 演示数据只能存在于 dev/staging 环境，并且必须有明显环境隔离。

## 前端 mock 检查

| 编号 | 检查位置 | 风险 | Go 标准 | 结果 |
| --- | --- | --- | --- | --- |
| MOCK-001 | Home | 假 creator、假社群数字、假推荐商品 | 不展示官方推荐商品和虚假社群数据 | 待测 |
| MOCK-002 | Link Intake | 假解析结果、假商品图、假价格 | 解析失败时进入人工补充，不展示假结果 | 待测 |
| MOCK-003 | My Haul | 假 haul item、假状态 | 空数据展示 empty state | 待测 |
| MOCK-004 | Orders | 假订单、写死状态 | 所有订单来自真实接口 | 待测 |
| MOCK-005 | QC Center | 假 QC 图片、写死 QC ready | 无图片不展示 QC ready | 待测 |
| MOCK-006 | Shipping | 假运费、假线路、假 tracking | 线路和费用来自真实接口或配置 | 待测 |
| MOCK-007 | Wallet | 假 coupon、假 credit balance | coupon/credit 来自真实 wallet 接口 | 待测 |
| MOCK-008 | Trust Center | 临时 lorem ipsum 或未确认规则 | 使用已确认规则或保守占位说明 | 待测 |

## 后端测试数据检查

| 编号 | 检查对象 | 风险 | Go 标准 | 结果 |
| --- | --- | --- | --- | --- |
| DATA-001 | 测试账号 | 测试账号可登录生产 | 禁用或删除测试账号 | 待测 |
| DATA-002 | 测试订单 | 假订单出现在真实用户列表 | 生产用户不可见测试订单 | 待测 |
| DATA-003 | 测试地址 | 假地址被用户看到或导出 | 删除或隔离 | 待测 |
| DATA-004 | 测试 QC 图片 | 假图片出现在 QC Center | 删除或隔离 | 待测 |
| DATA-005 | 测试 coupon | 测试 coupon 可被用户使用 | 禁用或删除 | 待测 |
| DATA-006 | 测试 creator code | 测试 code 可归因生产订单 | 禁用或删除 | 待测 |
| DATA-007 | 测试物流单号 | 假 tracking 可见 | 删除或隔离 | 待测 |
| DATA-008 | 后台测试配置 | 测试文案、测试链接、测试开关 | 生产配置全量 review | 待测 |

## 代码搜索建议

上线前建议在代码仓库中搜索以下关键词：

```text
mock
demo
dummy
fake
test
sample
placeholder
lorem
TODO
FIXME
hardcode
qc_demo
tracking_demo
coupon_test
```

## 空状态要求

| 页面 | 无数据时展示 | 禁止展示 |
| --- | --- | --- |
| My Haul | `Your haul is empty. Paste an item link to start.` | 假商品列表 |
| Orders | `No orders yet.` + Start Haul CTA | 假订单 |
| QC Center | `No QC photos ready yet.` | 假 QC 图片 |
| Shipping | `No items ready to ship yet.` | 假线路、假运费 |
| Wallet | `No available coupons.` / `Credit balance: $0` | 假 coupon、假余额 |
| Trust Center | 已确认规则或 `Policy content is being updated.` | lorem ipsum |

## 清理记录

| 编号 | 问题描述 | 环境 | Owner | 处理方式 | 状态 |
| --- | --- | --- | --- | --- | --- |
| C-001 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |

## P0 No-Go 条件

- 生产用户能看到假商品、假订单、假 QC 图片、假运费、假 tracking。
- 测试账号可在生产登录并访问业务数据。
- 测试 coupon 或 creator code 可影响真实订单。
- 前端用写死状态绕过后端真实状态。
- 无数据页面展示演示数据而不是 empty state。

