export async function serverEnvironment(): Promise<Record<string, string | undefined>> {
  const local = typeof process !== "undefined" ? process.env : {};
  try {
    const { env } = await import("cloudflare:workers");
    return { ...local, ...(env as Record<string, string | undefined>) };
  } catch { return local; }
}

export function apiJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function readRequestJson(request: Request, maxBytes = 8_192): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new Error("请使用 application/json 请求。");
  if (Number(request.headers.get("content-length")) > maxBytes) throw new Error("请求内容过长。");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("请求不能为空。");
  const decoder = new TextDecoder();
  let size = 0;
  let content = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("请求内容过长。");
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
  try { return JSON.parse(content); } catch { throw new Error("请求不是有效 JSON。"); }
}
