# 16 — 项目决策和非目标

## 已定决策

1. Markdown 方言完全跟随 Milkdown。
2. 文档持久化内容是 Markdown。
3. 权限完整按语雀式产品逻辑实现。
4. v0.x 不引入 OpenFGA/Casbin/OPA/LDAP/SCIM。
5. 系统/租户 admin 可以访问后台配置，但不默认可读全库私有内容。
6. 知识库 owner 不能配置模型。
7. Embedding/Rerank 优先放 Milvus 2.6+ 原生 Functions。
8. OpenKB 不保存 embedding/rerank API key。
9. Embedding 模型更换走新 collection + rebuild + alias switch。
10. Milvus 只做索引，PostgreSQL 是权限真相。
11. MCP 必须用户权限绑定。
12. Dify 必须 API key scoped。

## 非目标

- 不做语雀表格文档和画板/思维图文档。
- 不做知识库级模型配置。
- 不做管理员默认全库检索。
- 不做复杂 IAM 产品。
- 不做未授权匿名编辑。
- 不做任意 stdio MCP command execution。

## 允许后续扩展但不进入 v0.x

- 实时协作 Y.js。
- 评论/批注。
- OIDC/SAML 登录。
- 企业组织同步。
- 复杂图表块。
- AI 写作助手。
- Qdrant/pgvector adapter。
