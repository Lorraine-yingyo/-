import test from "node:test";
import assert from "node:assert/strict";
import { fetchFuyaoBatch, fetchFuyaoFinancials, parseFiniteMetric, ProviderError, validateDataRequest } from "../lib/providers.ts";

const goodPayload = (code = "600519.SH") => ({
  code: 0, request_id: "request-1",
  data: { thscode: code, report: "2024-4", abilities: [
    { ability: "growth", indicators: [
      { index_id: "operating_income_yoy_growth_ratio", value: "15.6600" },
      { index_id: "net_profit_yoy_growth_ratio", value: "15.3800" },
    ] },
    { ability: "profitability", indicators: [{ index_id: "index_weighted_avg_roe", value: "34.0100" }] },
  ] },
});
const response = (body: unknown) => Response.json(body);
const fetcher = (callback: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch =>
  ((url: unknown, init?: RequestInit) => Promise.resolve(callback(String(url), init))) as typeof fetch;

test("numeric adapter preserves zero and percentage units and rejects blanks/nonfinite data", () => {
  assert.equal(parseFiniteMetric("0"), 0);
  assert.equal(parseFiniteMetric("15.66"), 15.66);
  assert.equal(parseFiniteMetric(null), null);
  for (const value of ["", " ", "--", "12%", "Infinity", "0x11", Infinity, {}, false]) assert.equal(parseFiniteMetric(value), null);
});

test("only valid A share codes and a bounded report request are accepted", () => {
  assert.equal(validateDataRequest({}).codes.length, 12);
  assert.deepEqual(validateDataRequest({ codes: ["600519.SH", "600519.SH"] }).codes, ["600519.SH"]);
  assert.throws(() => validateDataRequest({ codes: Array(13).fill("600519.SH") }), ProviderError);
  assert.throws(() => validateDataRequest({ codes: ["https://example.com"] }), ProviderError);
  assert.throws(() => validateDataRequest({ report: "2024-12-31" }), ProviderError);
});

test("a missing credential causes no outbound request", async () => {
  let called = false;
  await assert.rejects(fetchFuyaoFinancials("600519.SH", "2024-4", "", {
    fetcher: fetcher(() => { called = true; return response(goodPayload()); }),
  }), (error: unknown) => error instanceof ProviderError && error.code === "NOT_CONFIGURED");
  assert.equal(called, false);
});

test("HTTP 200 with nonzero business status remains an explicit error", async () => {
  await assert.rejects(fetchFuyaoFinancials("600519.SH", "2024-4", "test-key", {
    fetcher: fetcher(() => response({ code: 2001, message: "key is invalid" })),
  }), (error: unknown) => error instanceof ProviderError && error.code === "BUSINESS_ERROR");
});

test("successful financial data does not invent 归母 profit or total revenue equivalence", async () => {
  const result = await fetchFuyaoFinancials("600519.SH", "2024-4", "test-key", {
    fetcher: fetcher((url, init) => {
      assert.equal(new URL(url).origin, "https://fuyao.aicubes.cn");
      assert.equal(new URL(url).searchParams.get("report"), "2024-4");
      assert.equal((init?.headers as Record<string, string>)["X-api-key"], "test-key");
      assert.equal(init?.redirect, "error");
      return response(goodPayload());
    }),
    now: () => new Date("2026-10-13T00:00:00Z"),
  });
  assert.deepEqual(result.metrics, { revenueGrowth: null, profitGrowth: null, peTtm: null, roe: 34.01, volatility: null });
  assert.equal(result.rawIndicators.net_profit_yoy_growth_ratio, 15.38);
  assert.equal(result.provenance.pointInTime, false);
  assert.equal(result.provenance.retrievedAt, "2026-10-13T00:00:00.000Z");
  assert.ok(!JSON.stringify(result).includes("test-key"));
});

test("mismatched response report is rejected", async () => {
  const payload = goodPayload(); payload.data.report = "2025-1";
  await assert.rejects(fetchFuyaoFinancials("600519.SH", "2024-4", "test-key", {
    fetcher: fetcher(() => response(payload)),
  }), (error: unknown) => error instanceof ProviderError && error.code === "INVALID_RESPONSE");
});

test("missing metrics remain null", async () => {
  const payload = goodPayload(); payload.data.abilities = [];
  const result = await fetchFuyaoFinancials("600519.SH", "2024-4", "test-key", { fetcher: fetcher(() => response(payload)) });
  assert.equal(result.metrics.roe, null);
  assert.equal(result.rawIndicators.operating_income_yoy_growth_ratio, null);
});

test("timeout is reported without a fabricated replacement", async () => {
  await assert.rejects(fetchFuyaoFinancials("600519.SH", "2024-4", "test-key", {
    timeoutMs: 5,
    fetcher: fetcher((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })),
  }), (error: unknown) => error instanceof ProviderError && error.code === "TIMEOUT");
});

test("partial batch failure is returned per stock and never filled by a snapshot", async () => {
  const result = await fetchFuyaoBatch(["600519.SH", "000858.SZ"], "2024-4", "test-key", {
    fetcher: fetcher((url) => new URL(url).searchParams.get("thscode") === "600519.SH" ? response(goodPayload()) : response({ code: 5002 })),
  });
  assert.equal(result.partial, true);
  assert.equal(result.completeForScreening, false);
  assert.equal(result.records.length, 1);
  assert.equal(result.errors[0].code, "000858.SZ");
  assert.equal(result.errors[0].errorCode, "BUSINESS_ERROR");
});

import { fetchLanguageModelIntent, languageModelConfig, validateModelIntent } from "../lib/providers.ts";
const modelPayload = () => ({
  conditions: [{ metric: "peTtm", op: "lte", value: 30 }],
  clarifications: ["请确认 PE 上限为 30 倍。"], unsupported: [], blocked: false, message: "请检查候选条件。",
});
const modelConfig = { apiKey: "test-secret", baseUrl: "https://model.example.test/v1", model: "test-model" };

