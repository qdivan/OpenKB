# 20 — Codex Prompts 索引

本目录已经把可复制的 prompt 放在 `prompts/` 下。

## 推荐顺序

```text
prompts/01-read-and-plan.md
prompts/02-scaffold.md
prompts/03-database-auth.md
prompts/04-permissions.md
prompts/05-editor.md
prompts/06-milvus.md
prompts/07-mcp-dify.md
```

## 使用原则

- 一次只做一个阶段。
- 不要让 Codex 跳过权限服务直接做 MCP。
- 不要让 Codex 跳过 Milkdown feature registry 直接写编辑器。
- 不要让 Codex 把 embedding/rerank API key 存进 OpenKB 数据库。
- 不要让 Codex 增加知识库级模型配置。
- 每个阶段结束后提交 git commit，再进入下一阶段。
