import { spawn } from "node:child_process";

const BASE = "http://localhost:54321/functions/v1";

type AgentResult = { ok: boolean; status: number; body: unknown };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(`${BASE}/fundamental-agent`, {
        method: "OPTIONS",
      });
      return;
    } catch {
      await sleep(500);
    }
  }

  throw new Error("Timed out waiting for supabase functions serve");
}

async function callAgent(name: string, payload: object): Promise<AgentResult> {
  const response = await fetch(`${BASE}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }

  return { ok: response.ok, status: response.status, body };
}

function hasKeys(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== "object") return false;
  return keys.every((key) => key in (value as Record<string, unknown>));
}

function validateFundamental(value: unknown): boolean {
  return hasKeys(value, ["ticker", "valuation", "profitability", "growth", "financial_health", "dividend", "overall_score", "summary"]);
}

function validateTechnical(value: unknown): boolean {
  return hasKeys(value, ["ticker", "current_price", "trend", "indicators", "key_levels", "pattern_detected", "overall_signal"]);
}

function validateNews(value: unknown): boolean {
  return hasKeys(value, ["ticker", "aggregate_sentiment", "sentiment_label", "top_stories", "macro_headwinds", "macro_tailwinds", "summary"]);
}

function validateMacro(value: unknown): boolean {
  return hasKeys(value, ["ticker", "macro_score", "rate_environment_impact", "inflation_impact", "key_tailwinds", "key_headwinds", "summary", "macro_data"]);
}

function validateVerdict(value: unknown): boolean {
  if (!hasKeys(value, ["long_term", "swing_trade", "day_trade"])) return false;
  const v = value as Record<string, unknown>;
  const perHorizon = ["verdict", "confidence_pct", "risk_level", "time_horizon", "target_price", "stop_loss", "supporting_data", "pros", "cons", "probability_of_success", "key_risk"];
  return ["long_term", "swing_trade", "day_trade"].every((k) => hasKeys(v[k], perHorizon));
}

async function run() {
  const server = spawn("npx", ["supabase", "functions", "serve", "--no-verify-jwt", "--env-file", ".env.local"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  server.stdout.on("data", (chunk) => process.stdout.write(`[serve] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[serve:err] ${chunk}`));

  try {
    await waitForServer();

    const fundamental = await callAgent("fundamental-agent", { ticker: "AAPL" });
    const technical = await callAgent("technical-agent", { ticker: "AAPL" });
    const news = await callAgent("news-agent", { ticker: "AAPL", company_name: "Apple Inc." });
    const macro = await callAgent("macro-agent", { ticker: "AAPL", sector: "Technology" });
    const verdict = await callAgent("verdict-agent", {
      ticker: "AAPL",
      fundamental: fundamental.body,
      technical: technical.body,
      news: news.body,
      macro: macro.body,
    });

    const checks = [
      ["fundamental-agent", fundamental.ok && validateFundamental(fundamental.body)],
      ["technical-agent", technical.ok && validateTechnical(technical.body)],
      ["news-agent", news.ok && validateNews(news.body)],
      ["macro-agent", macro.ok && validateMacro(macro.body)],
      ["verdict-agent", verdict.ok && validateVerdict(verdict.body)],
    ] as const;

    for (const [name, pass] of checks) {
      console.log(`${name}: ${pass ? "PASS" : "FAIL"}`);
    }

    console.log("\nverdict-agent output:");
    console.log(JSON.stringify(verdict.body, null, 2));
  } finally {
    server.kill();
  }
}

run().catch((error) => {
  console.error("test-agents failed:", error);
  process.exitCode = 1;
});
