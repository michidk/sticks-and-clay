export async function request<T = any>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch("/api/" + url, init);
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || "Request failed"), { data });
  return data;
}
export const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const fileUrl = (key: string) =>
  "/api/files/" + key.split("/").map(encodeURIComponent).join("/");
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
  }).format(value);
