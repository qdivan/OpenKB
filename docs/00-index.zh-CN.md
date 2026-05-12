# 00 — OpenKB 文档索引

> 新增：`docs/26-dify-external-knowledge-setup.zh-CN.md` 记录 OpenKB 作为 Dify External Knowledge 的配置、metadata 映射和本地 Docker/WSL 验证指南。

Codex 开始任何代码工作前，必须按下面顺序阅读。

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
- `docs/23-docs-code-gap-analysis.zh-CN.md`：本机开发移交档案和当前状态。
- `docs/24-public-test-platform-deployment.zh-CN.md`：公网测试平台安全部署文档。
- `docs/25-local-quickstart.zh-CN.md`：本地 Docker Compose 快速部署和源码开发端口。
- `docs/18-decision-overrides-v0.3.zh-CN.md`：v0.3 最高优先级决策覆盖清单。
- `docs/21-v0.3.2-clarifications.zh-CN.md`：Codex 首轮发现点的澄清和修正。
- `docs/22-v0.3.3-clarifications.zh-CN.md`：Codex 第二轮发现点的澄清和修正。

## 辅助文档

- `docs/17-glossary.zh-CN.md`：术语表。
- `docs/23-docs-code-gap-analysis.zh-CN.md`：本机开发移交档案。
- `docs/24-public-test-platform-deployment.zh-CN.md`：公网测试平台部署清单。
- `docs/25-local-quickstart.zh-CN.md`：本地快速启动、源码开发端口和冒烟测试。
- `docs/99-references.md`：参考资料。
- `prompts/`：给 Codex 的分阶段提示词。
