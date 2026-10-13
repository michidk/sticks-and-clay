import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  paginateListObjectsV2,
  S3Client,
} from "@aws-sdk/client-s3";
import { assertStoragePath, storageUrl } from "./path";
import type { StorageConfig, StorageProvider, StoredObject } from "./types";

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor(config: NonNullable<StorageConfig["s3"]>) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: !!config.endpoint,
    });
  }

  async upload(file: File | Blob, path: string): Promise<string> {
    assertStoragePath(path);
    const body = new Uint8Array(await file.arrayBuffer());
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: file.type || "application/octet-stream",
      }),
    );
    return path;
  }

  async download(path: string): Promise<Blob> {
    assertStoragePath(path);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: path,
    });

    const response = await this.client.send(command);
    if (!response.Body) throw new Error("Empty storage response");
    return new Blob(
      [new Uint8Array(await response.Body.transformToByteArray())],
      {
        type: response.ContentType,
      },
    );
  }

  async delete(path: string): Promise<void> {
    assertStoragePath(path);
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: path,
    });

    await this.client.send(command);
  }

  getUrl(path: string): string {
    return storageUrl(path);
  }

  async exists(path: string): Promise<boolean> {
    assertStoragePath(path);
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: path,
      });
      await this.client.send(command);
      return true;
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return false;
      throw error;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    return (await this.listObjects(prefix)).map(({ path }) => path);
  }

  async listObjects(prefix?: string): Promise<StoredObject[]> {
    if (prefix) assertStoragePath(prefix.replace(/\/$/, ""));
    const objects: StoredObject[] = [];
    const pages = paginateListObjectsV2(
      { client: this.client },
      { Bucket: this.bucket, Prefix: prefix },
    );

    for await (const page of pages) {
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        objects.push({
          path: object.Key,
          sizeBytes: object.Size ?? 0,
        });
      }
    }

    return objects;
  }
}
