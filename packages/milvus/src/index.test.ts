import { describe, expect, it } from "vitest";

import { MILVUS_CHUNK_ID_FIELD, MILVUS_PRIMARY_KEY_FIELD } from "./index";

describe("@openkb/milvus", () => {
  it("keeps the v0.3.3 primary key decision explicit", () => {
    expect(MILVUS_PRIMARY_KEY_FIELD).toBe("id");
    expect(MILVUS_CHUNK_ID_FIELD).toBe("chunk_id");
  });
});
