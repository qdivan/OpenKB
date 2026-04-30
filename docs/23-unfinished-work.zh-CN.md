# 23 — 未完成事项与后续边界

本文记录 Phase 10 之后仍未完成的工作，方便在新机器或新 agent 上继续推进。当前 `main` 已完成到 Phase 10：Dify External Knowledge Adapter；`phase-10` tag 指向该阶段完成点。

## 1. Phase 11 的定位

Phase 11 是当前 roadmap 的最后一个编号阶段，但它不是“产品全部完成”。更准确地说，Phase 11 是 v0.3.x 的部署闭环：

- 把 Phase 1-10 已实现的 web、api、workers、MCP、Dify、PostgreSQL、Redis、MinIO、Milvus 组合成可部署形态。
- 提供 Docker Compose 和 Helm chart 的最小可运行配置。
- 明确本地 CPU-only 默认，避免误启 TEXTEMBEDDING、RERANK、MinerU GPU、Qwen Embedding TEI 或 Qwen Reranker vLLM。
- 不引入新的业务功能，不新增知识库级模型配置，不在 OpenKB DB 保存 embedding/rerank provider API key。

## 2. Phase 11 必做

- Docker Compose 生产/自托管模板：`web`、`api`、`mcp-server`、`dify-adapter`、`import-worker`、`index-worker`、`postgres`、`redis`、`minio-assets`、`milvus-standalone`、`milvus-etcd`、`milvus-minio`。
- Helm chart 最小骨架：values、templates、secrets/configmaps、service、deployment/stateful dependency 开关、external dependency 开关。
- 环境变量整理：复用 `.env.example`，补齐 compose/helm 里的 `DATABASE_URL`、`REDIS_URL`、S3、Milvus、MCP、Dify、APP URL 等配置。
- 启动顺序和健康检查：服务依赖数据库、MinIO、Milvus；workers 必须可重启且幂等。
- 文档更新：`README.md`、`docs/13-deployment.zh-CN.md`、`deploy/docker-compose/README.md`、`deploy/helm/README.md`。
- 验证命令：在有原生 Docker 的机器上跑通 compose 启动、迁移、dev seed、登录、导入、索引、搜索、MCP、Dify。

## 3. Phase 11 可选

- Compose profiles：`core`、`search`、`integrations`、`optional-models`。
- 外部服务模式：external PostgreSQL、external Redis、external S3、external Milvus。
- 基础备份示例：PostgreSQL dump、MinIO bucket 备份、Milvus collection/volume 说明。
- TLS/Ingress 示例：仅作为 chart values 和注释，不强制绑定某个云厂商。
- 可选模型服务占位：Qwen Embedding、Qwen Reranker、MinerU GPU worker 只能通过显式 profile/values 启用。

## 4. Phase 11 之后再做

- 生产 SMTP：当前邮件主要是开发 outbox，生产 SMTP 发送、重试和模板管理还没完成。
- MCP 完整 OAuth：当前 PAT 优先可用，OAuth protected-resource metadata 已有；授权码、同意页、refresh/revoke 全流程未完成。
- Key 管理 UI：MCP PAT 和 Dify API key 目前通过 CLI/helper 创建，缺少 Web 管理页。
- 复杂导入：Phase 6 稳定支持 Markdown/Text/HTML/CSV；Office/PDF/OCR/MinerU 全量转换仍是后续增强。
- Dense/hybrid/rerank：当前默认 BM25/text-only；TEXTEMBEDDING、hybrid fusion、RERANK/Model Ranker 的生产链路还未接入。
- 实时协同：Milkdown 编辑器已有基础工作台，Y.js 或类似实时协同未实现。
- Admin UI：已有 admin API 和配置边界，生产级 admin 面板、审计查询、key 管理、索引管理 UI 仍待补齐。
- 运维增强：监控指标、日志聚合、备份恢复演练、升级/回滚流程、容量规划仍需单独设计。

## 5. 继续开发时必须保留的硬规则

- PostgreSQL 是内容、权限、版本和审计真相；Milvus 只做检索索引。
- 每个检索结果返回前都必须通过 PostgreSQL final check。
- MCP 是 user-bound，MCP token 必须解析到真实用户。
- Dify 是 app-key-bound，API key 只能访问显式授权 KB，不能模拟任意用户或管理员。
- 不保存 embedding/rerank provider API key，不新增知识库级模型配置。
- Milvus 主键字段是 `id`，`chunk_id` 只是普通字段；v0.x 两者值可相同。
- Folder 仍然使用 `documents.type = 'folder'`，不创建 `folders` 表。
