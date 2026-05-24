export type DifyHubDataset = {
  id: string;
  name: string;
  provider?: string | null;
  indexing_technique?: string | null;
  permission?: string | null;
  description?: string | null;
  external_knowledge_info?: DifyHubExternalKnowledgeInfo | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
};

export type DifyHubExternalKnowledgeInfo = {
  external_knowledge_id?: string | null;
  external_knowledge_api_id?: string | null;
  external_knowledge_api_name?: string | null;
  external_knowledge_api_endpoint?: string | null;
};

export type DifyHubMetadataField = {
  id?: string;
  name: string;
  type: "string" | "number" | "time";
  source?: string | null;
  enabled?: boolean | null;
};

export type DifyHubMetadataState = {
  doc_metadata: DifyHubMetadataField[];
  built_in_field_enabled: boolean;
};

export type DifyHubCreateExternalDatasetInput = {
  name: string;
  description?: string | null;
  external_knowledge_api_id: string;
  external_knowledge_id: string;
};

export class DifyHubClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DifyHubClientError";
  }
}

export class DifyHubClient {
  private static readonly datasetPageSize = 100;
  private static readonly maxDatasetPages = 100;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(input: { baseUrl: string; token: string; timeoutMs?: number }) {
    this.baseUrl = input.baseUrl.replace(/\/+$/, "");
    this.token = input.token;
    this.timeoutMs = input.timeoutMs ?? 15000;
  }

  async listDatasets(): Promise<DifyHubDataset[]> {
    const datasets: DifyHubDataset[] = [];
    for (let page = 1; page <= DifyHubClient.maxDatasetPages; page += 1) {
      const body = await this.request<unknown>(
        `/v1/datasets?page=${page}&limit=${DifyHubClient.datasetPageSize}`
      );
      const pageItems = normalizeArray<DifyHubDataset>(readProp(body, "data") ?? body);
      datasets.push(...pageItems);

      const hasMore = readBoolean(body, "has_more");
      if (hasMore === false) {
        return datasets;
      }
      if (hasMore === true) {
        continue;
      }

      const total = readNumber(body, "total");
      const limit = readNumber(body, "limit") ?? DifyHubClient.datasetPageSize;
      const currentPage = readNumber(body, "page") ?? page;
      if (total !== null && currentPage * limit >= total) {
        return datasets;
      }
      if (pageItems.length < DifyHubClient.datasetPageSize) {
        return datasets;
      }
    }
    throw new DifyHubClientError(
      502,
      "DIFY_DATASET_PAGINATION_LIMIT",
      "Dify dataset pagination exceeded the safety limit."
    );
  }

  async getDataset(id: string): Promise<DifyHubDataset> {
    const body = await this.request<unknown>(`/v1/datasets/${encodeURIComponent(id)}`);
    return normalizeObject<DifyHubDataset>(readProp(body, "data") ?? body);
  }

  async createExternalDataset(input: DifyHubCreateExternalDatasetInput): Promise<DifyHubDataset> {
    const body = await this.request<unknown>("/v1/datasets", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        description: input.description ?? "",
        provider: "external",
        permission: "only_me",
        indexing_technique: "economy",
        external_knowledge_api_id: input.external_knowledge_api_id,
        external_knowledge_id: input.external_knowledge_id
      })
    });
    return normalizeObject<DifyHubDataset>(readProp(body, "data") ?? body);
  }

  async deleteDataset(id: string): Promise<void> {
    await this.request<unknown>(`/v1/datasets/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async listMetadata(datasetId: string): Promise<DifyHubMetadataField[]> {
    return (await this.getMetadataState(datasetId)).doc_metadata;
  }

  async getMetadataState(datasetId: string): Promise<DifyHubMetadataState> {
    const body = await this.request<unknown>(
      `/v1/datasets/${encodeURIComponent(datasetId)}/metadata`
    );
    return {
      doc_metadata: normalizeArray<DifyHubMetadataField>(
        readProp(body, "doc_metadata") ?? readProp(body, "data") ?? body
      ),
      built_in_field_enabled: Boolean(readProp(body, "built_in_field_enabled"))
    };
  }

  async createMetadata(
    datasetId: string,
    field: Pick<DifyHubMetadataField, "name" | "type">
  ): Promise<DifyHubMetadataField> {
    const body = await this.request<unknown>(
      `/v1/datasets/${encodeURIComponent(datasetId)}/metadata`,
      {
        method: "POST",
        body: JSON.stringify({ name: field.name, type: field.type })
      }
    );
    return normalizeObject<DifyHubMetadataField>(readProp(body, "data") ?? body);
  }

  async deleteMetadata(datasetId: string, metadataId: string): Promise<void> {
    await this.request<unknown>(
      `/v1/datasets/${encodeURIComponent(datasetId)}/metadata/${encodeURIComponent(metadataId)}`,
      { method: "DELETE" }
    );
  }

  async listBuiltInMetadata(datasetId: string): Promise<DifyHubMetadataField[]> {
    const body = await this.request<unknown>(
      `/v1/datasets/${encodeURIComponent(datasetId)}/metadata/built-in`
    );
    return normalizeArray<DifyHubMetadataField>(
      readProp(body, "fields") ?? readProp(body, "data") ?? body
    );
  }

  async enableBuiltInMetadata(datasetId: string): Promise<void> {
    await this.request<unknown>(
      `/v1/datasets/${encodeURIComponent(datasetId)}/metadata/built-in/enable`,
      { method: "POST" }
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {})
        },
        signal: controller.signal
      });
      const text = await response.text();
      const body = parseJson(text);
      if (!response.ok) {
        const code = readString(body, "code") ?? `DIFY_HTTP_${response.status}`;
        const message =
          readString(body, "message") ||
          readString(body, "error") ||
          `Dify Service API request failed with HTTP ${response.status}.`;
        throw new DifyHubClientError(response.status, code, truncateForError(message));
      }
      return body as T;
    } catch (error) {
      if (error instanceof DifyHubClientError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new DifyHubClientError(504, "DIFY_TIMEOUT", "Dify Service API request timed out.");
      }
      throw new DifyHubClientError(
        502,
        "DIFY_REQUEST_FAILED",
        truncateForError(
          error instanceof Error ? error.message : "Dify Service API request failed."
        )
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function readProp(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function readString(value: unknown, key: string): string | null {
  const prop = readProp(value, key);
  return typeof prop === "string" ? prop : null;
}

function readNumber(value: unknown, key: string): number | null {
  const prop = readProp(value, key);
  return typeof prop === "number" && Number.isFinite(prop) ? prop : null;
}

function readBoolean(value: unknown, key: string): boolean | null {
  const prop = readProp(value, key);
  return typeof prop === "boolean" ? prop : null;
}

function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeObject<T>(value: unknown): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DifyHubClientError(502, "DIFY_RESPONSE_INVALID", "Dify response shape is invalid.");
  }
  return value as T;
}

function truncateForError(value: string): string {
  return value.length > 300 ? `${value.slice(0, 300)}...` : value;
}
