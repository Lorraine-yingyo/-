import { fetchFuyaoBatch, ProviderError, validateDataRequest } from "@/lib/providers";
import { apiJson, readRequestJson, serverEnvironment } from "../_shared";

export async function POST(request: Request) {
  let input: ReturnType<typeof validateDataRequest>;
  try { input = validateDataRequest(await readRequestJson(request)); }
  catch (error) { return apiJson({ error: error instanceof Error ? error.message : "请求格式不正确。", mode: "unavailable" }, 400); }
  const environment = await serverEnvironment();
  if (!environment.FUYAO_API_KEY?.trim()) {
    return apiJson({ error: "尚未配置扶摇 API Key。文档链接不是调用权限；本次未访问金融数据接口。", code: "NOT_CONFIGURED", mode: "unavailable", fallback: false }, 503);
  }
  try {
    const result = await fetchFuyaoBatch(input.codes, input.report, environment.FUYAO_API_KEY);
    return apiJson(result, result.records.length ? 200 : 502);
  } catch (error) {
    return apiJson({ error: error instanceof ProviderError ? error.message : "金融数据请求失败。", mode: "unavailable", fallback: false }, 502);
  }
}
