export function assertStoragePath(path: string): void {
  let decoded = path;
  try {
    for (let i = 0; i < 2; i++) decoded = decodeURIComponent(decoded);
  } catch {
    throw new Error("Invalid storage path");
  }
  if (
    [path, decoded].some(
      (value) =>
        !value ||
        value.includes("\0") ||
        value.includes("\\") ||
        value.startsWith("/") ||
        /^[a-z]:/i.test(value) ||
        value.split("/").some((part) => !part || part === "." || part === ".."),
    )
  )
    throw new Error("Invalid storage path");
}

export function storageUrl(path: string) {
  assertStoragePath(path);
  return "/api/files/" + path.split("/").map(encodeURIComponent).join("/");
}

export function fileMimeType(path: string) {
  const types: Record<string, string> = {
    png: "image/png",
    svg: "image/svg+xml",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    glb: "model/gltf-binary",
    json: "application/json",
    py: "text/plain",
    zip: "application/zip",
  };
  return (
    types[path.split(".").pop()?.toLowerCase() || ""] ||
    "application/octet-stream"
  );
}
