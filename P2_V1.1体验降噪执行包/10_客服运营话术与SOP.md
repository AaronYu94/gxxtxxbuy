# 10 客服运营话术与 SOP

> 目标：让客服、社群运营、页面文案和 Trust Center 规则使用同一套口径，减少反复解释和不一致承诺。

## SOP 原则

- 先引用页面/规则链接，再补充人工解释。
- 不承诺无法保证的运费、时效、退款日期。
- 不判断商品真伪、品牌或购买价值。
- 不要求用户重复提供已有订单信息，能从系统读取则读取。
- 涉及退款、支付、地址、订单敏感信息时转私聊或工单。

## 高频问题话术

| 问题 | 建议回复 |
| --- | --- |
| 第一次怎么下单？ | `Start with an item link. Paste it on GOATEDBUY, then follow My Haul -> Orders -> QC -> Shipping. Here is the First Haul Guide: [link]` |
| 为什么还要付国际运费？ | `Item payment and international shipping are separate. Shipping is confirmed after the item arrives, is weighed, and is packed.` |
| QC 是鉴定吗？ | `QC photos help you review the item before shipping. They are not an authenticity guarantee or product endorsement.` |
| 为什么运费变了？ | `Estimated shipping can change after final packing, actual weight, volumetric weight, and carrier confirmation.` |
| coupon 为什么不能用？ | `This coupon may be expired, already used, not eligible for this line, or not stackable. Please check the coupon reason shown at checkout.` |
| 缺货怎么办？ | `If the seller is out of stock, you can request a refund, choose another option if available, or contact support.` |
| 退款多久到？ | `Refund time depends on the payment method, seller handling, and order status. Please check the Refund Timeline for the current status.` |

## 工单分类

| 分类 | 使用场景 | 必填字段 |
| --- | --- | --- |
| first_haul_help | 新手不会下单 | user_id、entry_page |
| link_parse_issue | 链接解析失败 | url_domain、source_platform、fail_reason |
| order_exception | 缺货、改价、采购失败 | order_id、exception_type |
| qc_request | 补拍、退换、QC 疑问 | item_id、qc_status、photo_count |
| shipping_question | 运费、线路、体积重、tracking | parcel_id、line、country |
| coupon_issue | coupon 不可用、回滚 | coupon_id、reason、payment_status |
| refund_question | 退款状态和金额 | refund_id、order_id、refund_status |

## 升级规则

| 场景 | 升级对象 |
| --- | --- |
| 支付金额异常 | 财务 / 后端 |
| 用户数据越权或泄露 | 安全 / 后端，立即 P0 处理 |
| 退款金额争议 | 财务 / 客服主管 |
| 仓库 QC 图片缺失 | 仓库 / 后端 |
| 物流丢件或长期无更新 | 物流 / 客服主管 |
| creator 违规承诺 | 运营 / 法务 |

## 客服禁止承诺

- 保证商品真伪。
- 保证某商品值得购买。
- 保证最终国际运费等于 estimate。
- 保证具体到达日期。
- 保证卖家同意退换。
- 私下承诺平台未确认的 coupon 或退款。

## 运营维护

| 项目 | 频率 | Owner |
| --- | --- | --- |
| 高频问题复盘 | 每周 | 客服 / 产品 |
| Trust Center 内容更新 | 按需 | 产品 / 运营 / 法务 |
| Shipping FAQ 更新 | 每周或线路变化时 | 物流 / 运营 |
| coupon 规则更新 | 活动上线前 | 运营 / 财务 |
| creator 话术检查 | 活动上线前 | 增长 / 法务 |

## 验收标准

- 客服话术和页面文案一致。
- 每类工单有分类和必填字段。
- 高风险场景有升级规则。
- 禁止承诺明确。
- 社群运营使用同一套链接和免责声明。

