import {
  DataType,
  FunctionType,
  IndexType,
  MetricType,
  MilvusClient,
  RRFRanker,
  type FieldType,
  type FunctionObject,
  type ResStatus
} from "@zilliz/milvus2-sdk-node";

export const MILVUS_PACKAGE_NAME = "@openkb/milvus";
export const MILVUS_ACTIVE_ALIAS = "openkb_chunks_active";
export const MILVUS_PRIMARY_KEY_FIELD = "id";
export const MILVUS_CHUNK_ID_FIELD = "chunk_id";
export const MILVUS_SCHEMA_VERSION = "v1";

export const MILVUS_COLLECTION_FIELDS = {
  id: MILVUS_PRIMARY_KEY_FIELD,
  chunkId: MILVUS_CHUNK_ID_FIELD,
  tenantId: "tenant_id",
  workspaceId: "workspace_id",
  knowledgeBaseId: "knowledge_base_id",
  documentId: "document_id",
  versionId: "version_id",
  isCurrent: "is_current",
  docStatus: "doc_status",
  title: "title",
  headingPath: "heading_path",
  contentText: "content_text",
  contentMarkdown: "content_markdown",
  metadata: "metadata",
  accessPrincipals: "access_principals",
  sparseVector: "sparse_vector",
  denseVector: "dense_vector",
  createdAt: "created_at",
  updatedAt: "updated_at"
} as const;

export type MilvusConfig = {
  uri: string;
  token?: string;
  database?: string;
  activeAlias: string;
  collectionPrefix: string;
  schemaVersion: string;
  vectorDim: number;
  enableBm25: boolean;
  enableDenseVector: boolean;
  enableTextEmbedding: boolean;
  enableRerank: boolean;
  timeoutMs: number;
};

export type MilvusCollectionSchema = {
  fields: FieldType[];
  functions: FunctionObject[];
  indexParams: Array<{
    collection_name: string;
    field_name: string;
    index_name?: string;
    index_type: string;
    metric_type?: string;
    params?: Record<string, string | number | boolean>;
  }>;
};

export type MilvusChunkRecord = {
  id: string;
  chunk_id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  document_id: string;
  version_id: string;
  is_current: boolean;
  doc_status: string;
  title: string;
  heading_path: string[];
  content_text: string;
  content_markdown: string;
  metadata: Record<string, unknown>;
  access_principals: string[];
  dense_vector?: number[];
  created_at: number;
  updated_at: number;
};

export type MilvusSearchMode = "bm25" | "dense" | "hybrid";

export type MilvusSearchChunksInput = {
  query: string;
  mode?: MilvusSearchMode;
  queryVector?: number[];
  tenantId: string;
  accessPrincipals: string[];
  knowledgeBaseIds?: string[];
  filters?: MilvusSearchFilters;
  limit: number;
  alias?: string;
};

export type MilvusSearchScopedChunksInput = {
  query: string;
  mode?: MilvusSearchMode;
  queryVector?: number[];
  tenantId: string;
  knowledgeBaseIds: string[];
  filters?: MilvusSearchFilters;
  limit: number;
  alias?: string;
};

export type MilvusSearchFilters = {
  tags?: string[];
};

export type MilvusSearchChunkResult = {
  id: string;
  chunk_id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  document_id: string;
  version_id: string;
  title: string;
  heading_path: string[];
  content_text: string;
  content_markdown: string;
  metadata: Record<string, unknown>;
  updated_at: number;
  score: number;
};

export type MilvusHealth = {
  ok: boolean;
  uri: string;
  database?: string;
  version?: string;
  reason?: string;
};

export type MilvusPackageStatus = {
  packageName: typeof MILVUS_PACKAGE_NAME;
  activeAlias: typeof MILVUS_ACTIVE_ALIAS;
  primaryKeyField: typeof MILVUS_PRIMARY_KEY_FIELD;
  chunkIdField: typeof MILVUS_CHUNK_ID_FIELD;
  storesEmbeddingProviderKeys: false;
};

export const milvusPackageStatus: MilvusPackageStatus = {
  packageName: MILVUS_PACKAGE_NAME,
  activeAlias: MILVUS_ACTIVE_ALIAS,
  primaryKeyField: MILVUS_PRIMARY_KEY_FIELD,
  chunkIdField: MILVUS_CHUNK_ID_FIELD,
  storesEmbeddingProviderKeys: false
};

