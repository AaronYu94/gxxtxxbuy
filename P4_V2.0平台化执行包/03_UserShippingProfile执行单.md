# 03 User Shipping Profile 执行单

> 目标：沉淀用户常用国家、线路、地址偏好和包裹偏好，让复购发货更快、更清楚。

## 页面目标

- 记录用户常用目的国家和线路。
- 保存地址偏好和包裹偏好。
- 在 Shipping Preview 中预填或推荐常用设置。
- 不承诺最优线路或固定费用。

## Profile 结构

| 区域 | 内容 |
| --- | --- |
| Destination | 常用国家/地区。 |
| Address preferences | 默认地址、地址摘要、地址完整性。 |
| Line preferences | 常用 shipping line、禁用线路、偏好时效/价格。 |
| Parcel preferences | 包装加固、保险、合箱偏好、敏感物品提醒。 |
| Notification preferences | shipping 更新、tracking 更新、费用确认提醒。 |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `shipping_profile_id` | profile 标识。 |
| `user_id` | 用户归属。 |
| `default_country` | 默认国家。 |
| `default_address_id` | 默认地址。 |
| `preferred_lines` | 偏好线路。 |
| `blocked_lines` | 不想使用线路。 |
| `price_speed_preference` | 价格优先 / 速度优先 / 平衡。 |
| `packaging_preference` | 包装偏好。 |
| `insurance_preference` | 保险偏好。 |
| `notification_preference` | 通知偏好。 |
| `updated_at` | 更新时间。 |

## Shipping Preview 接入

| 场景 | 行为 |
| --- | --- |
| 用户有默认国家 | Shipping Preview 默认选中。 |
| 用户有偏好线路 | 线路排序靠前，但不保证可用。 |
| 线路不可用 | 展示不可用原因，不强行推荐。 |
| 地址缺失 | 提示补全地址。 |
| 偏好过期 | 提醒用户确认。 |

## 隐私要求

- 地址详情仅用户本人可见。
- profile 不对 creator 开放。
- 埋点和看板只使用国家、线路等非敏感维度。
- 导出地址偏好必须受后台权限控制。

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `shipping_profile_view` | 查看 profile | `has_default_country`、`preferred_line_count` |
| `shipping_profile_update` | 更新 profile | `updated_field`、`country` |
| `shipping_profile_apply` | Shipping Preview 应用 profile | `country`、`preferred_line_used` |

## 验收标准

- 用户可设置和编辑 shipping profile。
- Shipping Preview 能读取 profile 但仍校验线路可用性。
- 不向 creator 暴露用户 profile。
- 地址和敏感字段权限安全。

