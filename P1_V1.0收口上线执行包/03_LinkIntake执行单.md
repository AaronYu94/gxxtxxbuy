# 03 Link Intake 执行单

> 目标：用户粘贴商品链接后，可以解析、补充信息、登录保留，并顺利加入 My Haul。

## 核心流程

```text
Paste URL
-> URL 校验
-> 识别平台
-> 解析商品信息
-> 用户确认规格/数量
-> 加入 My Haul
```

## 支持入口

| 入口 | 说明 |
| --- | --- |
| 首页 Paste Link | P1 主入口。 |
| 用户工作台 Paste Link | 登录后主入口。 |
| creator landing / 社群链接 | 可带 creator code 或 UTM。 |

## 字段要求

| 字段 | 类型 | 来源 | P1 要求 |
| --- | --- | --- | --- |
| `url` | string | 用户输入 | 必填，基本 URL 校验。 |
| `source_platform` | string | 解析接口 | Taobao / 1688 / Weidian / Yupoo / Other。 |
| `parse_status` | enum | 解析接口 | parsing / success / failed / needs_manual_input。 |
| `title` | string | 解析接口或用户补充 | 可为空，但加入 My Haul 前需确认。 |
| `image` | url | 解析接口 | 失败时用通用占位，不用假商品图。 |
| `price` | number | 解析接口或人工确认 | 不确定时标记待确认。 |
| `spec` | object/string | 解析接口或用户选择 | 颜色、尺码、款式。 |
| `quantity` | number | 用户输入 | 默认 1，必须大于 0。 |
| `user_id` | string | 登录态 | 未登录时使用 session 暂存。 |
| `creator_code` | string | URL/UTM/cookie | 可选，需保留归因。 |

## 状态设计

| 状态 | 页面表现 | 用户动作 |
| --- | --- | --- |
| 初始 | 输入框和提交按钮 | 粘贴链接 |
| 校验失败 | 显示链接格式错误 | 修改链接 |
| 解析中 | loading，说明正在解析 | 等待或取消 |
| 解析成功 | 展示标题、图片、价格、规格、数量 | 确认并加入 My Haul |
| 解析失败 | 说明不支持或暂时失败 | 人工补充 / 联系客服 / 重试 |
| 商品下架 | 展示不可购买说明 | 换链接 / 联系客服 |
| 未登录 | 保留链接和已填信息 | 登录 / 注册 |
| 加入成功 | toast 或跳转 My Haul | 继续添加 / 查看 My Haul |

## 人工补充最小表单

| 字段 | 是否必填 | 说明 |
| --- | --- | --- |
| 商品链接 | 必填 | 原始 URL。 |
| 商品名称 | 必填 | 用户手动输入。 |
| 规格 | 必填 | 尺码、颜色、版本等。 |
| 数量 | 必填 | 默认 1。 |
| 备注 | 选填 | 特殊要求。 |
| 图片 | 选填 | 可后续补。 |

## 登录保留要求

- 未登录用户提交链接后，可以进入登录/注册。
- 登录/注册成功后，原链接、解析结果、规格和数量不能丢失。
- 如果 session 过期，需提示用户重新提交链接。

## 埋点

| 事件 | 时机 | 必填字段 |
| --- | --- | --- |
| `paste_link_submit` | 用户提交链接 | `url_domain`、`is_login`、`creator_code` |
| `link_parse_success` | 解析成功 | `source_platform`、`duration_ms` |
| `link_parse_fail` | 解析失败 | `source_platform`、`fail_reason` |
| `manual_order_start` | 用户进入人工补充 | `url_domain`、`fail_reason` |
| `haul_item_add` | 加入 My Haul 成功 | `item_source`、`user_id`、`session_id` |

## 验收标准

- 支持基础 URL 校验。
- 解析失败不会让用户卡死。
- 人工补充路径可用。
- 未登录后登录不丢链接。
- 加入 My Haul 后能在 My Haul 页面看到对应商品。
- 不展示假解析结果、假价格或假商品图。

