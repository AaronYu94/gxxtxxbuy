# 09 Trust Center / Community 执行单

> 目标：让用户在下单、QC、发货、退款等关键节点能找到统一规则，同时用社群轻入口承接 first haul 帮助，但不把官网变成官方 finds 货架。

## Trust Center 页面目标

- 解释费用、QC、发货、退款、仓储、隐私规则。
- 明确 creator / community 内容是第三方分享，平台不做商品背书。
- 让客服、运营和用户引用同一版本规则。
- 无需登录即可访问主要规则。

## Trust Center 信息架构

| 分区 | 内容 | P1 要求 |
| --- | --- | --- |
| Fees | item price、domestic shipping、service fee、estimated/final shipping | P0 |
| QC | QC 图片用途、能做什么、不能保证什么 | P0 |
| Shipping | 线路、重量、体积重、时效、限制商品 | P0 |
| Refund | 缺货、改价、退换、不可退费用 | P0 |
| Storage | 仓储期限、延期费用、超期处理 | P1 |
| Privacy | 用户数据、权限、日志、creator 数据边界 | P0 |
| Creator disclaimer | 第三方内容免责声明 | P0 |

## 关键页面入口

| 来源页面 | 跳转规则 |
| --- | --- |
| Home | Trust Center 总入口。 |
| Link Intake | 无法解析时可跳人工下单说明。 |
| Orders | 异常订单跳退款/采购规则。 |
| QC Center | 跳 QC 规则和售后规则。 |
| Shipping | 跳 shipping、体积重、费用规则。 |
| Wallet | 跳 coupon / credit 规则。 |
| Support | 客服可引用对应锚点。 |

## Creator / Community disclaimer

建议核心意思：

```text
Creators and community members may share item links or haul ideas.
GOATEDBUY does not officially recommend, verify, or endorse third-party items.
You choose the items. We help with purchasing, warehouse handling, QC photos, shipping, and support.
```

## Community 轻入口

| 入口 | 文案方向 | P1 要求 |
| --- | --- | --- |
| Join Discord | first haul help、QC help、shipping questions | 可点击，链接有效。 |
| Visit Reddit | haul reviews、community discussion | 可点击，链接有效。 |
| First Haul Help | 新手引导，可先静态页面 | P1 可轻量。 |
| Creator code | 如有则保留归因 | 不展示用户敏感数据。 |

## CMS / 静态兜底

| 场景 | 处理 |
| --- | --- |
| CMS 可用 | 从后台配置读取规则内容。 |
| CMS 不可用 | 使用静态已确认规则。 |
| 单个规则缺失 | 隐藏该锚点或展示 `Policy content is being updated.` |
| 链接失效 | 展示 fallback，不让用户进入 404。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `trust_policy_view` | 查看规则 | `policy_type`、`entry_page` |
| `trust_anchor_click` | 点击规则锚点 | `policy_type`、`entry_page` |
| `community_click` | 点击社群入口 | `channel`、`entry_page` |
| `creator_disclaimer_view` | 免责声明曝光 | `entry_page`、`creator_code` |

## 验收标准

- 首页和关键页面能进入 Trust Center。
- 主要规则无需登录可访问。
- creator / community disclaimer 可见。
- 页面明确平台不做官方商品背书。
- 社群入口链接有效。
- CMS 失败时有静态兜底。

