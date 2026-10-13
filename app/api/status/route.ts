import { languageModelConfig } from "@/lib/providers";
import { apiJson, serverEnvironment } from "../_shared";

export async function GET() {
  const environment = await serverEnvironment();
  const aiConfigured = !!languageModelConfig(environment);
  return apiJson({
    aiConfigured,
    fuyaoConfigured: !!environment.FUYAO_API_KEY?.trim(),
    mode: aiConfigured ? "llm" : "rules",
    dataMode: "historical_snapshot",
    llmConnected: false,
    message: aiConfigured ? "已配置兼容模型接口；实际连通性及输出有效性会在提交描述时验证。" : "当前使用规则解析器和有来源的历史样本；模型与金融接口需要单独配置有效权限。",
  });
}
