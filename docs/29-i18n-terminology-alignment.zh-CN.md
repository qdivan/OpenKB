# 29 — 前端术语与翻译对齐

本文件是 OpenKB 前端中文文案的术语基线。后续新增页面时，优先按本文件取词；如果某个词属于 Dify 知识库处理/检索体系，就跟 Dify 1.14.1 的中文表达走；如果属于协作、空间、权限、分享，就跟语雀式产品逻辑走；如果是 OpenKB 特有的技术边界，则保留 OpenKB 自己的表达。

## 参考来源

- Dify 1.14.1 源码中的 `web/i18n/zh-Hans/dataset*.json`、`dataset-documents.json`、`dataset-settings.json`。
- OpenKB `AGENTS.md`、`docs/02-yuque-reference-model.zh-CN.md`、`docs/05-permission-spec.zh-CN.md`、`docs/27-dify-knowledge-alignment.zh-CN.md`。
- OpenKB 当前实现中的 `apps/web/src/lib/i18n.ts`。

Dify 源码只作为术语参考，放在仓库外临时目录，不进入 OpenKB git。

## 总体规则

| 范围 | 中文用词 | 对齐来源 | 说明 |
|---|---|---|---|
| workspace / space | 空间 | 语雀式空间概念 + OpenKB 内部 workspace | 用户可见 UI 优先写“空间”；技术文档可写 “Workspace / 空间”。 |
| knowledge base | 知识库 | Dify / 语雀 | 不写 “数据集”，除非是在解释 Dify 内部 Dataset 字段。 |
| document | 文档 | Dify / 语雀 | OpenKB 的 `page` UI 仍叫文档；目录叫 “目录”。 |
| folder | 目录 | 语雀 | 不单独叫 folder。 |
| collaborator | 协作者 | 语雀 | Workspace 用成员，KB/document 用协作者。 |
| access / permission | 访问权限 / 权限 | 语雀 | “权限边界”只用于 Admin 说明页。 |
| share link | 分享链接 | 语雀 | v0.x 只读，不写成“公开编辑链接”。 |

## Dify 知识库处理术语

| Dify / OpenKB 内部字段 | UI 中文 | 备注 |
|---|---|---|
| segment / chunk | 分段 | Dify 中文 UI 使用“分段”。OpenKB 数据库仍叫 `document_chunks`，但前端不直接显示 chunk。 |
| chunking mode | 分段模式 | 对应 Dify `chunkingMode.*`。 |
| general | 通用 | 不写 “普通文档”。 |
| parent-child | 父子 | 作为模式名；具体解释里可写父分段、子分段。 |
| qa / QA | 问答 | 标题可保留 QA；说明文案使用“问答”。 |
| automatic | 自动分段 | Dify 创建/处理流程用词。 |
| custom | 自定义分段 | Dify 创建/处理流程用词。 |
| hierarchical | 父子分段 | 对应 OpenKB hierarchical model。 |
| process rule | 处理规则 | 不写“加工规则”。 |
| text cleaning | 文本预处理规则 | 与 Dify `embedding.textCleaning` 对齐。 |
| reprocess | 重处理 | OpenKB 显式动作；区别于 Milvus 索引重建。 |
| indexing technique | 索引模式 | Dify 用 “索引模式”。 |
| economy | 经济 | 可补充 “关键词/BM25”。 |
| high_quality | 高质量 | 可补充 “Embedding/Hybrid”。 |
| retrieval setting | 检索设置 | 页面标题/区域名用“检索设置”。 |
| search method | 检索方法 | 表单字段用“检索方法”。 |
| semantic_search | 向量检索 | Dify 中文 UI 用“向量检索”。 |
| full_text_search | 全文检索 | 保持一致。 |
| hybrid_search | 混合检索 | 保持一致。 |
| keyword_search | 关键词 | Dify 中文 UI 对该 method 写“关键词”。 |
| rerank | Rerank | 专业名词保留英文，动作用“重排”。 |
| top_k | Top K | 专业参数保留。 |
| score_threshold | 分数阈值 | 保持一致。 |
| summary | 摘要 | 生成动作用“生成摘要”。 |
| summary index | 摘要索引 | 强调只影响检索派生层。 |
| metadata | 元数据 | 中文 UI 不写 “Metadata”，字段名和 API 参数可保留英文。 |
| external knowledge base | 外部知识库 | Dify 外部知识库 UI 用词。 |
| external knowledge API | 外部知识库 API | OpenKB Admin Dify 页面使用。 |

## OpenKB 特有边界

| OpenKB 术语 | 中文 | 说明 |
|---|---|---|
| PostgreSQL final permission check | PostgreSQL 权限终检 | 权限最终真相，不翻成普通“权限检查”。 |
| Milvus blue-green rebuild | Milvus blue-green 索引重建 | 强调不是普通刷新，也不是发布文档。 |
| MCP user-bound | MCP 用户绑定 | MCP token 必须绑定真实用户。 |
| Dify app-key-bound | Dify 应用密钥绑定 | Dify key 只访问授权 KB，不冒充用户。 |
| instance-level model config | 实例级模型配置 | system_admin-only。 |
| instance-level import tool config | 实例级导入工具配置 | system_admin-only。 |

## 当前已收口的前端覆盖点

- `Segment(s)`、`Chunk(s)` 的中文显示统一为“分段”。
- `Metadata` 的中文显示统一为“元数据”。
- Dify 检索方法统一为“向量检索 / 全文检索 / 混合检索 / 关键词”。
- Dify 处理与分段设置统一为“处理模式 / 分段规则 / 检索设置 / 摘要 / 重处理”。
- Dify 外部知识库相关 UI 统一为“外部知识库 / 外部知识库 API / 外部知识库 ID / API 密钥”。
- 语雀式协作相关 UI 继续使用“空间 / 知识库 / 文档 / 协作者 / 分享链接 / 邀请 / 审批”。历史页面中的“工作区”逐步替换为“空间”。

## 新增文案检查清单

新增前端文案时至少检查：

1. 是否已经存在于 `apps/web/src/lib/i18n.ts`。
2. 是否属于 Dify 知识库/检索体系；如果是，按本文件 Dify 术语表取词。
3. 是否属于语雀式协作权限；如果是，按空间、知识库、文档、协作者、分享链接取词。
4. 是否是专业名词；`Milvus`、`BM25`、`Embedding`、`Rerank`、`MCP`、`Dify`、`Top K` 保留英文。
5. 不要在中文 UI 中混用 `Segment`、`Metadata`、`Workspace`，除非是在字段名、API 参数或技术说明里明确引用。
