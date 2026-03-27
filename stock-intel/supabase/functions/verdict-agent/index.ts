import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";

type VerdictHorizon = {
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

type FullVerdicts = {
	long_term: VerdictHorizon;
	swing_trade: VerdictHorizon;
	day_trade: VerdictHorizon;
};

type ValidationResult = {
	isValid: boolean;
	errors: string[];
};

type ProviderResult = {
	provider: "gemini" | "groq";
	rawText: string | null;
	error: string | null;
};

type AttemptEvaluation = {
	provider: "gemini" | "groq";
	isValid: boolean;
	parsed: unknown;
	errors: string[];
	rawText: string | null;
	error: string | null;
};

type VerdictRequest = {
	ticker?: string;
	fundamental?: Record<string, unknown>;
	technical?: Record<string, unknown>;
	news?: Record<string, unknown>;
	macro?: Record<string, unknown>;
};

function toNumber(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function clampPct(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function validateHorizon(value: unknown, horizonLabel: string): ValidationResult {
	const errors: string[] = [];
	if (!value || typeof value !== "object") {
		return { isValid: false, errors: [`${horizonLabel} must be an object`] };
	}

	const v = value as Record<string, unknown>;
	const verdict = String(v.verdict ?? "");
	const riskLevel = String(v.risk_level ?? "");

	if (!["BUY", "HOLD", "AVOID", "SELL"].includes(verdict)) {
		errors.push(`${horizonLabel}.verdict must be one of BUY|HOLD|AVOID|SELL`);
	}
	if (typeof v.confidence_pct !== "number" || !Number.isFinite(v.confidence_pct)) {
		errors.push(`${horizonLabel}.confidence_pct must be a number`);
	}
	if (!["LOW", "MEDIUM", "HIGH"].includes(riskLevel)) {
		errors.push(`${horizonLabel}.risk_level must be one of LOW|MEDIUM|HIGH`);
	}
	if (typeof v.time_horizon !== "string" || v.time_horizon.trim().length === 0) {
		errors.push(`${horizonLabel}.time_horizon must be a non-empty string`);
	}
	if (typeof v.target_price !== "number" || !Number.isFinite(v.target_price)) {
		errors.push(`${horizonLabel}.target_price must be a number`);
	}
	if (typeof v.stop_loss !== "number" || !Number.isFinite(v.stop_loss)) {
		errors.push(`${horizonLabel}.stop_loss must be a number`);
	}

	if (!Array.isArray(v.supporting_data) || v.supporting_data.length < 2 || !v.supporting_data.every((x) => typeof x === "string")) {
		errors.push(`${horizonLabel}.supporting_data must be a string array with at least 2 items`);
	}
	if (!Array.isArray(v.pros) || v.pros.length < 1 || !v.pros.every((x) => typeof x === "string")) {
		errors.push(`${horizonLabel}.pros must be a string array with at least 1 item`);
	}
	if (!Array.isArray(v.cons) || v.cons.length < 1 || !v.cons.every((x) => typeof x === "string")) {
		errors.push(`${horizonLabel}.cons must be a string array with at least 1 item`);
	}
	if (typeof v.probability_of_success !== "number" || !Number.isFinite(v.probability_of_success)) {
		errors.push(`${horizonLabel}.probability_of_success must be a number`);
	}
	if (typeof v.key_risk !== "string" || v.key_risk.trim().length === 0) {
		errors.push(`${horizonLabel}.key_risk must be a non-empty string`);
	}

	return { isValid: errors.length === 0, errors };
}

function validateFullVerdicts(value: unknown): ValidationResult {
	const errors: string[] = [];
	if (!value || typeof value !== "object") {
		return { isValid: false, errors: ["Top-level response must be a JSON object"] };
	}

	const v = value as Record<string, unknown>;
	for (const horizon of ["long_term", "swing_trade", "day_trade"] as const) {
		if (!(horizon in v)) {
			errors.push(`Missing required horizon: ${horizon}`);
			continue;
		}
		const check = validateHorizon(v[horizon], horizon);
		if (!check.isValid) errors.push(...check.errors);
	}

	return { isValid: errors.length === 0, errors };
}

function parseJsonSafely(rawText: string | null): { parsed: unknown; parseError: string | null } {
	if (!rawText) {
		return { parsed: null, parseError: "Empty model response" };
	}

	try {
		return { parsed: JSON.parse(rawText), parseError: null };
	} catch (error) {
		return {
			parsed: null,
			parseError: error instanceof Error ? error.message : String(error),
		};
	}
}

async function callGemini(prompt: string): Promise<ProviderResult> {
	try {
		const key = Deno.env.get("GEMINI_API_KEY");
		if (!key) {
			return { provider: "gemini", rawText: null, error: "GEMINI_API_KEY is not set" };
		}

		const geminiModels = ["gemini-2.0-flash", "gemini-1.5-flash"];
		let lastError: string | null = null;

		for (const model of geminiModels) {
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						responseMimeType: "application/json",
					},
				}),
			});

			if (!response.ok) {
				const detail = await response.text();
				lastError = `Gemini ${model} HTTP ${response.status}: ${detail.slice(0, 240)}`;
				continue;
			}

			const raw = await response.json();
			const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
			if (typeof text !== "string") {
				lastError = `Gemini ${model} returned non-text content`;
				continue;
			}

			return { provider: "gemini", rawText: text, error: null };
		}

		return { provider: "gemini", rawText: null, error: lastError ?? "Gemini call failed" };
	} catch (error) {
		console.error("[verdict-agent] Gemini parse error:", error);
		return {
			provider: "gemini",
			rawText: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function callGroq(prompt: string): Promise<ProviderResult> {
	try {
		const key = Deno.env.get("GROQ_API_KEY");
		if (!key) {
			return { provider: "groq", rawText: null, error: "GROQ_API_KEY is not set" };
		}

		const groqModels = ["llama-3.1-70b-versatile", "llama-3.3-70b-versatile"];
		let lastError: string | null = null;

		for (const model of groqModels) {
			const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${key}`,
				},
				body: JSON.stringify({
					model,
					temperature: 0.2,
					messages: [
						{ role: "system", content: "Return valid JSON only." },
						{ role: "user", content: prompt },
					],
				}),
			});

			if (!response.ok) {
				const detail = await response.text();
				lastError = `Groq ${model} HTTP ${response.status}: ${detail.slice(0, 240)}`;
				continue;
			}

			const raw = await response.json();
			const content = raw?.choices?.[0]?.message?.content;
			if (typeof content !== "string") {
				lastError = `Groq ${model} returned non-text content`;
				continue;
			}

			return { provider: "groq", rawText: content, error: null };
		}

		return { provider: "groq", rawText: null, error: lastError ?? "Groq call failed" };
	} catch (error) {
		console.error("[verdict-agent] Groq parse error:", error);
		return {
			provider: "groq",
			rawText: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function evaluateAttempt(result: ProviderResult): AttemptEvaluation {
	const { parsed, parseError } = parseJsonSafely(result.rawText);
	if (parseError) {
		return {
			provider: result.provider,
			isValid: false,
			parsed,
			errors: [parseError],
			rawText: result.rawText,
			error: result.error,
		};
	}

	const validation = validateFullVerdicts(parsed);
	return {
		provider: result.provider,
		isValid: validation.isValid,
		parsed,
		errors: validation.errors,
		rawText: result.rawText,
		error: result.error,
	};
}

serve(async (req: Request): Promise<Response> => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}

	if (req.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method not allowed" }), {
			status: 405,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}

	try {
		let body: VerdictRequest;
		try {
			const text = await req.text();
			if (!text || text.length === 0 || text === "{}") {
				return new Response(
					JSON.stringify({ error: "Empty request body. Expected { ticker, fundamental, technical, news, macro }" }),
					{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
				);
			}
			body = JSON.parse(text) as VerdictRequest;
		} catch (parseError) {
			return new Response(
				JSON.stringify({ error: `Invalid JSON: ${String(parseError).substring(0, 100)}` }),
				{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
			);
		}
		const ticker = (body.ticker ?? "").toUpperCase().trim();
		if (!ticker) {
			return new Response(JSON.stringify({ error: "ticker is required" }), {
				status: 400,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			});
		}

		const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
		const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
		if (supabaseUrl && supabaseKey) {
			createClient(supabaseUrl, supabaseKey);
		}

		const fundamental = body.fundamental ?? {};
		const technical = body.technical ?? {};
		const news = body.news ?? {};
		const macro = body.macro ?? {};

		const prompt = `You are a senior equity analyst. Respond ONLY with valid JSON.

RULES:
1. Be data-specific - reference actual numbers from the provided data.
2. Every pro/con must cite a specific metric.
3. probability_of_success must be conservative (this is a realistic win rate, not optimism).
4. If data is missing for a section, use the available data and note the gap in key_risk.
5. Respond ONLY with valid JSON - no markdown fences, no explanation, no preamble.

Return all 3 horizons (long_term, swing_trade, day_trade) in one JSON object in a single response.

AGENT OUTPUTS:

[FUNDAMENTAL_AGENT_JSON]
${JSON.stringify(fundamental, null, 2)}

[TECHNICAL_AGENT_JSON]
${JSON.stringify(technical, null, 2)}

[NEWS_AGENT_JSON]
${JSON.stringify(news, null, 2)}

[MACRO_AGENT_JSON]
${JSON.stringify(macro, null, 2)}

REQUIRED VERDICT SCHEMA EXAMPLE (use this exact shape and keys):
{
  "long_term": {
    "verdict": "BUY | HOLD | AVOID | SELL",
    "confidence_pct": 72,
    "risk_level": "LOW | MEDIUM | HIGH",
    "time_horizon": "2-5 years",
    "target_price": 185.0,
    "stop_loss": 142.0,
    "supporting_data": [
      "Revenue CAGR of 18% over 3 years",
      "RSI at 42 - oversold territory"
    ],
    "pros": [
      "Strong moat in cloud segment; operating margin 31.2%"
    ],
    "cons": [
      "P/E of 38.0 is elevated versus peers"
    ],
    "probability_of_success": 68,
    "key_risk": "Macro recession could reduce enterprise demand"
  },
  "swing_trade": {
    "verdict": "BUY | HOLD | AVOID | SELL",
    "confidence_pct": 64,
    "risk_level": "LOW | MEDIUM | HIGH",
    "time_horizon": "2-8 weeks",
    "target_price": 182.0,
    "stop_loss": 171.0,
    "supporting_data": [
      "Price 176.4 is near support at 172.0",
      "MACD histogram improved from -0.8 to -0.2"
    ],
    "pros": [
      "RSI 38.2 indicates potential mean reversion"
    ],
    "cons": [
      "50DMA below 200DMA (death cross) signals trend risk"
    ],
    "probability_of_success": 57,
    "key_risk": "Break below 172 support invalidates setup"
  },
  "day_trade": {
    "verdict": "BUY | HOLD | AVOID | SELL",
    "confidence_pct": 55,
    "risk_level": "LOW | MEDIUM | HIGH",
    "time_horizon": "1-3 days",
    "target_price": 178.2,
    "stop_loss": 174.5,
    "supporting_data": [
      "Intraday volatility 1.9% over last 10 sessions",
      "Volume 22% above 20-day average"
    ],
    "pros": [
      "High relative volume can support short-term moves"
    ],
    "cons": [
      "News headline risk can reverse intraday momentum"
    ],
    "probability_of_success": 52,
    "key_risk": "Unexpected macro headlines can spike volatility"
  }
}`;

		const geminiAttempt = evaluateAttempt(await callGemini(prompt));
		let finalAttempt = geminiAttempt;
		if (!geminiAttempt.isValid) {
			finalAttempt = evaluateAttempt(await callGroq(prompt));
		}

		if (!finalAttempt.isValid) {
			const partialData = finalAttempt.parsed ?? geminiAttempt.parsed ?? null;
			return new Response(
				JSON.stringify({
					error: "verdict_validation_failed",
					message: "Both LLM attempts failed schema validation.",
					attempts: [
						{
							provider: geminiAttempt.provider,
							error: geminiAttempt.error,
							validation_errors: geminiAttempt.errors,
						},
						{
							provider: finalAttempt.provider,
							error: finalAttempt.error,
							validation_errors: finalAttempt.errors,
						},
					],
					partial_data: partialData,
				}),
				{ status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
			);
		}

		const verdicts = finalAttempt.parsed as FullVerdicts;

		verdicts.long_term.confidence_pct = clampPct(verdicts.long_term.confidence_pct);
		verdicts.long_term.probability_of_success = clampPct(verdicts.long_term.probability_of_success);
		verdicts.swing_trade.confidence_pct = clampPct(verdicts.swing_trade.confidence_pct);
		verdicts.swing_trade.probability_of_success = clampPct(verdicts.swing_trade.probability_of_success);
		verdicts.day_trade.confidence_pct = clampPct(verdicts.day_trade.confidence_pct);
		verdicts.day_trade.probability_of_success = clampPct(verdicts.day_trade.probability_of_success);

		return new Response(JSON.stringify(verdicts), {
			status: 200,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error("[verdict-agent] Error:", error);
		return new Response(
			JSON.stringify({ error: "Analysis failed", detail: error instanceof Error ? error.message : String(error) }),
			{ status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
		);
	}
});