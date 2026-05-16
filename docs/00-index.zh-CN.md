# 00 — OpenKB 文档索引

本文档把 OpenKB 文档分为四类：当前规范、路线图、对齐审计和历史快照。Codex 开始任何代码工作前，应优先阅读“最高优先级”和“当前规范”；历史快照只用于追溯，不应覆盖当前规范。

## 最高优先级

1. `AGENTS.md`
2. `docs/18-decision-overrides-v0.3.zh-CN.md`
3. `docs/21-v0.3.2-clarifications.zh-CN.md`
4. `docs/22-v0.3.3-clarifications.zh-CN.md`
5. `docs/04-editor-spec.zh-CN.md`
6. `docs/05-permission-spec.zh-CN.md`
7. `docs/09-search-rag-milvus-native.zh-CN.md`
8. `docs/16-decisions-and-non-goals.zh-CN.md`

如果以上文档存在细节差异，以 `AGENTS.md` 和 `docs/18-decision-overrides-v0.3.zh-CN.md` 为准；`docs/16-decisions-and-non-goals.zh-CN.md` 只作为基础决策摘要。

## 产品和架构

- `docs/01-product-vision.zh-CN.md`：产品目标和范围。
- `docs/02-yuque-reference-model.zh-CN.md`：语雀式产品模型抽象。
- `docs/03-system-architecture.zh-CN.md`：整体系统架构。

## 核心模块

- `docs/04-editor-spec.zh-CN.md`：Milkdown 文档编辑器。
- `docs/05-permission-spec.zh-CN.md`：语雀式权限。
- `docs/06-auth-registration.zh-CN.md`：邮箱注册、激活、登录。
- `docs/07-data-model.zh-CN.md`：数据库模型。
- `docs/08-api-contract.zh-CN.md`：API 合同。
- `docs/09-search-rag-milvus-native.zh-CN.md`：Milvus 检索、OpenKB direct embedding/rerank、Function 演进、alias、重建索引。
- `docs/10-mcp-server.zh-CN.md`：MCP Server。
- `docs/11-dify-adapter.zh-CN.md`：Dify External Knowledge Adapter。
- `docs/12-import-conversion.zh-CN.md`：文件导入和 Markdown 转换。
- `docs/13-deployment.zh-CN.md`：Docker Compose 和 K8s。
- `docs/14-ui-routes.zh-CN.md`：UI 路由和页面。
- `docs/15-roadmap-and-codex-tasks.zh-CN.md`：开发路线。
- `docs/24-public-test-platform-deployment.zh-CN.md`：公网测试平台安全部署文档。
- `docs/25-local-quickstart.zh-CN.md`：本地 Docker Compose 快速部署和源码开发端口。
- `docs/18-decision-overrides-v0.3.zh-CN.md`：v0.3 最高优先级决策覆盖清单。
- `docs/21-v0.3.2-clarifications.zh-CN.md`：Codex 首轮发现点的澄清和修正。
- `docs/22-v0.3.3-clarifications.zh-CN.md`：Codex 第二轮发现点的澄清和修正。

## Dify 与对齐审计

- `docs/26-dify-external-knowledge-setup.zh-CN.md`：OpenKB 作为 Dify External Knowledge 的配置、metadata 映射和本地 Docker/WSL 验证指南。
- `docs/27-dify-knowledge-alignment.zh-CN.md`：Dify 1.14.1 知识库处理、分块、检索策略、QA、摘要和 segment 管理的 OpenKB 对齐计划。
- `docs/28-dify-1.14.1-knowledge-gap-audit.zh-CN.md`：本地 Dify 1.14.1 升级记录、真实运行验证、差异矩阵和 Phase 22 历史拆分记录。
- `docs/29-i18n-terminology-alignment.zh-CN.md`：前端中文术语对齐基线，覆盖 Dify 知识库/检索术语和语雀式协作权限术语。
- `docs/30-dify-parity-v2-analysis.zh-CN.md`：Dify Parity v2 报告、Dify 1.14.1 后端和 OpenKB 后端的三方差异分析基线；Phase 22.9 的 splitter、QA、metadata/tags 和 segment parity 收敛以该文档为验收基线。
- `docs/31-dify-parity-next-phases.zh-CN.md`：Phase 22.9 之后的后续路线入口，固定低风险兼容补齐、QA parity、图片与附件检索三段顺序。

## 辅助文档

- `docs/17-glossary.zh-CN.md`：术语表；前端具体翻译以 `docs/29-i18n-terminology-alignment.zh-CN.md` 为准。
- `docs/23-docs-code-gap-analysis.zh-CN.md`：历史本机开发移交快照。该文档可能包含过期 phase/status 表述，当前状态以 README、`docs/15`、`docs/27`、`docs/28` 为准。
- `docs/24-public-test-platform-deployment.zh-CN.md`：公网测试平台部署清单。
- `docs/25-local-quickstart.zh-CN.md`：本地快速启动、源码开发端口和冒烟测试。
- `docs/99-references.md`：参考资料。
- `prompts/`：给 Codex 的分阶段提示词。
