import { describe, expect, it } from "vitest";

import {
  assertNoProviderSecrets,
  buildOpenKBMilvusSchema,
  createCollectionName,
  MILVUS_CHUNK_ID_FIELD,
  MILVUS_COLLECTION_FIELDS,
  MILVUS_PRIMARY_KEY_FIELD
} from "./index";

describe("@openkb/milvus schema", () => {
  it("uses id as the only primary key and keeps chunk_id as a regular field", () => {
    const schema = buildOpenKBMilvusSchema({
      collectionName: "openkb_chunks_test",
      vectorDim: 1024,
      enableBm25: true
    });

    const primaryFields = schema.fields.filter((field) => field.is_primary_key);
    expect(primaryFields).toHaveLength(1);
    expect(primaryFields[0]?.name).toBe(MILVUS_PRIMARY_KEY_FIELD);

    const chunkIdField = schema.fields.find((field) => field.name === MILVUS_CHUNK_ID_FIELD);
    expect(chunkIdField).toBeDefined();
    expect(chunkIdField?.is_primary_key).not.toBe(true);
  });

  it("creates BM25 sparse vector function by default", () => {
    const schema = buildOpenKBMilvusSchema({
      collectionName: "openkb_chunks_test",
      vectorDim: 1024
    });

    expect(
      schema.fields.some((field) => field.name === MILVUS_COLLECTION_FIELDS.sparseVector)
    ).toBe(true);
    expect(schema.functions.map((fn) => fn.name)).toContain("openkb_bm25");
    expect(schema.indexParams.some((index) => index.field_name === "sparse_vector")).toBe(true);
  });

  it("rejects provider secrets in function metadata", () => {
    expect(() => assertNoProviderSecrets({ provider: { api_key: "secret" } })).toThrow(
      "provider credentials"
    );
  });

  it("generates stable Milvus-safe collection names", () => {
    expect(
      createCollectionName({
        prefix: "openkb-chunks",
        schemaVersion: "v1",
        timestamp: new Date("2026-04-30T02:00:00.000Z")
      })
    ).toBe("openkb_chunks_v1_20260430020000");
  });
});
