# 04 QC Preferences 执行单

> 目标：让用户设置 QC 关注点，帮助仓库和客服更好理解用户偏好，但不承诺真伪鉴定或商品价值判断。

## 页面目标

- 记录用户希望 QC 重点关注的内容。
- 支持常见偏好：尺码、logo、瑕疵、包装、标签、颜色。
- 在 QC Center 和仓库任务中展示偏好。
- 避免把 QC 偏好包装成鉴定服务。

## 偏好选项

| 偏好 | 说明 |
| --- | --- |
| size_tag | 关注尺码标签。 |
| logo_detail | 关注 logo 位置和细节。 |
| visible_flaws | 关注明显瑕疵。 |
| packaging | 关注包装盒/袋。 |
| color_match | 关注颜色是否和用户预期一致。 |
| extra_measurement | 请求简单测量，若仓库支持。 |
| custom_note | 用户自定义备注。 |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `qc_preference_id` | 偏好 ID。 |
| `user_id` | 用户归属。 |
| `default_preferences` | 默认偏好列表。 |
| `category_preferences` | 按品类偏好。 |
| `custom_note` | 自定义备注。 |
| `warehouse_supported` | 仓库是否支持。 |
| `updated_at` | 更新时间。 |

## 仓库侧展示

| 场景 | 展示 |
| --- | --- |
| 入库拍 QC | 展示用户偏好摘要。 |
| 补拍请求 | 带上具体关注点。 |
| 仓库不支持 | 标记 unsupported，不承诺完成。 |
| 用户自定义备注过长 | 限制长度并过滤敏感内容。 |

## 文案边界

| 允许 | 禁止 |
| --- | --- |
| `Tell us what details you care about in QC photos.` | `We verify authenticity for you.` |
| `Warehouse support may vary by item and request.` | `We guarantee every preference can be checked.` |
| `QC photos help you review visible details.` | `QC proves the item is real.` |

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `qc_preferences_view` | 查看偏好 | `preference_count` |
| `qc_preferences_update` | 更新偏好 | `preference_type`、`category` |
| `qc_preference_applied` | 仓库/QC 使用偏好 | `item_id`、`preference_type` |

## 验收标准

- 用户可设置和编辑 QC preferences。
- 仓库侧能看到支持的偏好。
- 不承诺真伪鉴定。
- 自定义备注有长度和敏感内容限制。

