const BASE = "http://localhost:54321/functions/v1";

type Horizon = {
  verdict: "BUY" | "HOLD" | "AVOID" | "SELL";
  confidence_pct: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  time_horizon: string;
  target_price: number;
  stop_loss: number;
  supporting_data: string[];
  pros: string[];
  cons: string[];
  probability_of_success: number;
  key_risk: string;
};

type FullVerdict = {
  long_term: Horizon;
  swing_trade: Horizon;
  day_trade: Horizon;
};

const fixture = {
  ticker: "AAPL",
  fundamental: {
    ticker: "AAPL",
    valuation: { pe_ratio: 30.8, pb_ratio: 42.3, score: 5, note: "Premium valuation" },
    profitability: { profit_margin: 0.261, roe: 1.47, score: 9, note: "Strong margins" },
    growth: { revenue_growth_yoy: 0.05, eps_growth: 0.09, score: 7, note: "Moderate growth" },
    financial_health: { debt_to_equity: 1.56, current_ratio: 0.98, score: 6, note: "Leverage manageable" },
    overall_score: 6.8,
    summary: "High-quality business with premium valuation and resilient profitability.",
  },
  technical: {
    ticker: "AAPL",
    current_price: 187.45,
    trend: "NEUTRAL",
    indicators: {
      rsi_14: { value: 48.2, signal: "NEUTRAL", note: "Balanced momentum" },
      macd: { value: 0.42, signal: "BULLISH", note: "Above signal line" },
      sma_50_vs_200: { signal: "BULLISH", note: "50 MA above 200 MA" },
      bollinger: { position: "MID_BAND", signal: "NEUTRAL" },
    },
    key_levels: { support: [182.0, 178.5], resistance: [191.0, 195.0] },
    pattern_detected: "Price consolidating below near-term resistance.",
    overall_signal: "MILD_BULLISH",
  },
  news: {
    ticker: "AAPL",
    aggregate_sentiment: 0.28,
    sentiment_label: "MILDLY_POSITIVE",
    top_stories: [
      {
        title: "Apple services revenue beats expectations",
        sentiment: 0.52,
        impact: "MEDIUM",
        one_line_impact: "Supports margin stability and recurring cash flow confidence",
      },
      {
        title: "iPhone demand in China remains mixed",
        sentiment: -0.33,
        impact: "SHORT",
        one_line_impact: "Could pressure near-term hardware growth and regional revenue mix",
      },
      {
        title: "AI features expected in next iOS cycle",
        sentiment: 0.41,
        impact: "MEDIUM",
        one_line_impact: "May support upgrade cycle and ecosystem engagement",
      },
    ],
    macro_headwinds: ["Sticky rates may compress valuation multiples"],
    macro_tailwinds: ["Potential easing cycle may support growth multiples"],
    summary: "Net sentiment is mildly positive with services strength offsetting regional demand concerns.",
  },
  macro: {
    ticker: "AAPL",
    macro_score: 6.1,
    rate_environment_impact: "NEUTRAL",
    inflation_impact: "NEUTRAL",
    key_tailwinds: ["Cooling inflation trend", "Solid labor market"],
    key_headwinds: ["Policy uncertainty", "Global growth moderation"],
    summary: "Macro backdrop is mixed with modest support from disinflation trends.",
    macro_data: {
      fed_funds_rate: 5.25,
      cpi_yoy: 3.1,
      unemployment_rate: 4.0,
      gdp_growth_qoq: 2.1,
      yield_10y: 4.18,
      yield_2y: 4.52,
      yield_spread: -0.34,
    },
  },
};

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(`${BASE}/verdict-agent`, { method: "OPTIONS" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error("Timed out waiting for local Supabase Edge Functions server at http://localhost:54321");
}

function hasKeys(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== "object") return false;
  return keys.every((key) => key in (value as Record<string, unknown>));
}

function validateHorizon(value: unknown, horizon: string): string[] {
  const errors: string[] = [];
  const required = [
    "verdict",
    "confidence_pct",
    "risk_level",
    "time_horizon",
    "target_price",
    "stop_loss",
    "supporting_data",
    "pros",
    "cons",
    "probability_of_success",
    "key_risk",
  ];

  if (!hasKeys(value, required)) {
    errors.push(`${horizon}: missing one or more required fields`);
    return errors;
  }

  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.supporting_data) || v.supporting_data.length < 2) {
    errors.push(`${horizon}.supporting_data must have at least 2 items`);
  }
  if (!Array.isArray(v.pros) || v.pros.length < 1) {
    errors.push(`${horizon}.pros must have at least 1 item`);
  }
  if (!Array.isArray(v.cons) || v.cons.length < 1) {
    errors.push(`${horizon}.cons must have at least 1 item`);
  }

  return errors;
}

function validateFullVerdict(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!hasKeys(value, ["long_term", "swing_trade", "day_trade"])) {
    return { ok: false, errors: ["Missing one or more required horizons"] };
  }

  const v = value as Record<string, unknown>;
  errors.push(...validateHorizon(v.long_term, "long_term"));
  errors.push(...validateHorizon(v.swing_trade, "swing_trade"));
  errors.push(...validateHorizon(v.day_trade, "day_trade"));

  return { ok: errors.length === 0, errors };
}

function printSummary(verdict: FullVerdict) {
  const rows: Array<[string, Horizon]> = [
    ["Long Term", verdict.long_term],
    ["Swing Trade", verdict.swing_trade],
    ["Day Trade", verdict.day_trade],
  ];

  console.log("\n=== VERDICT SUMMARY ===");
  for (const [name, horizon] of rows) {
    console.log(`\n${name}`);
    console.log(`  Verdict: ${horizon.verdict}`);
    console.log(`  Confidence: ${horizon.confidence_pct}%`);
    console.log(`  Risk: ${horizon.risk_level}`);
    console.log(`  Time Horizon: ${horizon.time_horizon}`);
    console.log(`  Target / Stop: ${horizon.target_price} / ${horizon.stop_loss}`);
    console.log(`  Probability of Success: ${horizon.probability_of_success}%`);
    console.log(`  Key Risk: ${horizon.key_risk}`);
  }
}

async function run() {
  await waitForServer();

  const response = await fetch(`${BASE}/verdict-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fixture),
  });

  const body = await response.json();
  const validation = validateFullVerdict(body);

  console.log("\n=== TEST RESULTS ===");
  console.log(`HTTP Status: ${response.status}`);
  console.log(`Schema Validation: ${validation.ok ? "PASS" : "FAIL"}`);

  if (!validation.ok) {
    console.log("Validation Errors:");
    for (const error of validation.errors) {
      console.log(`- ${error}`);
    }
    console.log("\nRaw Response:");
    console.log(JSON.stringify(body, null, 2));
    process.exitCode = 1;
    return;
  }

  printSummary(body as FullVerdict);
}

run().catch((error) => {
  console.error("test-verdict failed:", error);
  process.exitCode = 1;
});
