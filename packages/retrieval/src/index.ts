export const RETRIEVAL_PACKAGE_NAME = "@openkb/retrieval";
export const RETRIEVAL_INDEX_BACKEND = "milvus";

export type RetrievalScaffoldStatus = {
  packageName: typeof RETRIEVAL_PACKAGE_NAME;
  indexBackend: typeof RETRIEVAL_INDEX_BACKEND;
  finalPermissionCheckRequired: true;
};

export const retrievalScaffoldStatus: RetrievalScaffoldStatus = {
  packageName: RETRIEVAL_PACKAGE_NAME,
  indexBackend: RETRIEVAL_INDEX_BACKEND,
  finalPermissionCheckRequired: true
};
