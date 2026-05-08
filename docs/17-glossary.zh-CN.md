# 17 — 术语表

| 术语 | 含义 |
|---|---|
| OpenKB | 本项目。 |
| Tenant | 实例或租户。 |
| Workspace / 空间 | 团队协作边界。 |
| Knowledge Base / 知识库 | 文档集合。 |
| Document | 文档或文件夹。 |
| Milkdown | OpenKB 使用的 Markdown 富文本编辑器。 |
| Feature Registry | 当前编辑器支持能力的注册表。 |
| Collaborator | 协作者。 |
| Share Link | 只读分享链接。 |
| Invitation Link | 邀请用户成为协作者的链接。 |
| Milvus Function | Milvus 侧 TEXTEMBEDDING、BM25、RERANK 等函数能力。 |
| OpenKB Direct Embedding | 当前 v0.3.x 已实现的直连模型方案：OpenKB 从实例级 DB enabled 配置或环境变量读取 embedding endpoint/model，生成 query/chunk vector，不保存明文 provider key。 |
| OpenKB Direct Rerank | 当前 v0.3.x 已实现的直连 rerank 方案：OpenKB 在最终权限过滤后调用 rerank endpoint，不保存明文 provider key。 |
| Retrieval Mode | 检索算法模式：`bm25`、`dense`、`dense_rerank`、`hybrid`、`hybrid_rerank`。 |
| Context Mode | Phase 13 已实现的结果上下文模式：`chunk`、`parent_child`、`paragraph_parent_child`、`full_text`。 |
| Parent Chunk | Phase 13 已实现的父块，按段落或全文保存，用于回填上下文，不写入 Milvus 检索。 |
| Child Chunk | Phase 13 已实现的子块，按段落或小窗口入 Milvus，用于精确召回。 |
| Retrieval Lab | Phase 13 已实现的知识库检索测试台，用于观察切片、召回、rerank 和权限过滤结果。 |
| Active Alias | 当前检索使用的 Milvus collection alias。 |
| Access Principals | 写入 Milvus 用于权限预过滤的主体 token。 |
| MCP | Model Context Protocol，用户权限绑定的知识库服务出口。 |
| Dify Adapter | Dify External Knowledge API 接口。 |
