import { parseIntent, validateConditions } from "@/lib/screening";
import { fetchLanguageModelIntent, languageModelConfig, ProviderError, rulesFallback } from "@/lib/providers";
import { apiJson, readRequestJson, serverEnvironment } from "../_shared";

export async function POST(request: Request) {
  try {
    const body = await readRequestJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return apiJson({ error: "请求必须为 JSON 对象。" }, 400);
    const text = (body as Record<string, unknown>).text;
    if (typeof text !== "string" || !text.trim() || text.length > 1_000) return apiJson({ error: "请输入 1–1000 字的选股描述。" }, 400);
    const rules = parseIntent(text.trim());
    // The local safety boundary is checked before any optional external call.
    if (rules.blocked) return apiJson({ ...rules, llmConnected: false });
    const environment = await serverEnvironment();
    const config = languageModelConfig(environment);
    if (config) {
      try {
        const result = await fetchLanguageModelIntent(text.trim(), config);
        if (result.blocked) return apiJson({
          conditions: [], clarifications: [], unsupported: [], blocked: true, mode: "llm",
          message: "这里提供可核验的条件筛选。请改为财务、估值或历史波动条件。",
          llmConnected: true, fallback: false, requiresConfirmation: true,
        });
        const errors = result.conditions.length ? validateConditions(result.conditions) : [];
        if (errors.length) throw new ProviderError("INVALID_AI_CONDITIONS", "模型生成的条件存在冲突或无效阈值。");
        return apiJson({ ...result, llmConnected: true, fallback: false, requiresConfirmation: true });
      } catch (error) {
        const failure = error instanceof ProviderError ? error : new ProviderError("AI_ERROR", "模型解析失败。");
        return apiJson(rulesFallback(rules, failure));
      }
    }
    const anyModelSetting = !!(environment.AI_API_KEY || environment.AI_BASE_URL || environment.AI_MODEL);
    return apiJson({ ...rules, mode: "rules", llmConnected: false, fallback: false, requiresConfirmation: true,
      ...(anyModelSetting ? { configurationWarning: "模型配置不完整，需同时配置 AI_API_KEY、AI_BASE_URL、AI_MODEL；本次使用规则解析。" } : {}),
    });
  } catch (error) {
    return apiJson({ error: error instanceof Error ? error.message : "解析请求失败。", mode: "rules", llmConnected: false }, 400);
  }
}