export type MilvusErrorCode =
  | "ALIAS_NOT_FOUND"
  | "COLLECTION_ALREADY_EXISTS"
  | "COLLECTION_NOT_FOUND"
  | "INVALID_INPUT"
  | "MILVUS_CONNECTION_FAILED"
  | "MILVUS_OPERATION_FAILED"
  | "SEARCH_INDEX_NOT_READY"
  | "PROVIDER_SECRET_FORBIDDEN";

export class MilvusError extends Error {
  constructor(
    public readonly code: MilvusErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export class OpenKBMilvus {
  constructor(
    public readonly config: MilvusConfig = getMilvusConfig(),
    private readonly client: MilvusClient = createMilvusClient(config)
  ) {}

  async health(): Promise<MilvusHealth> {
    try {
      const [health, version] = await Promise.all([
        this.client.checkHealth(),
        this.client.getVersion().catch(() => ({ version: undefined }))
      ]);
      return {
        ok: Boolean(health.isHealthy),
        uri: this.config.uri,
        database: this.config.database,
        version: version.version,
        reason: health.reasons?.join(", ") || undefined
      };
    } catch (error) {
      return {
        ok: false,
        uri: this.config.uri,
        database: this.config.database,
        reason: error instanceof Error ? error.message : "Milvus connection failed."
      };
    }
  }

  async hasCollection(collectionName: string): Promise<boolean> {
    const response = await this.client.hasCollection({ collection_name: collectionName });
    assertStatus(response.status);
    return Boolean(response.value);
  }

  async createChunkCollection(collectionName: string): Promise<void> {
    assertMilvusName(collectionName, "collection_name");
    if (await this.hasCollection(collectionName)) {
      throw new MilvusError(
        "COLLECTION_ALREADY_EXISTS",
        "Target Milvus collection already exists.",
        409
      );
    }

    const schema = buildOpenKBMilvusSchema({
      collectionName,
      vectorDim: this.config.vectorDim,
      enableBm25: this.config.enableBm25,
      enableDenseVector: this.config.enableDenseVector,
      enableTextEmbedding: this.config.enableTextEmbedding,
      enableRerank: this.config.enableRerank
    });

    assertNoProviderSecrets(schema.functions);
    assertStatus(
      await this.client.createCollection({
        collection_name: collectionName,
        schema: schema.fields,
        functions: schema.functions,
        enable_dynamic_field: false
      })
    );

    for (const indexParam of schema.indexParams) {
      assertStatus(await this.client.createIndex(indexParam));
    }
  }

  async insertChunks(collectionName: string, records: MilvusChunkRecord[]): Promise<number> {
    if (records.length === 0) {
      return 0;
    }

    assertStatus(
      (
        await this.client.insert({
          collection_name: collectionName,
          data: records
        })
      ).status
    );
    return records.length;
  }

  async flush(collectionName: string): Promise<void> {
    assertStatus(
      (
        await this.client.flush({
          collection_names: [collectionName]
        })
      ).status
    );
  }

  async loadCollection(collectionName: string): Promise<void> {
    assertStatus(await this.client.loadCollection({ collection_name: collectionName }));
  }

  async count(collectionName: string): Promise<number> {
    const response = await this.client.getCollectionStatistics({
      collection_name: collectionName
    });
    assertStatus(response.status);
    const rowCount = response.data?.row_count ?? response.data?.rowCount;
    if (typeof rowCount === "number") {
      return rowCount;
    }
    if (typeof rowCount === "string") {
      return Number(rowCount);
    }

    const stat = response.stats.find((item) => item.key === "row_count");
    return stat ? Number(stat.value) : 0;
  }

  async describeAlias(alias: string): Promise<{ alias: string; collection: string } | null> {
    assertMilvusName(alias, "alias");
    try {
      const collections = await this.client.showCollections();
      assertStatus(collections.status);

      for (const collection of collections.data) {
        const aliases = await this.client.listAliases({
          collection_name: collection.name
        });
        assertStatus(aliases.status);
        if (aliases.aliases.includes(alias)) {
          return {
            alias,
            collection: collection.name
          };
        }
      }

      return null;
    } catch (error) {
      if (isMilvusNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async switchAlias(alias: string, collectionName: string): Promise<void> {
    assertMilvusName(alias, "alias");
    assertMilvusName(collectionName, "collection_name");
    if (!(await this.hasCollection(collectionName))) {
      throw new MilvusError("COLLECTION_NOT_FOUND", "Target collection was not found.", 404);
    }

    const current = await this.describeAlias(alias);
    const status = current
      ? await this.client.alterAlias({ alias, collection_name: collectionName })
      : await this.client.createAlias({ alias, collection_name: collectionName });
    assertStatus(status);
  }

  async searchChunks(input: MilvusSearchChunksInput): Promise<MilvusSearchChunkResult[]> {
    const alias = input.alias ?? this.config.activeAlias;
    assertMilvusName(alias, "alias");

    const activeAlias = await this.describeAlias(alias);
    if (!activeAlias) {
      throw new MilvusError("SEARCH_INDEX_NOT_READY", "Milvus active alias is not ready.", 503);
    }

    return this.searchByMode({
      alias,
      query: input.query,
      queryVector: input.queryVector,
      mode: input.mode ?? "bm25",
      limit: input.limit,
      filter: buildChunkSearchFilter({
        tenantId: input.tenantId,
        accessPrincipals: input.accessPrincipals,
        knowledgeBaseIds: input.knowledgeBaseIds,
        filters: input.filters
      })
    });
  }

  async searchScopedChunks(
    input: MilvusSearchScopedChunksInput
  ): Promise<MilvusSearchChunkResult[]> {
    const alias = input.alias ?? this.config.activeAlias;
    assertMilvusName(alias, "alias");

    const activeAlias = await this.describeAlias(alias);
    if (!activeAlias) {
      throw new MilvusError("SEARCH_INDEX_NOT_READY", "Milvus active alias is not ready.", 503);
    }

    return this.searchByMode({
      alias,
      query: input.query,
      queryVector: input.queryVector,
      mode: input.mode ?? "bm25",
      limit: input.limit,
      filter: buildScopedChunkSearchFilter({
        tenantId: input.tenantId,
        knowledgeBaseIds: input.knowledgeBaseIds,
        filters: input.filters
      })
    });
  }

  private async searchByMode(input: {
    alias: string;
    query: string;
    queryVector?: number[];
    mode: MilvusSearchMode;
    filter: string;
    limit: number;
  }): Promise<MilvusSearchChunkResult[]> {
    if (input.mode === "bm25") {
      const response = await this.client.search({
        collection_name: input.alias,
        data: [input.query],
        anns_field: MILVUS_COLLECTION_FIELDS.sparseVector,
        metric_type: MetricType.BM25,
        limit: input.limit,
        filter: input.filter,
        output_fields: SEARCH_OUTPUT_FIELDS
      });
      assertStatus(response.status);

      return flattenSearchResults(response.results).map(normalizeSearchResult);
    }

    const queryVector = assertDenseQueryVector(input.queryVector, this.config.vectorDim);

    if (input.mode === "dense") {
      const response = await this.client.search({
        collection_name: input.alias,
        data: [queryVector],
        anns_field: MILVUS_COLLECTION_FIELDS.denseVector,
        metric_type: MetricType.COSINE,
        limit: input.limit,
        filter: input.filter,
        output_fields: SEARCH_OUTPUT_FIELDS
      });
      assertStatus(response.status);

      return flattenSearchResults(response.results).map(normalizeSearchResult);
    }

    const response = await this.client.hybridSearch({
      collection_name: input.alias,
      data: [
        {
          data: input.query,
          anns_field: MILVUS_COLLECTION_FIELDS.sparseVector,
          expr: input.filter
        },
        {
          data: queryVector,
          anns_field: MILVUS_COLLECTION_FIELDS.denseVector,
          expr: input.filter,
          params: { metric_type: MetricType.COSINE }
        }
      ],
      limit: input.limit,
      output_fields: SEARCH_OUTPUT_FIELDS,
      rerank: RRFRanker(60)
    });
    assertStatus(response.status);

    return flattenSearchResults(response.results).map(normalizeSearchResult);
  }
}

export function getMilvusConfig(env: NodeJS.ProcessEnv = process.env): MilvusConfig {
  return {
    uri: normalizeMilvusUri(env.MILVUS_URI || "localhost:19530"),
    token: emptyToUndefined(env.MILVUS_TOKEN),
    database: emptyToUndefined(env.MILVUS_DATABASE),
    activeAlias: env.MILVUS_ACTIVE_ALIAS || MILVUS_ACTIVE_ALIAS,
    collectionPrefix: env.MILVUS_COLLECTION_PREFIX || "openkb_chunks",
    schemaVersion: env.MILVUS_SCHEMA_VERSION || MILVUS_SCHEMA_VERSION,
    vectorDim: parsePositiveInt(env.OPENKB_EMBEDDING_DIM ?? env.MILVUS_VECTOR_DIM, 2048),
    enableBm25: parseBoolean(env.MILVUS_ENABLE_BM25, true),
    enableDenseVector: Boolean(
      emptyToUndefined(env.OPENKB_EMBEDDING_ENDPOINT) &&
      emptyToUndefined(env.OPENKB_EMBEDDING_MODEL)
    ),
    enableTextEmbedding: false,
    enableRerank: false,
    timeoutMs: parsePositiveInt(env.MILVUS_TIMEOUT_MS, 30_000)
  };
}

export function createMilvusClient(config: MilvusConfig = getMilvusConfig()): MilvusClient {
  return new MilvusClient({
    address: config.uri,
    token: config.token,
    database: config.database,
    timeout: config.timeoutMs
  });
}

export function createOpenKBMilvus(config: MilvusConfig = getMilvusConfig()): OpenKBMilvus {
  return new OpenKBMilvus(config);
}

export function buildOpenKBMilvusSchema(input: {
  collectionName: string;
  vectorDim: number;
  enableBm25?: boolean;
  enableDenseVector?: boolean;
  enableTextEmbedding?: boolean;
  enableRerank?: boolean;
}): MilvusCollectionSchema {
  const fields: FieldType[] = [
    varcharField(MILVUS_COLLECTION_FIELDS.id, 96, {
      is_primary_key: true,
      autoID: false
    }),
    varcharField(MILVUS_COLLECTION_FIELDS.chunkId, 96),
    varcharField(MILVUS_COLLECTION_FIELDS.tenantId, 96),
    varcharField(MILVUS_COLLECTION_FIELDS.workspaceId, 96),
    varcharField(MILVUS_COLLECTION_FIELDS.knowledgeBaseId, 96),
    varcharField(MILVUS_COLLECTION_FIELDS.documentId, 96),
    varcharField(MILVUS_COLLECTION_FIELDS.versionId, 96),
    { name: MILVUS_COLLECTION_FIELDS.isCurrent, data_type: DataType.Bool },
    varcharField(MILVUS_COLLECTION_FIELDS.docStatus, 32),
    varcharField(MILVUS_COLLECTION_FIELDS.title, 512),
    {
      name: MILVUS_COLLECTION_FIELDS.headingPath,
      data_type: DataType.Array,
      element_type: DataType.VarChar,
      max_capacity: 16,
      max_length: 512
    },
    varcharField(MILVUS_COLLECTION_FIELDS.contentText, 65_535, {
      enable_analyzer: true,
      enable_match: true
    }),
    varcharField(MILVUS_COLLECTION_FIELDS.contentMarkdown, 65_535),
    { name: MILVUS_COLLECTION_FIELDS.metadata, data_type: DataType.JSON },
    {
      name: MILVUS_COLLECTION_FIELDS.accessPrincipals,
      data_type: DataType.Array,
      element_type: DataType.VarChar,
      max_capacity: 256,
      max_length: 256
    },
    { name: MILVUS_COLLECTION_FIELDS.createdAt, data_type: DataType.Int64 },
    { name: MILVUS_COLLECTION_FIELDS.updatedAt, data_type: DataType.Int64 }
  ];

  const functions: FunctionObject[] = [];
  const indexParams: MilvusCollectionSchema["indexParams"] = [];

  if (input.enableBm25 ?? true) {
    fields.push({
      name: MILVUS_COLLECTION_FIELDS.sparseVector,
      data_type: DataType.SparseFloatVector,
      is_function_output: true
    });
    functions.push({
      name: "openkb_bm25",
      description: "OpenKB BM25 sparse vector function.",
      type: FunctionType.BM25,
      input_field_names: [MILVUS_COLLECTION_FIELDS.contentText],
      output_field_names: [MILVUS_COLLECTION_FIELDS.sparseVector],
      params: {}
    });
    indexParams.push({
      collection_name: input.collectionName,
      field_name: MILVUS_COLLECTION_FIELDS.sparseVector,
      index_name: "openkb_sparse_bm25_idx",
      index_type: IndexType.SPARSE_INVERTED_INDEX,
      metric_type: MetricType.BM25,
      params: {}
    });
  }

  if (input.enableDenseVector ?? input.enableTextEmbedding) {
    fields.push({
      name: MILVUS_COLLECTION_FIELDS.denseVector,
      data_type: DataType.FloatVector,
      dim: input.vectorDim
    });
    indexParams.push({
      collection_name: input.collectionName,
      field_name: MILVUS_COLLECTION_FIELDS.denseVector,
      index_name: "openkb_dense_idx",
      index_type: IndexType.AUTOINDEX,
      metric_type: MetricType.COSINE,
      params: {}
    });
  }

  return {
    fields,
    functions,
    indexParams
  };
}

export function createCollectionName(
  input: {
    prefix?: string;
    schemaVersion?: string;
    timestamp?: Date;
  } = {}
): string {
  const prefix = sanitizeMilvusIdentifier(input.prefix || "openkb_chunks");
  const version = sanitizeMilvusIdentifier(input.schemaVersion || MILVUS_SCHEMA_VERSION);
  const stamp = (input.timestamp ?? new Date())
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  return `${prefix}_${version}_${stamp}`;
}

export function assertNoProviderSecrets(value: unknown): void {
  const text = JSON.stringify(value).toLowerCase();
  if (/(api[_-]?key|secret|password|credential|bearer|token)/.test(text)) {
    throw new MilvusError(
      "PROVIDER_SECRET_FORBIDDEN",
      "Milvus provider credentials must not be stored in OpenKB metadata.",
      400
    );
  }
}

export function assertMilvusName(value: string, fieldName: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,254}$/.test(value)) {
    throw new MilvusError("INVALID_INPUT", `${fieldName} is not a valid Milvus identifier.`, 400);
  }
}

export function buildChunkSearchFilter(input: {
  tenantId: string;
  accessPrincipals: string[];
  knowledgeBaseIds?: string[];
  filters?: MilvusSearchFilters;
}): string {
  const principalFilterValues =
    input.accessPrincipals.length > 0 ? input.accessPrincipals : ["__openkb_no_access__"];
  const clauses = buildChunkBaseFilterClauses(input.tenantId);
  clauses.push(
    `ARRAY_CONTAINS_ANY(${MILVUS_COLLECTION_FIELDS.accessPrincipals}, ${toMilvusStringArray(
      principalFilterValues
    )})`
  );

  if (input.knowledgeBaseIds && input.knowledgeBaseIds.length > 0) {
    clauses.push(
      `${MILVUS_COLLECTION_FIELDS.knowledgeBaseId} in ${toMilvusStringArray(
        input.knowledgeBaseIds
      )}`
    );
  }

  if (input.filters?.tags && input.filters.tags.length > 0) {
    clauses.push(
      `json_contains_any(${MILVUS_COLLECTION_FIELDS.metadata}["tags"], ${toMilvusStringArray(
        input.filters.tags
      )})`
    );
  }

  return clauses.join(" and ");
}

export function buildScopedChunkSearchFilter(input: {
  tenantId: string;
  knowledgeBaseIds: string[];
  filters?: MilvusSearchFilters;
}): string {
  const clauses = buildChunkBaseFilterClauses(input.tenantId);
  const knowledgeBaseIds =
    input.knowledgeBaseIds.length > 0 ? input.knowledgeBaseIds : ["__openkb_no_kb_scope__"];
  clauses.push(
    `${MILVUS_COLLECTION_FIELDS.knowledgeBaseId} in ${toMilvusStringArray(knowledgeBaseIds)}`
  );
  appendMetadataFilterClauses(clauses, input.filters);
  return clauses.join(" and ");
}

function buildChunkBaseFilterClauses(tenantId: string): string[] {
  return [
    `${MILVUS_COLLECTION_FIELDS.tenantId} == ${toMilvusString(tenantId)}`,
    `${MILVUS_COLLECTION_FIELDS.isCurrent} == true`,
    `${MILVUS_COLLECTION_FIELDS.docStatus} == "published"`
  ];
}

function appendMetadataFilterClauses(clauses: string[], filters: MilvusSearchFilters | undefined) {
  if (filters?.tags && filters.tags.length > 0) {
    clauses.push(
      `json_contains_any(${MILVUS_COLLECTION_FIELDS.metadata}["tags"], ${toMilvusStringArray(
        filters.tags
      )})`
    );
  }
}

function assertStatus(status: ResStatus): void {
  if (status.error_code === "Success" || status.error_code === 0) {
    return;
  }

  throw new MilvusError(
    "MILVUS_OPERATION_FAILED",
    status.reason || status.detail || "Milvus operation failed.",
    502
  );
}

function assertDenseQueryVector(value: number[] | undefined, expectedDim: number): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== expectedDim ||
    !value.every((item) => typeof item === "number" && Number.isFinite(item))
  ) {
    throw new MilvusError(
      "INVALID_INPUT",
      `Dense query vector must be a ${expectedDim}-dimensional number array.`,
      400
    );
  }
  return value;
}

const SEARCH_OUTPUT_FIELDS = [
  MILVUS_COLLECTION_FIELDS.chunkId,
  MILVUS_COLLECTION_FIELDS.tenantId,
  MILVUS_COLLECTION_FIELDS.workspaceId,
  MILVUS_COLLECTION_FIELDS.knowledgeBaseId,
  MILVUS_COLLECTION_FIELDS.documentId,
  MILVUS_COLLECTION_FIELDS.versionId,
  MILVUS_COLLECTION_FIELDS.title,
  MILVUS_COLLECTION_FIELDS.headingPath,
  MILVUS_COLLECTION_FIELDS.contentText,
  MILVUS_COLLECTION_FIELDS.contentMarkdown,
  MILVUS_COLLECTION_FIELDS.metadata,
  MILVUS_COLLECTION_FIELDS.updatedAt
];

function normalizeSearchResult(
  row: Record<string, unknown> & { id?: unknown; score?: unknown }
): MilvusSearchChunkResult {
  return {
    id: toStringValue(row[MILVUS_COLLECTION_FIELDS.id] ?? row.id),
    chunk_id: toStringValue(row[MILVUS_COLLECTION_FIELDS.chunkId]),
    tenant_id: toStringValue(row[MILVUS_COLLECTION_FIELDS.tenantId]),
    workspace_id: toStringValue(row[MILVUS_COLLECTION_FIELDS.workspaceId]),
    knowledge_base_id: toStringValue(row[MILVUS_COLLECTION_FIELDS.knowledgeBaseId]),
    document_id: toStringValue(row[MILVUS_COLLECTION_FIELDS.documentId]),
    version_id: toStringValue(row[MILVUS_COLLECTION_FIELDS.versionId]),
    title: toStringValue(row[MILVUS_COLLECTION_FIELDS.title]),
    heading_path: toStringArray(row[MILVUS_COLLECTION_FIELDS.headingPath]),
    content_text: toStringValue(row[MILVUS_COLLECTION_FIELDS.contentText]),
    content_markdown: toStringValue(row[MILVUS_COLLECTION_FIELDS.contentMarkdown]),
    metadata: toRecord(row[MILVUS_COLLECTION_FIELDS.metadata]),
    updated_at: toNumberValue(row[MILVUS_COLLECTION_FIELDS.updatedAt]),
    score: toNumberValue(row.score)
  };
}

function flattenSearchResults(
  value: unknown
): Array<Record<string, unknown> & { id?: unknown; score?: unknown }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows = value.flatMap((item) => (Array.isArray(item) ? item : [item]));
  return rows.filter(
    (item): item is Record<string, unknown> & { id?: unknown; score?: unknown } =>
      typeof item === "object" && item !== null
  );
}

function toMilvusString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function toMilvusStringArray(values: string[]): string {
  return `[${values.map(toMilvusString).join(", ")}]`;
}

function toStringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function toNumberValue(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isMilvusNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /not found|not exist|can't find|does not exist/i.test(error.message);
}

function varcharField(
  name: string,
  maxLength: number,
  options: Partial<FieldType> = {}
): FieldType {
  return {
    name,
    data_type: DataType.VarChar,
    max_length: maxLength,
    ...options
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim() ? value.trim() : undefined;
}

function normalizeMilvusUri(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function sanitizeMilvusIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]+/, "");
  return sanitized || "openkb_chunks";
}
