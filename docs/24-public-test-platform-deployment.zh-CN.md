# 24 — 公网测试平台安全部署文档

本文档用于把 OpenKB 部署到可公网访问的测试平台。目标是“公网可测、默认收紧、可审计、可回滚”。测试平台不等于生产平台，但所有对公网开放的入口都必须按生产级安全基线处理。

## 0. 当前安全结论

本轮审查已处理：

- `pnpm audit --prod` 原先发现 Nest/Fastify 链路存在 critical/high 漏洞；已升级到 Nest 11 / Fastify 5，并通过 `pnpm.overrides` 固定 patched `fastify` 与 `postcss`。
- API 已增加安全响应头和基础限速：全局 API 限速、登录/注册/邮箱验证/密码重置独立限速。
- CORS 在生产模式下不再默认放行 localhost，公网必须显式配置 `CORS_ORIGINS`。
- 本地 HTTP 登录 cookie 不再错误写入 `Secure`；公网 HTTPS 必须配置 `AUTH_COOKIE_SECURE=true`。
- Web、API、MCP、Dify 均补充基础安全响应头；Dify `/retrieval` 增加请求体大小限制。

仍需部署侧强制落实：

- 必须使用 HTTPS、HSTS、反向代理或 Ingress，不允许浏览器通过明文 HTTP 使用公网平台。
- 不允许使用 `dev:seed`、`OpenKB-dev-123456`、`openkb-secret`、`admin@openkb.local` 等开发默认值。
- 不允许把 PostgreSQL、Redis、MinIO Console、Milvus、Milvus MinIO、etcd 暴露到公网。
- 公开注册、开放上传、MCP 公网访问、Dify 公网访问必须由项目负责人逐项确认。
- 当前没有生产 SMTP、完整 MCP OAuth、2FA、病毒扫描、完整 Admin UI；因此公网测试应以受控账号和受控网络为前提。

## 1. 部署人员必须向项目负责人确认的信息

部署开始前，部署人员必须把下表逐项填完；未确认项不得用默认值代替。

| 类别 | 需要负责人提供/确认 | 用途 | 备注 |
|---|---|---|---|
| 域名 | Web 公网 URL，例如 `https://kb-test.example.com` | `APP_BASE_URL`、`WEB_BASE_URL` | 必须 HTTPS。 |
| 域名 | API 公网 URL，例如同域 `https://kb-test.example.com` 或独立 `https://api-kb-test.example.com` | `NEXT_PUBLIC_API_BASE_URL`、`CORS_ORIGINS` | 浏览器必须能访问；推荐与 Web 同站点。 |
| 域名 | MCP URL，是否开放公网 | `MCP_SERVER_BASE_URL` | 默认不开放；如开放需反代、TLS、PAT、IP allowlist。 |
| 域名 | Dify Adapter URL，是否开放给 Dify | Dify External Knowledge URL | 只允许 Dify 出口 IP 访问。 |
| TLS | 证书来源、自动续期方式、HSTS 是否开启 | 反向代理/Ingress | 必须开启 TLS 1.2+，推荐 TLS 1.3。 |
| 管理员 | 初始管理员邮箱、显示名、一次性强密码 | `ADMIN_EMAIL`、`ADMIN_DISPLAY_NAME`、`ADMIN_PASSWORD` | 密码至少 20 位随机；首次登录后更换。 |
| 注册策略 | 是否允许公开注册、是否只允许邀请、允许邮箱域 | `auth_settings` | 公网测试默认关闭公开注册。 |
| 数据库 | PostgreSQL 地址、库名、用户、强密码、备份策略、SSL 要求 | `DATABASE_URL` 或 compose/Helm Secret | 不允许公网直连。 |
| Redis | Redis 地址、是否内置、密码/网络策略 | `REDIS_URL` | 当前 workers 仍轮询 PostgreSQL，但 Redis 是部署基线。 |
| 对象存储 | S3/MinIO endpoint、bucket、access key、secret、region、path-style | `S3_*` | key 只授予目标 bucket 最小权限。 |
| Milvus | Milvus URI、token、database、是否 external | `MILVUS_*` | Milvus 只做索引，不做最终授权源。 |
| 模型服务 | 是否启用 embedding/rerank、endpoint、model 名、向量维度、认证方式、是否仅内网可达 | `OPENKB_EMBEDDING_*`、`OPENKB_RERANK_*`、模型服务部署配置 | OpenKB 不保存 embedding/rerank provider key；如有凭据放在模型服务或部署平台 Secret。 |
| OCR/导入 | 是否启用 MinerU/OCR/Office/PDF adapter、服务地址、资源规格 | 后续 adapter/worker | 当前代码只启用 Markdown/Text/HTML/CSV 导入。 |
| 上传策略 | 单文件大小、允许文件类型、是否接入杀毒/内容扫描 | `UPLOAD_MAX_BYTES`、网关策略 | 公网未知用户上传必须接入外部扫描。 |
| Dify | Dify 出口 IP、knowledge_id 命名、允许 KB、top_k 限制、API key 有效期 | Dify key/mapping | Dify key 是 app-scoped，不可模拟用户。 |
| MCP | 允许哪些用户创建 PAT、scope、过期时间、客户端来源 IP | MCP PAT | MCP 是 user-bound；不要发管理员全库 PAT。 |
| 邮件 | SMTP 服务、发件域、退信地址 | 后续生产 SMTP | 当前生产 SMTP 未实现；不要依赖公开注册邮件闭环。 |
| 备份 | RPO/RTO、备份保留天数、恢复演练时间 | Postgres/S3/Milvus | Postgres 是内容与权限真相。 |
| 日志 | 审计日志保留、访问日志保留、安全告警联系人 | 运维平台 | 日志不得记录明文 token/password。 |
| 网络 | 管理员 IP allowlist、Dify IP allowlist、监控 IP allowlist | 反代/Ingress/WAF | 尽量不要开放管理和集成入口给全网。 |

