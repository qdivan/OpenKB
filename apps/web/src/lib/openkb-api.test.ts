import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiRequestError,
  apiFetch,
  createInvitation,
  createShareLink,
  clearAdminModelSecret,
  clearAdminImportToolSecret,
  createKnowledgeBaseMetadataField,
  createAdminUser,
  getShare,
  getDocumentVersion,
  getDifyFilterableMetadata,
  getDifySetupSummary,
  getDocumentMetadata,
  listKnowledgeBaseMetadataFields,
  deleteKnowledgeBaseMetadataField,
  isUnauthorized,
  listAdminImportTools,
  listAdminUsers,
  listDocumentVersions,
  listShareLinks,
  probeAdminImportTool,
  probeAdminModel,
  resetShareLink,
  restoreDocumentVersion,
  searchKnowledge,
  setAdminUserTenantRole,
  updateDocumentMetadata,
  updateAdminImportFormatRoute,
  updateAdminImportTool,
  updateAdminModelSetting,
  verifySharePassword
} from "./openkb-api";

describe("OpenKB API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends credentialed JSON requests to the API origin", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch("/api/workspaces", { method: "POST", body: JSON.stringify({ name: "Docs" }) })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/workspaces",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "content-type": "application/json" })
      })
    );
  });

  it("uses the configured CSRF cookie name for mutations", async () => {
    vi.stubEnv("NEXT_PUBLIC_OPENKB_CSRF_COOKIE_NAME", "custom_csrf");
    vi.stubGlobal("document", { cookie: "custom_csrf=csrf-token" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/workspaces", { method: "POST", body: JSON.stringify({ name: "Docs" }) });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/workspaces",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-openkb-csrf": "csrf-token" })
      })
    );
  });

  it("keeps API error bodies available to callers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "VERSION_CONFLICT" }), { status: 409 })
      )
    );

    await expect(apiFetch("/api/documents/doc_1")).rejects.toMatchObject({
      status: 409,
      body: { error: "VERSION_CONFLICT" }
    });
  });

  it("normalizes network failures into API request errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    await expect(apiFetch("/api/workspaces")).rejects.toMatchObject({
      status: 0,
      body: { error: "NETWORK_ERROR" }
    });
  });

  it("recognizes unauthorized errors", () => {
    expect(isUnauthorized(new ApiRequestError(401, { error: "UNAUTHORIZED" }))).toBe(true);
    expect(isUnauthorized(new ApiRequestError(403, { error: "FORBIDDEN" }))).toBe(false);
  });

  it("posts search requests with JSON and credentials", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ query: "MCP", top_k: 10, results: [] }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchKnowledge({ query: "MCP", knowledge_base_ids: ["kb_1"] })).resolves.toEqual({
      query: "MCP",
      top_k: 10,
      results: []
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/search",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({ query: "MCP", knowledge_base_ids: ["kb_1"] })
      })
    );
  });

  it("deduplicates simultaneous GET requests while they are in flight", async () => {
    let resolveResponse!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => pendingResponse);
    vi.stubGlobal("fetch", fetchMock);

    const firstRequest = apiFetch<{ ok: true }>("/api/workspaces");
    const secondRequest = apiFetch<{ ok: true }>("/api/workspaces");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse(new Response(JSON.stringify({ ok: true })));
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      { ok: true },
      { ok: true }
    ]);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    await expect(apiFetch<{ ok: true }>("/api/workspaces")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("builds admin user management requests", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0 })));
    vi.stubGlobal("fetch", fetchMock);

    await listAdminUsers({ status: "active", role: "member", query: "openkb", limit: 20 });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/admin/users?status=active&role=member&query=openkb&limit=20",
      expect.objectContaining({ credentials: "include" })
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: "u1" }, reset_link: "http://example.test" }))
    );
    await createAdminUser({ email: "user@example.com", tenant_role: "member" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/admin/users",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@example.com", tenant_role: "member" })
      })
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: "u1" }, tenant_role: "tenant_admin" }))
    );
    await setAdminUserTenantRole("u1", "tenant_admin");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/admin/users/u1/tenant-role",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ role: "tenant_admin" })
      })
    );
  });

  it("posts transient admin model probe settings without saving them", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ configured: true, ok: true }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await probeAdminModel("embedding", {
      provider: "openai_compatible",
      enabled: true,
      endpoint: "http://model.test/v1/embeddings",
      model: "embedding-model",
      embedding_dim: 1024,
      embedding_batch_size: 8,
      api_key: "temporary-key"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/admin/models/embedding/probe",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({
          provider: "openai_compatible",
          enabled: true,
          endpoint: "http://model.test/v1/embeddings",
          model: "embedding-model",
          embedding_dim: 1024,
          embedding_batch_size: 8,
          api_key: "temporary-key"
        })
      })
    );
  });

  it("builds admin model save and secret clear requests", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            kind: "language",
            provider: "openai_responses",
            source: "db",
            enabled: true
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateAdminModelSetting("language", {
      provider: "openai_responses",
      enabled: true,
      endpoint: "https://api.openai.com/v1/responses",
      model: "gpt-4.1-mini",
      llm_max_output_tokens: 64,
      llm_temperature: 0.2,
      api_key: "new-secret"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/admin/models/language",
      expect.objectContaining({
        credentials: "include",
        method: "PUT",
        body: JSON.stringify({
          provider: "openai_responses",
          enabled: true,
          endpoint: "https://api.openai.com/v1/responses",
          model: "gpt-4.1-mini",
          llm_max_output_tokens: 64,
          llm_temperature: 0.2,
          api_key: "new-secret"
        })
      })
    );

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          kind: "language",
          provider: "openai_responses",
          source: "env",
          enabled: false
        })
      )
    );

    await clearAdminModelSecret("language");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/admin/models/language/secret",
      expect.objectContaining({
        credentials: "include",
        method: "DELETE"
      })
    );
  });

  it("builds admin import tool requests", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tools: [], routes: [] })));
    vi.stubGlobal("fetch", fetchMock);

    await listAdminImportTools();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/admin/import-tools",
      expect.objectContaining({ credentials: "include" })
    );

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tool_key: "mineru" })));
    await updateAdminImportTool("mineru", {
      enabled: true,
      mode: "http_api",
      endpoint: "https://mineru.example/convert",
      timeout_ms: 120000,
      max_file_mb: 100,
      api_key: "temporary"
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/admin/import-tools/mineru",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          enabled: true,
          mode: "http_api",
          endpoint: "https://mineru.example/convert",
          timeout_ms: 120000,
          max_file_mb: 100,
          api_key: "temporary"
        })
      })
    );

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ configured: true, ok: true })));
    await probeAdminImportTool("mineru");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/admin/import-tools/mineru/probe",
      expect.objectContaining({ method: "POST" })
    );

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tool_key: "mineru" })));
    await clearAdminImportToolSecret("mineru");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/admin/import-tools/mineru/secret",
      expect.objectContaining({ method: "DELETE" })
    );

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ format: "pdf" })));
    await updateAdminImportFormatRoute("pdf", {
      enabled: true,
      primary_tool: "markitdown",
      fallback_tools: ["mineru"]
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/admin/import-tools/routes/pdf",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          enabled: true,
          primary_tool: "markitdown",
          fallback_tools: ["mineru"]
        })
      })
    );
  });

  it("builds Dify setup and metadata schema requests", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            endpoint_for_dify_ui: "http://localhost:4200",
            fields: [],
            built_in: [],
            custom: []
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await getDifySetupSummary();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/admin/dify/setup",
      expect.objectContaining({ credentials: "include" })
    );

    await getDifyFilterableMetadata({ knowledge_base_id: "kb_1" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/admin/dify/filterable-metadata?knowledge_base_id=kb_1",
      expect.objectContaining({ credentials: "include" })
    );

    await listKnowledgeBaseMetadataFields("kb_1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/knowledge-bases/kb_1/metadata-fields",
      expect.objectContaining({ credentials: "include" })
    );

    await createKnowledgeBaseMetadataField("kb_1", {
      name: "dynasty",
      type: "string",
      sort_order: 1
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/knowledge-bases/kb_1/metadata-fields",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "dynasty", type: "string", sort_order: 1 })
      })
    );

    await deleteKnowledgeBaseMetadataField("kb_1", "field_1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/knowledge-bases/kb_1/metadata-fields/field_1",
      expect.objectContaining({ method: "DELETE" })
    );

    await getDocumentMetadata("doc_1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/documents/doc_1/metadata",
      expect.objectContaining({ credentials: "include" })
    );

    await updateDocumentMetadata("doc_1", { values: { dynasty: "shu" } });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/documents/doc_1/metadata",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ values: { dynasty: "shu" } })
      })
    );
  });

  it("builds document version history requests", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([{ id: "v1", version_no: 1, is_current: true }]))
    );
    vi.stubGlobal("fetch", fetchMock);

    await listDocumentVersions("doc_1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/documents/doc_1/versions",
      expect.objectContaining({ credentials: "include" })
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "v1", version_no: 1, markdown: "# Old" }))
    );
    await getDocumentVersion("doc_1", "v1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/documents/doc_1/versions/v1",
      expect.objectContaining({ credentials: "include" })
    );

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "doc_1" })));
    await restoreDocumentVersion("doc_1", "v1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/documents/doc_1/restore/v1",
      expect.objectContaining({
        credentials: "include",
        method: "POST"
      })
    );
  });

  it("builds collaboration and share requests", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await createInvitation("knowledge_base", "kb_1", {
      email: "new@example.com",
      role: "viewer",
      require_approval: true
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/objects/knowledge_base/kb_1/invitations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          role: "viewer",
          require_approval: true
        })
      })
    );

    await listShareLinks("document", "doc_1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/objects/document/doc_1/share-links",
      expect.objectContaining({ credentials: "include" })
    );

    await createShareLink("document", "doc_1", {
      password: "reader",
      require_login: true,
      restrict_to_workspace_members: true
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/objects/document/doc_1/share-links",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          password: "reader",
          require_login: true,
          restrict_to_workspace_members: true
        })
      })
    );

    await getShare("token", "doc_1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/share/token?document_id=doc_1",
      expect.objectContaining({ credentials: "include" })
    );

    await verifySharePassword("token", "reader");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/share/token/verify-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ password: "reader" })
      })
    );

    await resetShareLink("share_1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4000/api/share-links/share_1/reset",
      expect.objectContaining({ method: "POST" })
    );
  });
});
