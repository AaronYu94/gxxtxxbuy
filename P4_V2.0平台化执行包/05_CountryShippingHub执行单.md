# 05 Country Shipping Hub 执行单

> 目标：按国家沉淀 shipping 线路、限制、费用解释、FAQ 和规则更新时间，成为用户、客服、运营可引用的国家物流中心。

## 页面目标

- 帮用户按国家理解发货选择。
- 给客服统一引用链接。
- 给运营维护线路和规则变化。
- 支持 Shipping Preview 和 Trust Center 引用。

## 页面结构

| 区域 | 内容 |
| --- | --- |
| Country selector | 国家/地区选择。 |
| Line overview | 可用线路、预计时效、tracking、限制。 |
| Cost explanation | 实重、体积重、费用区间、estimate/final。 |
| Restrictions | 敏感品类、重量上限、体积限制。 |
| FAQ | 常见问题。 |
| Updates | 规则更新时间、临时延迟、线路暂停。 |

## 字段要求

| 字段 | 用途 |
| --- | --- |
| `country_code` | 国家编码。 |
| `country_name` | 国家名称。 |
| `available_lines` | 可用线路。 |
| `delivery_window` | 预计时效范围。 |
| `weight_rule` | 重量规则。 |
| `restricted_categories` | 限制品类。 |
| `fee_rule_summary` | 费用说明。 |
| `temporary_notice` | 临时公告。 |
| `updated_at` | 规则更新时间。 |
| `published_status` | 发布状态。 |

## 维护机制

| 场景 | 处理 |
| --- | --- |
| 线路暂停 | 标记暂停并显示公告。 |
| 费用规则变化 | 更新说明和更新时间。 |
| 国家新增 | 先内部草稿，再发布。 |
| 内容过期 | 自动提醒运营复核。 |
| 客服反馈高频问题 | 加入 FAQ。 |

## 文案边界

- 不保证具体到达日期。
- 不承诺 estimated fee 等于 final fee。
- 不承诺所有商品都能走所有线路。
- 明确清关、天气、承运商延迟等不确定因素。

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `country_shipping_hub_view` | 页面访问 | `country`、`entry_page` |
| `country_line_detail_view` | 查看线路详情 | `country`、`line` |
| `country_shipping_faq_open` | 展开 FAQ | `country`、`question_id` |
| `shipping_notice_view` | 查看临时公告 | `country`、`notice_type` |

## 验收标准

- 主力国家有可发布内容。
- 线路、限制、费用说明有更新时间。
- Shipping Preview 能跳转对应国家规则。
- 客服可引用国家页链接。
- 内容过期有复核机制。

