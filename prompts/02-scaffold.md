Create the initial monorepo scaffold only.

Use:
- apps/web
- apps/api
- apps/mcp-server
- apps/dify-adapter
- workers/import-worker
- workers/index-worker
- packages/shared
- packages/db
- packages/auth
- packages/permissions
- packages/editor
- packages/markdown
- packages/milvus
- packages/retrieval
- deploy/docker-compose
- deploy/helm

Requirements:
- TypeScript for web/api/shared packages.
- Next.js for apps/web.
- NestJS with Fastify adapter for apps/api unless you find a strong reason otherwise.
- PostgreSQL migration setup.
- Redis queue placeholder.
- Milvus client package placeholder.
- No business features yet.
- Add README sections explaining how to run locally.
- Add tests only for smoke checks.

Do not implement editor, permissions, MCP, Dify, or Milvus indexing yet.
