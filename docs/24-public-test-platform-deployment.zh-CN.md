# 24 — 公网测试平台安全部署清单

本文用于把 OpenKB 部署到可公网访问的测试平台。测试平台不等于生产平台，但所有公网入口都必须按生产安全基线处理。

## 0. 当前结论

OpenKB 主线已具备 Phase 20-22 的基础安全与运维能力：

- 生产 SMTP、outbox retry 和 Admin Email 页面。
- Cookie-auth mutation 的 CSRF double-submit 防护。
- MCP OAuth Authorization Code + PKCE、refresh/revoke，以及 PAT。
- Dify key/mapping 管理、reveal/rotate/revoke。
- Import Tools、Models、Indexing、Audit、Security 等 Admin 运维页面。
- 基础 metrics、ops health、backup/restore 脚本和 Helm/Compose 入口。

仍必须由部署侧落实：

- HTTPS、HSTS、反向代理或 Ingress。
- 禁止使用开发默认账号、默认密码和默认 secret。
- PostgreSQL、Redis、MinIO Console、Milvus、etcd 不暴露公网。
- 生产 SMTP、模型、导入工具、OAuth signing secret 等真实 secret 不进 Git。
- 公共上传必须结合外部病毒扫描或网关策略。
- 2FA/SSO、WAF、集中日志告警和完整恢复演练仍需按部署方环境补齐。

## 1. 部署前确认表

| 类别 | 必须确认 | OpenKB 配置 |
| --- | --- | --- |
| 域名 | Web/API 公网 URL，必须 HTTPS | `APP_BASE_URL`、`WEB_BASE_URL`、`NEXT_PUBLIC_API_BASE_URL`、`CORS_ORIGINS` |
| 管理员 | 初始管理员邮箱、显示名、一次性强密码 | `ADMIN_EMAIL`、`ADMIN_DISPLAY_NAME`、`ADMIN_PASSWORD` |
| 数据库 | PostgreSQL 地址、强密码、备份策略、SSL | `DATABASE_URL` |
| Redis | 地址、密码、网络策略 | `REDIS_URL` |
| 对象存储 | S3/MinIO endpoint、bucket、region、最小权限 key | `S3_*` |
| Milvus | URI、token、database、是否 external | `MILVUS_*` |
| SMTP | host、port、secure、from、reply-to、账号密码 | `OPENKB_SMTP_*` 或 Admin Email 加密配置 |
| 模型 | embedding/rerank/LLM endpoint、model、dim、认证方式 | `OPENKB_EMBEDDING_*`、`OPENKB_RERANK_*`、`OPENKB_LLM_*` |
| 导入工具 | MarkItDown/MinerU/Pandoc/Tesseract OCR 是否启用 | `OPENKB_MARKITDOWN_COMMAND`、`OPENKB_MINERU_*`、`OPENKB_PANDOC_COMMAND`、`OPENKB_TESSERACT_COMMAND` |
| MCP | 是否开放公网、OAuth issuer、client 管理、IP allowlist | `MCP_SERVER_BASE_URL`、`MCP_OAUTH_*` |
| Dify | Dify 出口 IP、allowed KB、top_k、key 过期策略 | Admin Dify |
| 备份 | RPO/RTO、备份目录、恢复演练时间 | `OPENKB_BACKUP_*` |
| 日志 | 审计保留、访问日志保留、脱敏规则 | 运维平台 |

## 2. 推荐公网拓扑

```text
Internet
  -> HTTPS reverse proxy / Ingress
    -> web:3000
    -> api:4000
    -> mcp-server:4100       optional, restricted
    -> dify-adapter:4200     optional, Dify IP allowlist

Private network only:
  postgres
  redis
  minio-assets
  milvus-standalone
  milvus-etcd
  milvus-minio
```

推荐 Web 和 API 同站点部署，降低 CORS 和 cookie 复杂度。MCP/Dify 若必须公网开放，应单独域名、TLS、IP allowlist 和最小 scope。

## 3. Compose 公网测试模板

`.env.public-test` 不得提交 Git。示例只展示字段，不包含真实 secret：

