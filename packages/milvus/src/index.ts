export const MILVUS_PACKAGE_NAME = "@openkb/milvus";
export const MILVUS_ACTIVE_ALIAS = "openkb_chunks_active";
export const MILVUS_PRIMARY_KEY_FIELD = "id";
export const MILVUS_CHUNK_ID_FIELD = "chunk_id";

export type MilvusScaffoldStatus = {
  packageName: typeof MILVUS_PACKAGE_NAME;
  activeAlias: typeof MILVUS_ACTIVE_ALIAS;
  primaryKeyField: typeof MILVUS_PRIMARY_KEY_FIELD;
  chunkIdField: typeof MILVUS_CHUNK_ID_FIELD;
  storesEmbeddingProviderKeys: false;
};

export const milvusScaffoldStatus: MilvusScaffoldStatus = {
  packageName: MILVUS_PACKAGE_NAME,
  activeAlias: MILVUS_ACTIVE_ALIAS,
  primaryKeyField: MILVUS_PRIMARY_KEY_FIELD,
  chunkIdField: MILVUS_CHUNK_ID_FIELD,
  storesEmbeddingProviderKeys: false
};
