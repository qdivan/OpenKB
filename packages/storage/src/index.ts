import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  CreateBucketCommand,
  type CreateBucketCommandInput,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const STORAGE_PACKAGE_NAME = "@openkb/storage";
export const DEFAULT_S3_BUCKET = "openkb-assets";
export const DEFAULT_S3_REGION = "us-east-1";
export const DEFAULT_S3_PRESIGN_TTL_SECONDS = 900;

type BucketLocationConstraint = NonNullable<
  NonNullable<CreateBucketCommandInput["CreateBucketConfiguration"]>["LocationConstraint"]
>;

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  presignTtlSeconds: number;
};

export type PutObjectInput = {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  metadata?: Record<string, string>;
};

export type GetObjectInput = {
  key: string;
};

export type HeadObjectInput = {
  key: string;
};

export type PresignedGetUrlInput = {
  key: string;
  expiresInSeconds?: number;
};

export type ObjectStorage = {
  readonly bucket: string;
  ensureBucket(): Promise<void>;
  putObject(input: PutObjectInput): Promise<{ etag?: string }>;
  getObject(input: GetObjectInput): Promise<Buffer>;
  headObject(input: HeadObjectInput): Promise<HeadObjectCommandOutput>;
  createPresignedGetUrl(input: PresignedGetUrlInput): Promise<string>;
};

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function createObjectStorage(
  config: ObjectStorageConfig = getObjectStorageConfig()
): ObjectStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  return new S3ObjectStorage(client, config);
}

export function getObjectStorageConfig(env: NodeJS.ProcessEnv = process.env): ObjectStorageConfig {
  return {
    endpoint: requireEnv(env, "S3_ENDPOINT"),
    region: optionalEnv(env, "S3_REGION", DEFAULT_S3_REGION),
    bucket: optionalEnv(env, "S3_BUCKET", DEFAULT_S3_BUCKET),
    accessKeyId: requireEnv(env, "S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv(env, "S3_SECRET_ACCESS_KEY"),
    forcePathStyle: parseBoolean(optionalEnv(env, "S3_FORCE_PATH_STYLE", "true")),
    presignTtlSeconds: parsePositiveInt(
      optionalEnv(env, "S3_PRESIGN_TTL_SECONDS", String(DEFAULT_S3_PRESIGN_TTL_SECONDS)),
      "S3_PRESIGN_TTL_SECONDS"
    )
  };
}

export function createAssetObjectKey(input: {
  tenantId: string;
  assetId: string;
  filename: string;
}): string {
  const filename = sanitizeFilename(input.filename);
  return `tenants/${input.tenantId}/assets/${input.assetId}/${filename}`;
}

export function checksumSha256(body: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  const normalized = trimmed
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 180);

  return normalized || "upload.bin";
}

class S3ObjectStorage implements ObjectStorage {
  readonly bucket: string;

  constructor(
    private readonly client: S3Client,
    private readonly config: ObjectStorageConfig
  ) {
    this.bucket = config.bucket;
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      const input: CreateBucketCommandInput =
        this.config.region === "us-east-1"
          ? { Bucket: this.bucket }
          : {
              Bucket: this.bucket,
              CreateBucketConfiguration: {
                LocationConstraint: this.config.region as BucketLocationConstraint
              }
            };
      const create = new CreateBucketCommand(input);
      await this.client.send(create);
    }
  }

  async putObject(input: PutObjectInput): Promise<{ etag?: string }> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata
      })
    );

    return { etag: result.ETag };
  }

  async getObject(input: GetObjectInput): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: input.key })
    );
    return bodyToBuffer(result.Body);
  }

  async headObject(input: HeadObjectInput): Promise<HeadObjectCommandOutput> {
    return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: input.key }));
  }

  async createPresignedGetUrl(input: PresignedGetUrlInput): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: input.key }),
      { expiresIn: input.expiresInSeconds ?? this.config.presignTtlSeconds }
    );
  }
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported S3 response body type.");
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value?.trim()) {
    throw new StorageConfigError(`${key} is required.`);
  }
  return value.trim();
}

function optionalEnv(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  return value?.trim() ? value.trim() : fallback;
}

function parseBoolean(value: string): boolean {
  return value === "true" || value === "1" || value.toLowerCase() === "yes";
}

function parsePositiveInt(value: string, key: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new StorageConfigError(`${key} must be a positive integer.`);
  }
  return parsed;
}
