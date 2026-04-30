import { describe, expect, it } from "vitest";

import {
  checksumSha256,
  createAssetObjectKey,
  getObjectStorageConfig,
  sanitizeFilename,
  StorageConfigError
} from "./index";

describe("@openkb/storage", () => {
  it("validates required S3-compatible storage environment", () => {
    expect(() => getObjectStorageConfig({})).toThrow(StorageConfigError);

    const config = getObjectStorageConfig({
      S3_ENDPOINT: "http://localhost:59000",
      S3_ACCESS_KEY_ID: "openkb",
      S3_SECRET_ACCESS_KEY: "openkb-secret",
      S3_BUCKET: "openkb-assets",
      S3_FORCE_PATH_STYLE: "true",
      S3_PRESIGN_TTL_SECONDS: "60"
    });

    expect(config).toMatchObject({
      endpoint: "http://localhost:59000",
      bucket: "openkb-assets",
      forcePathStyle: true,
      presignTtlSeconds: 60
    });
  });

  it("generates stable tenant-scoped object keys and checksums", () => {
    expect(
      createAssetObjectKey({
        tenantId: "tenant-1",
        assetId: "asset-1",
        filename: "../Roadmap.md"
      })
    ).toBe("tenants/tenant-1/assets/asset-1/..-Roadmap.md");
    expect(sanitizeFilename("")).toBe("upload.bin");
    expect(checksumSha256("OpenKB")).toMatch(/^[a-f0-9]{64}$/);
  });
});
