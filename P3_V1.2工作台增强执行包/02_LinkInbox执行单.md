# 02 Link Inbox 执行单

> 目标：用户可以先保存外部商品链接，后续再解析、补充信息、加入 My Haul，降低“一次必须立刻下单”的压力。

## 页面目标

- 保存用户从站外找到的商品链接。
- 展示解析状态和待补充信息。
- 支持从 saved link 加入 My Haul。
- 支持删除、归档、标签或来源筛选。

## 核心流程

```text
Paste link
-> Save to Link Inbox
-> Parse / needs details / failed
-> Add details if needed
-> Add to My Haul
-> Submit purchase later
```

## 页面结构

| 区域 | 内容 |
| --- | --- |
| 快速保存 | 输入链接、粘贴、保存按钮。 |
| 状态筛选 | All、Parsed、Needs details、Failed、Added to haul、Archived。 |
| 来源筛选 | TikTok、Reddit、Discord、Taobao、1688、Weidian、Yupoo、Other。 |
| 链接卡片 | 图片、标题、来源、解析状态、保存时间、creator/source。 |
| 操作 | Add to My Haul、Edit details、Retry parse、Archive、Delete。 |
| 空状态 | `Save item links here and build your next haul later.` |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `saved_link_id` | 保存链接 ID。 |
| `user_id` | 用户归属。 |
| `url` | 原始链接。 |
| `url_domain` | 埋点和展示来源。 |
| `source_platform` | 平台来源。 |
| `parse_status` | parsed / needs_details / failed / added_to_haul / archived。 |
| `title` | 商品标题。 |
| `image` | 商品图或占位图。 |
| `price` | 价格，待确认可为空。 |
| `spec` | 规格信息。 |
| `tags` | 用户标签。 |
| `creator_code` | 归因字段。 |
| `created_at` | 保存时间。 |
| `updated_at` | 更新时间。 |

## 状态设计

| 状态 | 用户含义 | 可执行动作 |
| --- | --- | --- |
| parsed | 已解析 | Add to My Haul、Edit。 |
| needs_details | 需要补充规格/价格/数量 | Edit details。 |
| failed | 解析失败 | Retry parse、Manual details。 |
| added_to_haul | 已加入 My Haul | View in My Haul。 |
| archived | 已归档 | Restore、Delete。 |

## 降级策略

| 场景 | 策略 |
| --- | --- |
| 自动解析失败 | 保存链接成功，状态为 needs details 或 failed。 |
| 商品图缺失 | 使用通用占位图，不使用假商品图。 |
| 价格为空 | 展示 `Price pending confirmation`。 |
| 标签功能未完成 | 先隐藏标签，不影响保存和加入 haul。 |
| 批量操作未完成 | 先只支持单条操作。 |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `link_save` | 保存链接 | `url_domain`、`source_platform`、`creator_code` |
| `link_inbox_view` | 查看 Link Inbox | `saved_count`、`parsed_count` |
| `saved_link_add_to_haul` | 加入 My Haul | `saved_link_id`、`parse_status` |
| `saved_link_archive` | 归档 | `saved_link_id` |
| `saved_link_delete` | 删除 | `saved_link_id` |

## 验收标准

- 用户可以保存链接，不要求立即下单。
- 解析失败不会丢链接。
- saved link 可以加入 My Haul。
- 空状态不展示假商品。
- 只能访问自己的 saved links。