```bash
APP_BASE_URL=https://kb-test.example.com
WEB_BASE_URL=https://kb-test.example.com
NEXT_PUBLIC_API_BASE_URL=https://kb-test.example.com
CORS_ORIGINS=https://kb-test.example.com
OPENKB_ALLOW_LOCAL_CORS=false

AUTH_COOKIE_SECURE=true
TRUST_PROXY_HEADERS=true
OPENKB_CSRF_COOKIE_NAME=openkb_csrf
NEXT_PUBLIC_OPENKB_CSRF_COOKIE_NAME=openkb_csrf

DATABASE_URL=postgresql://...
REDIS_URL=redis://...
OPENKB_CONFIG_ENCRYPTION_KEY=<32-byte-random-secret>

OPENKB_SMTP_HOST=
OPENKB_SMTP_PORT=587
OPENKB_SMTP_SECURE=false
OPENKB_SMTP_USER=
OPENKB_SMTP_PASSWORD=
OPENKB_SMTP_FROM=
OPENKB_SMTP_REPLY_TO=

MCP_OAUTH_ISSUER=https://mcp-kb-test.example.com
MCP_OAUTH_SIGNING_SECRET=<random-secret>

OPENKB_METRICS_ENABLED=true
OPENKB_BACKUP_DIR=/backups/openkb
```

启动：

```bash
docker compose --env-file .env.public-test -f deploy/docker-compose/compose.yml build
docker compose --env-file .env.public-test -f deploy/docker-compose/compose.yml up -d postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
docker compose --env-file .env.public-test -f deploy/docker-compose/compose.yml run --rm migrate
docker compose --env-file .env.public-test -f deploy/docker-compose/compose.yml up -d
```

公网测试平台禁止运行 `seed-dev`。初始管理员应由部署方显式创建并在首次登录后更换密码。

## 4. 反向代理示例

Caddy 示例：

```text
kb-test.example.com {
  encode zstd gzip
  header Strict-Transport-Security "max-age=31536000; includeSubDomains"
  header X-Content-Type-Options "nosniff"
  header Referrer-Policy "no-referrer"
  header X-Frame-Options "DENY"

  reverse_proxy /api/* 127.0.0.1:4000
  reverse_proxy 127.0.0.1:3000
}

dify-kb-test.example.com {
  encode zstd gzip
  @dify path /retrieval /health
  reverse_proxy @dify 127.0.0.1:4200
}

mcp-kb-test.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:4100
}
```

如果 Dify/MCP 不需要公网访问，不要配置对应域名。

## 5. 上线后立即验证

1. 登录初始管理员账号并更换密码。
2. 关闭公开注册或改成邀请制。
3. 确认错误登录会触发 rate limit。
4. 确认跨域 Origin 不在 `CORS_ORIGINS` 时被拒绝。
5. 确认 cookie 带 `Secure`、`HttpOnly`、`SameSite`。
6. 确认 cookie-auth mutation 缺少 CSRF header 时返回 403。
7. 确认公网无法访问 PostgreSQL、Redis、MinIO Console、Milvus、etcd。
8. 执行 SMTP test send。
9. 如启用 embedding/rerank，执行模型 probe 并创建 index rebuild job。
10. 执行一次创建文档、发布、reprocess、index rebuild、搜索、MCP/Dify 检索 smoke。

## 6. 安全验收清单

- `pnpm audit --prod` 无未接受的 high/critical 漏洞。
- `pnpm typecheck && pnpm build && pnpm test` 通过。
- 默认密码和默认 secret 已替换。
- `.env.public-test` 不提交 Git。
- `AUTH_COOKIE_SECURE=true`。
- `OPENKB_ALLOW_LOCAL_CORS=false`。
- `TRUST_PROXY_HEADERS=true` 只在反向代理可信时开启。
- Dify key、MCP PAT/OAuth client、模型 key、SMTP password 均不进入日志和 audit metadata。
- PostgreSQL 每日备份，并至少做一次恢复演练。
- S3 bucket 开启服务端加密和生命周期策略。
- 管理员 IP allowlist、WAF、集中日志和告警由部署方落实。

## 7. 已知限制

- 2FA/SSO 尚未作为 v0.x 内置能力，管理员入口建议收紧来源 IP。
- 内置病毒扫描尚未实现，公网未知用户上传必须接外部扫描或网关。
- 动态 MCP OAuth client registration 不在当前范围；OAuth clients 仍由 Admin 预创建。
- 大规模导入、超长文档 reprocess、批量 QA/summary 生成后续可拆成异步 job。
- Dify parity 仍需按 `docs/30-dify-parity-v2-analysis.zh-CN.md` 在同模型环境下继续复跑。
