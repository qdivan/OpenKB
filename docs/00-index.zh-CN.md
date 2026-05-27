# 00 - OpenKB 文档索引

本文是 OpenKB 当前文档入口。开始实现或 review 前，请优先阅读“最高优先级”和“当前规范”；历史审计材料只用于追溯，不覆盖当前规范。

当前主线：`v0.3.x / Phase 31`，并包含最新的登录注册、导入进度、语言切换和 MCP bridge / skill 体验优化。OpenKB 当前采用“个人空间 / 团队空间 / 知识库 / 文档”的用户模型；Dify 相关能力以“External Knowledge 配合、Hub 管理和兼容性测试”为公开口径，避免过度承诺。

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

- `docs/01-product-vision.zh-CN.md`：产品目标和边界。
- `docs/02-yuque-reference-model.zh-CN.md`：语雀式产品模型抽象。
- `docs/32-yuque-space-kb-model.zh-CN.md`：个人空间、团队空间、知识库和权限路线。
- `docs/33-workspace-migration-compatibility.zh-CN.md`：旧 workspace 迁移报告和兼容 runbook。
- `docs/03-system-architecture.zh-CN.md`：整体系统架构。
- `docs/04-editor-spec.zh-CN.md`：Milkdown 编辑器规范。
- `docs/05-permission-spec.zh-CN.md`：语雀式权限模型。
- `docs/06-auth-registration.zh-CN.md`：账号注册、邮箱验证、登录页注册入口、白名单域名和个人空间创建。
- `docs/07-data-model.zh-CN.md`：数据库模型。
- `docs/08-api-contract.zh-CN.md`：API 合同。
- `docs/09-search-rag-milvus-native.zh-CN.md`：Milvus 检索、alias 和重建索引。
- `docs/10-mcp-server.zh-CN.md`：MCP Server、OAuth/PAT、`openkb-mcp` stdio bridge 和跨客户端 skill。
- `docs/11-dify-adapter.zh-CN.md`：Dify External Knowledge Adapter。
- `docs/12-import-conversion.zh-CN.md`：文件导入、转换链路和导入任务进度。
- `docs/13-deployment.zh-CN.md`：Docker Compose、Helm 和升级验收。
- `docs/14-ui-routes.zh-CN.md`：UI 路由和页面层级。
- `docs/15-roadmap-and-codex-tasks.zh-CN.md`：当前路线和验证清单。
- `docs/24-public-test-platform-deployment.zh-CN.md`：公网测试平台部署。
- `docs/25-local-quickstart.zh-CN.md`：本地 Docker Compose 和源码开发端口。

## Dify 配合与兼容

- `docs/26-dify-external-knowledge-setup.zh-CN.md`：OpenKB 作为 Dify External Knowledge 的配置、metadata 映射和本地 Docker/WSL 验证。
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
