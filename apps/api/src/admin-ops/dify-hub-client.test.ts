import { afterEach, describe, expect, it, vi } from "vitest";

import { DifyHubClient, DifyHubClientError } from "./dify-hub-client";

describe("DifyHubClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists datasets through the Dify Service API without exposing the token", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "dataset-1",
                name: "openkb-test",
                provider: "external",
                external_knowledge_info: {
                  external_knowledge_id: "openkb-demo",
                  external_knowledge_api_id: "api-1"
                }
              }
            ]
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DifyHubClient({
      baseUrl: "http://localhost:18080/",
      token: "secret-token"
    });

    await expect(client.listDatasets()).resolves.toMatchObject([
      { id: "dataset-1", provider: "external" }
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:18080/v1/datasets?page=1&limit=100",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret-token" })
      })
    );
  });

  it("creates external datasets with Service API external knowledge fields", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: "dataset-2",
            name: "OpenKB Demo",
            provider: "external"
          }),
          { status: init?.method === "POST" ? 200 : 500 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DifyHubClient({ baseUrl: "http://localhost:18080", token: "token" });
    await client.createExternalDataset({
      name: "OpenKB Demo",
      description: "demo",
      external_knowledge_api_id: "external-api-id",
      external_knowledge_id: "openkb-demo"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:18080/v1/datasets",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "OpenKB Demo",
          description: "demo",
          provider: "external",
          permission: "only_me",
          indexing_technique: "economy",
          external_knowledge_api_id: "external-api-id",
          external_knowledge_id: "openkb-demo"
        })
      })
    );
  });

  it("reads all Dify dataset pages", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get("page");
      return new Response(
        JSON.stringify(
          page === "1"
            ? {
                data: [{ id: "dataset-1", name: "First", provider: "external" }],
                has_more: true
              }
            : {
                data: [{ id: "dataset-2", name: "Second", provider: "external" }],
                has_more: false
              }
        )
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new DifyHubClient({ baseUrl: "http://localhost:18080", token: "token" });

    await expect(client.listDatasets()).resolves.toMatchObject([
      { id: "dataset-1" },
      { id: "dataset-2" }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops dataset pagination from total page metadata", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      const data =
        page === 1
          ? Array.from({ length: 100 }, (_, index) => ({
              id: `dataset-${index}`,
              name: `Page 1 Item ${index}`,
              provider: "external"
            }))
          : [{ id: "dataset-final", name: "Final", provider: "external" }];
      return new Response(
        JSON.stringify({
          data,
          page,
          limit: 100,
          total: 101
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new DifyHubClient({ baseUrl: "http://localhost:18080", token: "token" });

    const result = await client.listDatasets();
    expect(result).toHaveLength(101);
    expect(result[0]).toMatchObject({ id: "dataset-0" });
    expect(result[100]).toMatchObject({ id: "dataset-final" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops dataset pagination on a short page when no pagination flags are present", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "dataset-1",
                name: "Only page",
                provider: "external"
              }
            ]
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DifyHubClient({ baseUrl: "http://localhost:18080", token: "token" });

    await expect(client.listDatasets()).resolves.toMatchObject([{ id: "dataset-1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops dataset pagination from malformed endless responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: Array.from({ length: 100 }, (_, index) => ({
                id: `dataset-${index}`,
                name: `Dataset ${index}`,
                provider: "external"
              })),
              has_more: true
            })
          )
      )
    );

    const client = new DifyHubClient({ baseUrl: "http://localhost:18080", token: "token" });

    await expect(client.listDatasets()).rejects.toMatchObject({
      code: "DIFY_DATASET_PAGINATION_LIMIT"
    } satisfies Partial<DifyHubClientError>);
  });

  it("reads Dify metadata state from the service API response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/metadata/built-in")) {
          return new Response(
            JSON.stringify({
              fields: [
                { name: "document_name", type: "string" },
                { name: "upload_date", type: "time" }
              ]
            })
          );
        }
        return new Response(
          JSON.stringify({
            doc_metadata: [{ id: "field-1", name: "employee_id", type: "string" }],
            built_in_field_enabled: false
          })
        );
      })
    );

    const client = new DifyHubClient({ baseUrl: "http://localhost:18080", token: "token" });

    await expect(client.getMetadataState("dataset-1")).resolves.toEqual({
      doc_metadata: [{ id: "field-1", name: "employee_id", type: "string" }],
      built_in_field_enabled: false
    });
    await expect(client.listBuiltInMetadata("dataset-1")).resolves.toEqual([
      { name: "document_name", type: "string" },
      { name: "upload_date", type: "time" }
    ]);
  });

  it("maps Dify errors to safe client errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "unauthorized", message: "bad token" }), {
            status: 401
          })
      )
    );

    const client = new DifyHubClient({ baseUrl: "http://localhost:18080", token: "token" });
    await expect(client.listMetadata("dataset-1")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
      message: "bad token"
    } satisfies Partial<DifyHubClientError>);
  });
});
