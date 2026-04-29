# 19 — 如何和 Codex 启动这个项目

## 0. 准备仓库

把本包解压到新仓库根目录：

```bash
mkdir openkb
cd openkb
# 解压 openkb-codex-bootstrap-v0.3.3.zip 到这里
git init
```

确认根目录有：

```text
AGENTS.md
README.md
OPENKB_MASTER_SPEC.md
docs/
prompts/
apps/
packages/
workers/
deploy/
```

## 1. 第一轮：只读文档，不写代码

先把 `prompts/01-read-and-plan.md` 的内容发给 Codex。目标是看它有没有吃进去硬约束。

如果 Codex 总结里出现这些内容，要立刻纠正：

- 知识库 owner 可以配置模型。
- OpenKB 自己保存 embedding/rerank API key。
- 使用 OpenFGA/Casbin/LDAP 作为 v0.x 权限基础。
- 自定义 Markdown 方言。
- MCP 用管理员 key 搜全库。
- 搜索结果不做 PostgreSQL 最终权限校验。

## 2. 第二轮：只搭 scaffold

使用 `prompts/02-scaffold.md`。这一轮只建立 monorepo、package、基础配置、空目录和 smoke tests，不实现业务。

## 3. 第三轮：数据库和注册登录

使用 `prompts/03-database-auth.md`。先把用户、租户、空间、知识库、文档、权限关系、邀请、分享、Milvus job 表建好。

## 4. 第四轮：语雀式权限服务

使用 `prompts/04-permissions.md`。权限服务要先写测试，再写实现。MCP、Dify、搜索、附件、导出都复用这套判断。

## 5. 第五轮：Milkdown 编辑器

使用 `prompts/05-editor.md`。重点是 Milkdown-native、Markdown-first、feature registry、round-trip tests。

## 6. 第六轮：Milvus-native indexing

使用 `prompts/06-milvus.md`。重点是 Milvus 2.6+ Functions、raw text 写入、active alias、rebuild、rollback、权限预过滤 + PostgreSQL 终检。

## 7. 第七轮：MCP 和 Dify

使用 `prompts/07-mcp-dify.md`。MCP 先 read-only，Dify 实现 `/retrieval`。

## 8. 工作方式建议

每一轮让 Codex：

1. 先说明它准备修改哪些文件。
2. 再执行修改。
3. 最后跑测试或 smoke check。
4. 输出后续待办。

不要让 Codex 一次性实现整个项目。