test("optional model configuration requires key, base URL and model together", () => {
  assert.equal(languageModelConfig({}), null);
  assert.equal(languageModelConfig({ AI_API_KEY: "x" }), null);
  assert.equal(languageModelConfig({ AI_API_KEY: "x", AI_BASE_URL: "https://model.example.test/v1", AI_MODEL: "model" })?.model, "model");
});

test("model outputs must follow metric, operator and numeric allowlists", () => {
  assert.equal(validateModelIntent(modelPayload()).conditions[0].id, "model-1");
  assert.throws(() => validateModelIntent({ ...modelPayload(), recommendation: "600519" }), ProviderError);
  assert.throws(() => validateModelIntent({ ...modelPayload(), conditions: [{ metric: "futureReturn", op: "gte", value: 10 }] }), ProviderError);
  assert.throws(() => validateModelIntent({ ...modelPayload(), conditions: [{ metric: "peTtm", op: "lt", value: 30 }] }), ProviderError);
  assert.throws(() => validateModelIntent({ ...modelPayload(), conditions: [{ metric: "peTtm", op: "lte", value: "30" }] }), ProviderError);
  assert.throws(() => validateModelIntent({ ...modelPayload(), blocked: true }), ProviderError);
});

test("compatible model call sends a bounded request to only its server-configured URL", async () => {
  const result = await fetchLanguageModelIntent("PE 不超过30", modelConfig, {
    fetcher: fetcher((url, init) => {
      assert.equal(url, "https://model.example.test/v1/chat/completions");
      assert.equal(init?.redirect, "error");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-secret");
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, "test-model");
      assert.equal(request.messages[1].role, "user");
      assert.equal(request.messages[1].content, "PE 不超过30");
      return response({ choices: [{ message: { content: JSON.stringify(modelPayload()) }, finish_reason: "stop" }] });
    }),
  });
  assert.equal(result.mode, "llm");
  assert.ok(!JSON.stringify(result).includes("test-secret"));
});

test("invalid model endpoint fails before any request", async () => {
  let called = false;
  await assert.rejects(fetchLanguageModelIntent("PE 30", { ...modelConfig, baseUrl: "http://127.0.0.1:1234" }, {
    fetcher: fetcher(() => { called = true; return response({}); }),
  }), (error: unknown) => error instanceof ProviderError && error.code === "INVALID_AI_CONFIGURATION");
  assert.equal(called, false);
});

test("malformed and truncated model output cannot become screening conditions", async () => {
  await assert.rejects(fetchLanguageModelIntent("PE 30", modelConfig, {
    fetcher: fetcher(() => response({ choices: [{ message: { content: "not json" }, finish_reason: "stop" }] })),
  }), (error: unknown) => error instanceof ProviderError && error.code === "INVALID_AI_OUTPUT");
  await assert.rejects(fetchLanguageModelIntent("PE 30", modelConfig, {
    fetcher: fetcher(() => response({ choices: [{ message: { content: JSON.stringify(modelPayload()) }, finish_reason: "length" }] })),
  }), (error: unknown) => error instanceof ProviderError && error.code === "INVALID_AI_OUTPUT");
});

test("model timeout is explicit, allowing the route to disclose rules fallback", async () => {
  await assert.rejects(fetchLanguageModelIntent("PE 30", modelConfig, {
    timeoutMs: 5,
    fetcher: fetcher((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })),
  }), (error: unknown) => error instanceof ProviderError && error.code === "AI_TIMEOUT");
});

import { rulesFallback, safeModelPresentation } from "../lib/providers.ts";
import { readRequestJson } from "../app/api/_shared.ts";

test("model-authored explanation text is replaced with canonical server wording", () => {
  const result = safeModelPresentation(validateModelIntent({ ...modelPayload(), message: "arbitrary message", clarifications: ["arbitrary clarification"], unsupported: ["arbitrary unsupported text"] }));
  assert.ok(!JSON.stringify(result).includes("arbitrary"));
  assert.ok(result.clarifications.some((text) => text.includes("30倍")));
  assert.equal(result.unsupported.length, 1);
});

test("unsafe prose in any model field triggers explicit rules fallback", async () => {
  for (const field of ["message", "clarifications", "unsupported"] as const) {
    const payload = { ...modelPayload(), [field]: field === "message" ? "立即买入，保证收益" : ["立即买入，保证收益"] };
    let failure: unknown;
    try {
      await fetchLanguageModelIntent("PE不超过30", modelConfig, {
        fetcher: fetcher(() => response({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] })),
      });
    } catch (error) { failure = error; }
    assert.ok(failure instanceof ProviderError);
    assert.equal(failure.code, "UNSAFE_AI_OUTPUT");
    const fallback = rulesFallback({ conditions: [], clarifications: [], unsupported: [], blocked: false, message: "规则候选", mode: "rules" }, failure);
    assert.equal(fallback.mode, "rules");
    assert.equal(fallback.fallback, true);
    assert.equal(fallback.requiresConfirmation, true);
    assert.equal(fallback.llmConnected, false);
    assert.ok(!JSON.stringify(fallback).includes("立即买入"));
  }
});

test("request size limit counts streamed bytes even if content-length is missing or false", async () => {
  for (const contentLength of [undefined, "1"]) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (contentLength) headers["Content-Length"] = contentLength;
    const request = new Request("https://app.example.test/api/interpret", { method: "POST", headers, body: JSON.stringify({ text: "a".repeat(9_000) }) });
    await assert.rejects(readRequestJson(request), /请求内容过长/);
  }
});
