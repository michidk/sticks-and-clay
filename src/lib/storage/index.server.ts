import { resolve } from "node:path";
import { LocalStorageProvider } from "./local.server";
import { S3StorageProvider } from "./s3.server";
import type { StorageProvider } from "./types";
export type { StorageProvider, StoredObject } from "./types";
export const DATA = resolve(process.env.STUDIO_DATA_DIR || "data");
export const localStorage = new LocalStorageProvider({
  basePath: DATA,
  baseUrl: "/api/files",
});
let instance: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  if (instance) return instance;
  const provider = process.env.STORAGE_PROVIDER || "local";
  if (provider === "local") return (instance = localStorage);
  if (provider !== "s3")
    throw new Error("STORAGE_PROVIDER must be local or s3");
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(name + " is required for S3 storage");
    return value;
  };
  return (instance = new S3StorageProvider({
    bucket: required("S3_BUCKET"),
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  }));
}
