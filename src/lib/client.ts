import { describeError } from "./error-message";

export async function request<T = any>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch("/api/" + url, init);
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? describeError(data.error) : `Request failed (HTTP ${response.status})`;
    throw Object.assign(new Error(message), { data, status: response.status });
  }
  return response.json();
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
export const costSummary = (value: number) =>
  value > 0 && value < 0.01
    ? "<$0.01"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
