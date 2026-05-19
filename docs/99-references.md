# 99 — References

This project intentionally follows public product/API documentation where useful.

## Milkdown

- Milkdown getting started: https://milkdown.dev/docs/guide/getting-started
- Milkdown plugins: https://milkdown.dev/docs/plugin/using-plugins
- Milkdown CommonMark preset: https://milkdown.dev/docs/api/preset-commonmark
- Milkdown GFM preset: https://milkdown.dev/docs/api/preset-gfm

## Milvus

- Embedding Function overview: https://milvus.io/docs/embedding-function-overview.md
- Milvus Function API: https://milvus.io/api-reference/pymilvus/v2.6.x/MilvusClient/Function/Function.md
- TEI Ranker: https://milvus.io/docs/tei-ranker.md
- Model Ranker overview: https://milvus.io/docs/model-ranker-overview.md
- Manage aliases: https://milvus.io/docs/manage-aliases.md
- Filtered search: https://milvus.io/docs/filtered-search.md

## MCP

- MCP Authorization tutorial: https://modelcontextprotocol.io/docs/tutorials/security/authorization
- MCP Authorization spec: https://modelcontextprotocol.io/specification/draft/basic/authorization
- Yuque MCP Server README: https://github.com/yuque/yuque-mcp-server
- Yuque MCP doc tools: https://github.com/yuque/yuque-mcp-server/blob/main/src/tools/doc.ts
- Yuque MCP TOC tools: https://github.com/yuque/yuque-mcp-server/blob/main/src/tools/toc.ts
- Yuque MCP book tools: https://github.com/yuque/yuque-mcp-server/blob/main/src/tools/book.ts
- Yuque MCP note tools: https://github.com/yuque/yuque-mcp-server/blob/main/src/tools/note.ts
- Yuque API docs entry: https://www.yuque.com/yuque/developer/api

The Yuque MCP references above are public server/API references used for capability comparison. OpenKB does not copy Yuque internal implementation details.

## Codex

- AGENTS.md guide: https://developers.openai.com/codex/guides/agents-md
- Codex CLI: https://developers.openai.com/codex/cli

## OpenAI API

- Responses API: https://platform.openai.com/docs/api-reference/responses
- Chat Completions API: https://platform.openai.com/docs/api-reference/chat
- Embeddings API: https://platform.openai.com/docs/api-reference/embeddings

## Anthropic API

- Messages API: https://docs.anthropic.com/en/api/messages

## Dify

- Dify Docker Compose installation and upgrade notes: https://docs.dify.ai/getting-started/install-self-hosted/docker-compose
- Dify External Knowledge API: https://docs.dify.ai/en/use-dify/knowledge/external-knowledge-api
- Dify Connect to External Knowledge Base: https://docs.dify.ai/en/use-dify/knowledge/connect-external-knowledge-base
- Dify Chunking and Cleaning Text: https://docs.dify.ai/en/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text
- Dify Indexing Methods: https://docs.dify.ai/en/use-dify/knowledge/create-knowledge/setting-indexing-methods
- Dify Retrieval Test: https://docs.dify.ai/en/use-dify/knowledge/test-retrieval
- Dify 1.14.1 release: https://github.com/langgenius/dify/releases/tag/1.14.1
- Dify 1.14.1 source tag: https://github.com/langgenius/dify/tree/1.14.1

See also `docs/26-dify-external-knowledge-setup.zh-CN.md` for the OpenKB -> Dify External Knowledge setup and metadata compatibility checklist.
See also `docs/27-dify-knowledge-alignment.zh-CN.md` for the Dify knowledge processing and retrieval compatibility baseline.
See also `docs/28-dify-1.14.1-knowledge-gap-audit.zh-CN.md` for the local Dify 1.14.1 upgrade log, validation notes, and OpenKB engineering audit record.
