# 18 — v0.3 项目决策覆盖清单

本文件是给 Codex / coding agent 的决策摘要。实现冲突时，以本文件和根目录 `AGENTS.md` 为准；`docs/16-decisions-and-non-goals.zh-CN.md` 只作为基础摘要，不得覆盖本文件。

## 1. Markdown 方言跟随 Milkdown

```text
OpenKB Markdown = 当前锁定版本 Milkdown + 当前启用 plugins/features 的可往返 Markdown 集合。
```

要求：建立 `EDITOR_FEATURES` registry；slash menu、toolbar、renderer、source mode validator、converter validator 都从 registry 读取能力；自定义语法必须先实现 Milkdown plugin；所有启用能力必须有 round-trip 测试。

## 2. 权限完整向语雀对齐

v0.x 只做语雀式：空间、知识库、文档、协作者、邀请、分享、审批、密码、仅空间成员访问、关闭/重置链接。

不做 LDAP、SCIM、OpenFGA、Casbin、OPA、自定义 ABAC。外部身份系统未来只能作为登录/用户导入来源，不能替代语雀式对象权限。

## 3. 知识库 owner 不能配置模型

模型、Milvus、索引、LLM 配置只属于 `system_admin` / `tenant_admin`。知识库 owner、workspace owner、document owner 都不能配置 embedding、rerank、LLM。知识库设置页只能展示索引状态，不能出现模型配置入口。

## 4. Embedding/rerank 尽量放到 Milvus 侧

```text
Embedding: Milvus TEXTEMBEDDING Function。
BM25: Milvus BM25 Function。
Rerank: Milvus RERANK Function / Model Ranker。
```

OpenKB v0.x 不保存 embedding/rerank API key，也不实现旁路 embedding/rerank 模型配置中心。Qwen embedding 推荐通过 TEI 或 Milvus 支持的 provider；Qwen rerank 推荐通过 vLLM/TEI ranker 或 Milvus 支持的 ranker。如果未来需要 fallback，必须通过新的版本化项目决策文档显式改变本规则，Codex 不得自行添加。

## 5. Embedding 更换走 Milvus collection/index/alias

流程：

```text
新建 collection -> 新 schema + Function + index -> 插入当前 chunks raw text -> Milvus 生成 embedding -> load + validate -> alias switch -> 旧 collection rollback window
```

禁止在旧 collection 混写新向量。即使维度一样，也建议新建 collection，避免向量空间混杂。

## 6. 权限最终判断仍在 PostgreSQL

```text
Milvus candidate chunks -> PostgreSQL can_read(document, subject) -> return
```

Milvus `access_principals` 只能做预过滤。Web、MCP、Dify、导出、附件读取都必须调用同一套最终权限判断。

## 7. MCP 用户级，Dify 应用级

MCP 绑定真实用户，使用用户自己的文档权限；Dify 绑定 integration key，使用管理员授予的知识库范围。两者都不能绕过最终权限检查。


## 8. v0.3.2 澄清

Codex 首轮阅读发现的 4 个点已按以下方式定稿：

1. 优先级：`AGENTS.md` + `docs/18-decision-overrides-v0.3.zh-CN.md` 是最高优先级；`docs/16-decisions-and-non-goals.zh-CN.md` 是基础决策摘要。
2. 提示词：`prompts/01-read-and-plan.md` 必须包含 `docs/18` 和本澄清文件，不能只读 `docs/16`。
3. 分享链接：v0.x 分享链接只读，`share_links.permission` 固定为 `view`，实现时必须加数据库约束或等价服务层保护。
4. 目录：`Folder / 目录` 是产品概念，数据库中使用 `documents.type = folder` 表达，不单独建立 `folders` 表。

## 9. v0.3.3 澄清

Codex 第二轮阅读发现的 5 个点按以下方式定稿：

1. Workspace 角色和内容对象角色分开：
   - `workspace_members.role = owner | admin | member | guest`。
   - `collaborators.role = owner | manager | editor | viewer`，仅用于 knowledge_base/document。
   - Workspace 邀请写入 `workspace_members`，角色只能是 admin/member/guest；普通邀请不授予 owner。
   - Knowledge base/document 邀请写入 `collaborators`，角色只能是 manager/editor/viewer；普通邀请不授予 owner。
2. Milvus 主键固定为 `id` primary key；`chunk_id` 是普通字段。v0.x 中两者值都等于 PostgreSQL `document_chunks.id` 的字符串形式。
3. `auth_settings` 必须在数据模型中实现，不能只在 auth 文档和 prompt 中提到。
4. MCP OAuth/PAT 和 Dify scoped API key 必须有明确持久化表，见 `docs/07-data-model.zh-CN.md`。
5. OpenKB v0.x 不保存 embedding/rerank provider API key；`docs/18` 旧表述中的 fallback 不适用于当前硬规则。