## 2. 推荐公网拓扑

推荐测试平台只暴露 HTTPS 反向代理：

```text
Internet
  -> HTTPS reverse proxy / Ingress
    -> web:3000
    -> api:4000
    -> mcp-server:4100       optional, restricted
    -> dify-adapter:4200     optional, Dify IP allowlist

Private network only:
  postgres:5432
  redis:6379
  minio-assets:9000/9001
  milvus-standalone:19530/9091
  milvus-etcd
  milvus-minio
```

公网入口建议：

- Web + API 同域：`https://kb-test.example.com`，反代 `/api/*` 到 API，其余到 Web。
- MCP 单独域名：`https://mcp-kb-test.example.com/mcp`，默认关闭公网或仅允许指定 IP。
- Dify 单独域名：`https://dify-kb-test.example.com/retrieval`，只允许 Dify 出口 IP。

## 3. Docker Compose 公网测试部署

### 3.1 生成公网环境文件

在服务器上创建 `.env.public-test`。下面是模板，值必须由负责人确认或由部署人员随机生成：

```bash
APP_BASE_URL=https://kb-test.example.com
WEB_BASE_URL=https://kb-test.example.com
NEXT_PUBLIC_API_BASE_URL=https://kb-test.example.com
CORS_ORIGINS=https://kb-test.example.com
OPENKB_ALLOW_LOCAL_CORS=false

AUTH_COOKIE_NAME=openkb_session
AUTH_COOKIE_SECURE=true
SESSION_TTL_DAYS=7
TRUST_PROXY_HEADERS=true

API_RATE_LIMIT_MAX=600
API_RATE_LIMIT_WINDOW_SECONDS=60
AUTH_RATE_LIMIT_MAX=20
AUTH_RATE_LIMIT_WINDOW_SECONDS=300

UPLOAD_MAX_BYTES=26214400
DIFY_REQUEST_MAX_BYTES=1048576

WEB_PORT=127.0.0.1:3000
API_PORT=127.0.0.1:4000
MCP_PORT=127.0.0.1:4100
DIFY_ADAPTER_PORT=127.0.0.1:4200
POSTGRES_PORT=127.0.0.1:5432
REDIS_PORT=127.0.0.1:6379
MINIO_PORT=127.0.0.1:9000
MINIO_CONSOLE_PORT=127.0.0.1:9001
MILVUS_PORT=127.0.0.1:19530
MILVUS_HEALTH_PORT=127.0.0.1:9091

POSTGRES_DB=openkb
POSTGRES_PASSWORD=<负责人确认或随机生成的强密码>

ADMIN_EMAIL=<负责人提供的管理员邮箱>
ADMIN_PASSWORD=<负责人确认的一次性强密码>
ADMIN_DISPLAY_NAME=<负责人提供的显示名>

S3_REGION=us-east-1
S3_BUCKET=openkb-assets
S3_ACCESS_KEY_ID=<S3 access key>
S3_SECRET_ACCESS_KEY=<S3 secret key>
S3_FORCE_PATH_STYLE=true

MILVUS_TOKEN=<如 Milvus 开启鉴权则填写>
MILVUS_DATABASE=
MILVUS_ACTIVE_ALIAS=openkb_chunks_active
MILVUS_COLLECTION_PREFIX=openkb_chunks
MILVUS_ENABLE_BM25=true
MILVUS_ENABLE_TEXT_EMBEDDING=false
MILVUS_ENABLE_RERANK=false
MILVUS_VECTOR_DIM=2048

OPENKB_RETRIEVAL_DEFAULT_MODE=hybrid
OPENKB_EMBEDDING_ENDPOINT=<负责人提供的 embedding endpoint，未启用则留空>
OPENKB_EMBEDDING_MODEL=<负责人提供的 embedding model，未启用则留空>
OPENKB_EMBEDDING_DIM=2048
OPENKB_EMBEDDING_BATCH_SIZE=16
OPENKB_EMBEDDING_TIMEOUT_MS=30000
OPENKB_RERANK_ENDPOINT=<负责人提供的 rerank endpoint，未启用则留空>
OPENKB_RERANK_MODEL=<负责人提供的 rerank model，未启用则留空>
OPENKB_RERANK_TIMEOUT_MS=15000

MCP_SERVER_BASE_URL=https://mcp-kb-test.example.com
DIFY_RESULT_BASE_URL=https://kb-test.example.com
```

