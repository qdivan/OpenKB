# 01 — 产品愿景

## 一句话定位

OpenKB 是一个 Markdown-first、语雀式权限和编辑体验、支持私有化部署的开源知识库系统，同时可以作为 Dify 第三方知识库和用户权限绑定的 MCP Server。

## 目标用户

- 想自托管知识库的团队。
- 想把内部知识库接入 AI/RAG 的团队。
- 想把文档系统通过 MCP 暴露给 IDE、Agent、企业系统的团队。
- 想把所有文件统一转换为 Markdown 管理的用户。

## 核心能力

```text
文档编辑：Milkdown 富文本式 Markdown 编辑器。
知识管理：空间、知识库、目录、文档、版本。
权限：语雀式协作者、邀请、分享、审批、密码访问、成员可见。
导入：PDF/DOCX/PPTX/XLSX/图片 -> Markdown + assets。
检索：Milvus 原生 Function + dense/sparse/hybrid/rerank。
集成：MCP Server、Dify External Knowledge API。
部署：Docker Compose、K8s/Helm。
```

## 非目标

- 不做 Notion 式数据库。
- 不做语雀的表格文档和画板/思维图文档，v0.x 只做富文本文档。
- 不做 LDAP/SCIM/OpenFGA/Casbin/OPA 权限系统。
- 不做知识库级模型配置。
- 不允许 MCP 或 Dify 绕过文档权限。

## 内容真相

OpenKB 的长期内容真相是 Markdown。Milkdown/ProseMirror state 只是编辑器运行时状态，除非作为草稿快照单独保存。

```text
Markdown + metadata + assets + versions = content truth
```
