# 00 - OpenKB 文档索引

本文把 OpenKB 文档分为当前规范、路线图、Dify 配合与兼容、历史/工程审计。开始任何代码工作前，应优先阅读“最高优先级”和“当前规范”；历史快照只用于追溯，不应覆盖当前规范。

当前主线状态：Phase 31。OpenKB 已把语雀式空间主页收口为知识库的归属入口，并把权限入口按“空间成员 / 知识库公开性 + 协作者 / 文档权限 + 分享链接”重组。Phase 31 补齐旧 workspace 兼容迁移报告和 runbook：`Default Workspace / OpenKB Demo` 默认作为团队空间处理，报告只读，不自动搬迁私有内容或重写权限。Dify Hub 继续使用 Dify Dataset Service API 管理 external dataset 和 metadata，不使用 Console cookie、不写 Dify 数据库。

## 最高优先级

1. `AGENTS.md`
2. `docs/18-decision-overrides-v0.3.zh-CN.md`
3. `docs/21-v0.3.2-clarifications.zh-CN.md`
4. `docs/22-v0.3.3-clarifications.zh-CN.md`
5. `docs/04-editor-spec.zh-CN.md`
6. `docs/05-permission-spec.zh-CN.md`
7. `docs/09-search-rag-milvus-native.zh-CN.md`
8. `docs/16-decisions-and-non-goals.zh-CN.md`

如果以上文档存在细节差异，以 `AGENTS.md` 和 `docs/18-decision-overrides-v0.3.zh-CN.md` 为准。

## 当前规范

- `docs/01-product-vision.zh-CN.md`：产品目标和范围。
- `docs/02-yuque-reference-model.zh-CN.md`：语雀式产品模型抽象。
- `docs/32-yuque-space-kb-model.zh-CN.md`：个人空间、团队空间、知识库和权限路线图。
- `docs/33-workspace-migration-compatibility.zh-CN.md`：旧 workspace 迁移报告和兼容 runbook。
- `docs/03-system-architecture.zh-CN.md`：整体系统架构。
- `docs/04-editor-spec.zh-CN.md`：Milkdown 文档编辑器。
- `docs/05-permission-spec.zh-CN.md`：语雀式权限。
- `docs/06-auth-registration.zh-CN.md`：邮箱注册、激活、登录与个人空间创建。
- `docs/07-data-model.zh-CN.md`：数据库模型。
- `docs/08-api-contract.zh-CN.md`：API 合同。
- `docs/09-search-rag-milvus-native.zh-CN.md`：Milvus 检索、alias 和重建索引。
- `docs/10-mcp-server.zh-CN.md`：MCP Server。
- `docs/11-dify-adapter.zh-CN.md`：Dify External Knowledge Adapter。
- `docs/12-import-conversion.zh-CN.md`：文件导入和 Markdown 转换。
- `docs/13-deployment.zh-CN.md`：Docker Compose 和 K8s。
- `docs/14-ui-routes.zh-CN.md`：UI 路由和页面。
- `docs/15-roadmap-and-codex-tasks.zh-CN.md`：开发路线。
- `docs/24-public-test-platform-deployment.zh-CN.md`：公网测试平台部署。
- `docs/25-local-quickstart.zh-CN.md`：本地 Docker Compose 和源码开发端口。

## Dify 配合与兼容

- `docs/26-dify-external-knowledge-setup.zh-CN.md`：OpenKB 作为 Dify External Knowledge 的配置、metadata 映射和本地 Docker/WSL 验证指南。
- `docs/27-dify-knowledge-alignment.zh-CN.md`：Dify 风格知识库处理、分块、检索策略、QA、摘要和 segment 管理在 OpenKB 中的兼容性基线。
- `docs/29-i18n-terminology-alignment.zh-CN.md`：前端中文术语基线。
- `docs/31-dify-parity-next-phases.zh-CN.md`：Phase 23-25 的收口记录和后续验证入口。

## 历史 / 工程审计

- `docs/28-dify-1.14.1-knowledge-gap-audit.zh-CN.md`：Dify 1.14.1 升级记录、真实运行验证和差异矩阵。
- `docs/30-dify-parity-v2-analysis.zh-CN.md`：Dify 兼容性测试报告和检索差异分析基线。
- `docs/23-docs-code-gap-analysis.zh-CN.md`：历史本机开发移交快照，可能包含过期 phase/status 表述。

## 辅助文档

- `docs/17-glossary.zh-CN.md`：术语表。
- `docs/99-references.md`：参考资料。
- `prompts/`：给 Codex 的分阶段提示词。