如果使用 external PostgreSQL/Redis/S3/Milvus，不要使用内置默认密码；改成 external service 的地址和 Secret，并确保网络仅内网可达。

### 3.2 构建与启动

```bash
docker compose --env-file .env.public-test -f deploy/docker-compose/compose.yml build

docker compose --env-file .env.public-test -f deploy/docker-compose/compose.yml up -d \
  postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone

docker compose --env-file .env.public-test -f deploy/docker-compose/compose.yml run --rm migrate

docker compose --env-file .env.public-test -f deploy/docker-compose/compose.yml run --rm api \
  pnpm db:seed:first-admin

docker compose --env-file .env.public-test -f deploy/docker-compose/compose.yml up -d
```

禁止在公网测试平台运行：

```bash
pnpm dev:seed
docker compose ... run --rm seed-dev
```

这些命令会创建开发账号和演示数据，只能本地使用。

### 3.3 反向代理示例

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

如果 Dify/MCP 不需要公网访问，不要配置对应域名。若必须配置，应在反向代理或云安全组中加 IP allowlist。

## 4. Helm 公网测试部署

Helm values 必须使用私有 overlay，不要直接把真实密钥提交到 Git。

必须优先使用：

```yaml
secrets:
  existingSecret: openkb-public-test-secret

web:
  baseUrl: https://kb-test.example.com
  apiBaseUrl: https://kb-test.example.com

api:
  allowLocalCors: "false"
  trustProxyHeaders: "true"
  rateLimit:
    max: "600"
    windowSeconds: "60"
  authRateLimit:
    max: "20"
    windowSeconds: "300"

auth:
  cookieSecure: "true"
  sessionTtlDays: "7"

difyAdapter:
  resultBaseUrl: https://kb-test.example.com
  requestMaxBytes: 1048576

milvus:
  enableBm25: "true"
  enableTextEmbedding: "false"
  enableRerank: "false"
  vectorDim: "2048"

retrieval:
  defaultMode: hybrid

models:
  embedding:
    endpoint: ""
    model: ""
    dim: "2048"
  rerank:
    endpoint: ""
    model: ""
```

Secret 至少包含：

```text
DATABASE_URL
ADMIN_PASSWORD
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
POSTGRES_PASSWORD
MILVUS_TOKEN
MILVUS_MINIO_ACCESS_KEY_ID
MILVUS_MINIO_SECRET_ACCESS_KEY
```

Kubernetes 必须配置：

