# 07 Shareable Haul Recap 执行单

> 目标：允许用户自愿生成可分享的 haul recap，用于社群传播和复购激励，同时默认保护隐私和敏感数据。

## 页面目标

- 用户可以选择是否生成 recap。
- recap 展示 haul 概览、商品类型、发货国家、线路、非敏感费用摘要。
- 默认隐藏地址、订单号、支付信息、tracking、用户真实身份。
- 支持内容审核和下架。

## 生成流程

```text
Open completed haul
-> Click create recap
-> Choose what to include
-> Privacy preview
-> Generate share link
-> Optional share to community
```

## 可包含内容

| 内容 | 默认 | 说明 |
| --- | --- | --- |
| haul title | 开启 | 用户可编辑。 |
| item count | 开启 | 只展示数量。 |
| item categories | 开启 | streetwear、sneakers、gym wear 等。 |
| destination country | 开启 | 只展示国家，不展示地址。 |
| shipping line | 可选 | 不展示 tracking。 |
| delivery window | 可选 | 展示实际耗时区间。 |
| QC thumbnails | 关闭 | 用户确认后才可展示，需脱敏。 |
| savings summary | 可选 | 只展示真实 savings。 |
| creator code | 可选 | 用户同意才展示。 |

## 禁止包含

- 完整姓名、地址、电话。
- 订单号、parcel ID、tracking number。
- 支付信息。
- 后台备注。
- 未经用户选择的 QC 图片。
- 平台对商品真伪、品牌或购买价值的背书。

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `recap_id` | recap 标识。 |
| `haul_id` | 关联 haul。 |
| `user_id` | 创建者。 |
| `privacy_level` | private / unlisted / public。 |
| `included_fields` | 用户选择展示内容。 |
| `share_url` | 分享链接。 |
| `review_status` | pending / approved / rejected / hidden。 |
| `created_at` | 创建时间。 |
| `expires_at` | 可选过期时间。 |

## 隐私预览

| 检查项 | 要求 |
| --- | --- |
| 地址 | 不显示完整地址。 |
| tracking | 不显示。 |
| 订单号 | 不显示。 |
| QC 图片 | 默认关闭，用户选择后需确认。 |
| 用户身份 | 默认匿名或昵称。 |
| 删除入口 | 用户可撤销分享。 |

## 内容审核

| 场景 | 处理 |
| --- | --- |
| 违规商品/敏感内容 | 审核隐藏或拒绝发布。 |
| 地址/电话泄露 | 自动拦截或提示修改。 |
| 商品背书文案 | 提醒删除。 |
| 用户举报 | 下架并进入复核。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `haul_recap_create_start` | 开始创建 | `haul_id`、`haul_status` |
| `haul_recap_preview` | 查看隐私预览 | `included_field_count` |
| `haul_recap_publish` | 发布 recap | `privacy_level`、`review_status` |
| `haul_recap_share_click` | 点击分享 | `channel`、`recap_id` |
| `haul_recap_revoke` | 撤销分享 | `recap_id` |

## 验收标准

- recap 必须由用户主动生成。
- 默认不展示敏感信息。
- 用户可预览和撤销。
- 分享页有举报/下架机制。
- recap 不做官方商品背书。