- Ingress TLS。
- NetworkPolicy：只允许 app pods 访问 PostgreSQL/Redis/S3/Milvus。
- PostgreSQL、Redis、MinIO、Milvus 不使用 LoadBalancer 暴露公网。
- Secret 使用集群级密钥管理或 sealed/encrypted secret。
- 日志采集要脱敏 Authorization、Cookie、Set-Cookie。

验证：

```bash
helm lint deploy/helm/openkb
helm template openkb deploy/helm/openkb --values values-public-test.yaml
```

## 5. 上线后立即执行

1. 登录初始管理员账号，立即更换一次性密码。
2. 关闭公开注册或改成邀请制：

```bash
curl -b cookie.txt -H 'Content-Type: application/json' \
  -X PUT https://kb-test.example.com/api/admin/auth-settings \
  -d '{
    "registration_enabled": false,
    "email_verification_required": true,
    "default_signup_status": "pending_activation",
    "invited_user_auto_active": false,
    "invite_required": true,
    "first_user_becomes_admin": false
  }'
```

3. 确认 `/api/auth/login` 多次错误密码会返回 `429 RATE_LIMITED`。
4. 确认跨域 Origin 不在 `CORS_ORIGINS` 中时被拒绝。
5. 确认 HTTP 自动跳 HTTPS，响应包含 HSTS。
6. 确认公网无法访问数据库、Redis、MinIO Console、Milvus、etcd。
7. 如启用 embedding/rerank，进入 `/app/admin/retrieval` 执行 probe，创建 index rebuild job，等待 index-worker 完成。
8. 只在需要时创建 Dify key 和 MCP PAT，并记录创建人、scope、过期时间。
9. 执行一次导入、索引 rebuild、搜索、MCP/Dify 检索烟测。

## 6. 安全验收清单

部署前：

- `pnpm audit --prod` 无 known vulnerabilities。
- `pnpm typecheck && pnpm build && pnpm test` 通过。
- 所有默认密码和默认 secret 已替换。
- `.env.public-test` 不提交 Git。
- `AUTH_COOKIE_SECURE=true`。
- `CORS_ORIGINS` 只包含负责人确认的 HTTPS URL。
- `OPENKB_ALLOW_LOCAL_CORS=false`。
- `TRUST_PROXY_HEADERS=true` 仅在反向代理会覆盖并清理 `X-Forwarded-*` 时开启。
- 管理员邮箱不是 `admin@openkb.local`。
- 不运行 `dev:seed`。

网络：

- 只有 80/443 对公网开放。
- API 可以公网访问，但只通过 HTTPS 反向代理。
- MCP/Dify 默认不开放；开放时必须 IP allowlist。
- PostgreSQL/Redis/MinIO/Milvus/etcd 不对公网开放。

应用：

- 公开注册关闭或邀请制。
- 管理员账号使用强密码。
- Session TTL 不超过测试平台需要，建议 7 天。
- 上传大小有限制，未知用户上传必须经外部扫描。
- Dify key 与 MCP PAT 设置最小 scope 和过期时间。
- 模型 provider key 不进入 OpenKB 数据库。
- 模型 endpoint 不对公网开放；rerank 只会收到最终权限检查后的候选文本。

运维：

- PostgreSQL 每日备份，至少一次恢复演练。
- S3 bucket 开启服务端加密和生命周期策略。
- 访问日志和审计日志保留周期已确认。
- 安全联系人和紧急下线流程已确认。

## 7. 已知限制与风险接受

以下能力当前未实现，公网测试时需要通过部署策略规避：

- 无生产 SMTP：不要开放依赖邮件闭环的公开注册。
- 无 2FA/SSO：管理员账号必须收紧来源 IP 和强密码。
- 无内置病毒扫描：不要对未知公众开放任意文件上传。
- MCP OAuth 未完整实现：公网 MCP 只使用短期、最小 scope PAT，或放在 VPN/内网。
- Dify key 管理 UI 未实现：key 创建、轮换和撤销需要命令行和审计流程。
- 复杂 PDF/Office/OCR adapter 未实现：不要承诺公网平台支持这些导入类型。
- CSRF token 未实现：公网部署必须使用 HTTPS、`SameSite=Lax` cookie、精确 CORS、同站点 Web/API 域名；不要配置跨站 `SameSite=None`，除非先补 CSRF 防护。

如需面向非受控公众开放，需要在本清单基础上补齐 SMTP、2FA/SSO、CSRF token、病毒扫描、WAF、监控告警和完整密钥管理流程。
