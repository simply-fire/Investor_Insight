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

function fallbackHorizons(ticker: string, technical: Record<string, unknown>): FullVerdicts {
	const currentPrice = toNumber(technical.current_price) || 100;
	return {
		long_term: {
			verdict: "HOLD",
			confidence_pct: 58,
			risk_level: "MEDIUM",
			time_horizon: "2-5 years",
			target_price: Number((currentPrice * 1.15).toFixed(2)),
			stop_loss: Number((currentPrice * 0.85).toFixed(2)),
			supporting_data: ["Mixed cross-agent inputs with no single dominant bullish or bearish factor."],
			pros: ["Diversified signal set avoids single-metric bias."],
			cons: ["Incomplete certainty without stronger trend confirmation."],
			probability_of_success: 56,
			key_risk: `${ticker} may re-rate lower if macro and earnings diverge from expectations.`,
		},
		swing_trade: {
			verdict: "HOLD",
			confidence_pct: 54,
			risk_level: "MEDIUM",
			time_horizon: "2-8 weeks",
			target_price: Number((currentPrice * 1.06).toFixed(2)),
			stop_loss: Number((currentPrice * 0.95).toFixed(2)),
			supporting_data: ["Short-term trend and momentum do not show a high-conviction setup."],
			pros: ["Potential upside if support levels hold."],
			cons: ["Signal noise can cause whipsaws in this horizon."],
			probability_of_success: 53,
			key_risk: "Breakdown below support could invalidate the setup quickly.",
		},
		day_trade: {
			verdict: "AVOID",
			confidence_pct: 51,
			risk_level: "HIGH",
			time_horizon: "1-3 days",
			target_price: Number((currentPrice * 1.01).toFixed(2)),
			stop_loss: Number((currentPrice * 0.99).toFixed(2)),
			supporting_data: ["Intraday edge is weak without stronger catalyst or volatility structure."],
			pros: ["Can react quickly if momentum improves."],
			cons: ["High noise-to-signal ratio for immediate execution."],
			probability_of_success: 49,
			key_risk: "Headline-driven volatility can negate intraday setups.",
		},
	};
}

function isValidHorizon(value: unknown): value is VerdictHorizon {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	const requiredStringFields = ["verdict", "risk_level", "time_horizon", "key_risk"];
	const requiredNumberFields = ["confidence_pct", "target_price", "stop_loss", "probability_of_success"];
	const requiredArrayFields = ["supporting_data", "pros", "cons"];

	for (const key of requiredStringFields) {
		if (typeof v[key] !== "string") return false;
	}
	for (const key of requiredNumberFields) {
		if (typeof v[key] !== "number") return false;
	}
	for (const key of requiredArrayFields) {
		if (!Array.isArray(v[key])) return false;
	}
	return true;
}

function isValidFullVerdicts(value: unknown): value is FullVerdicts {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return isValidHorizon(v.long_term) && isValidHorizon(v.swing_trade) && isValidHorizon(v.day_trade);
}

async function callGemini(prompt: string): Promise<FullVerdicts | null> {
	try {
		const key = Deno.env.get("GEMINI_API_KEY");
		if (!key) return null;

		const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`;
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
				generationConfig: {
					response_mime_type: "application/json",
					responseMimeType: "application/json",
				},
			}),
		});

		if (!response.ok) return null;
		const raw = await response.json();
		const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
		if (typeof text !== "string") return null;
		const parsed = JSON.parse(text);
		return isValidFullVerdicts(parsed) ? parsed : null;
	} catch (error) {
		console.error("[verdict-agent] Gemini parse error:", error);
		return null;
	}
}

async function callGroq(prompt: string): Promise<FullVerdicts | null> {
	try {
		const key = Deno.env.get("GROQ_API_KEY");
		if (!key) return null;

		const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${key}`,
			},
			body: JSON.stringify({
				model: "llama-3.1-70b-versatile",
				temperature: 0.2,
				response_format: { type: "json_object" },
				messages: [
					{ role: "system", content: "Return valid JSON only." },
					{ role: "user", content: prompt },
				],
			}),
		});

		if (!response.ok) return null;
		const raw = await response.json();
		const content = raw?.choices?.[0]?.message?.content;
		if (typeof content !== "string") return null;
		const parsed = JSON.parse(content);
		return isValidFullVerdicts(parsed) ? parsed : null;
	} catch (error) {
		console.error("[verdict-agent] Groq parse error:", error);
		return null;
	}
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

		const prompt = `You are a senior equity analyst. Based on the analysis below, produce investment verdicts for THREE time horizons.

RULES:
- Be data-specific. Reference actual numbers from the data.
- Every claim in pros/cons must be backed by data provided.
- Probability of success = realistic win rate, not a sales pitch. Be conservative.
- Respond ONLY with valid JSON matching the schema exactly. No markdown, no explanation.

ANALYSIS DATA:
Fundamental: ${JSON.stringify(fundamental)}
Technical: ${JSON.stringify(technical)}
News & Sentiment: ${JSON.stringify(news)}
Macro: ${JSON.stringify(macro)}

REQUIRED OUTPUT SCHEMA (return this exact structure):
{
	"long_term": {
		"verdict": "BUY | HOLD | AVOID | SELL",
		"confidence_pct": <integer 0-100>,
		"risk_level": "LOW | MEDIUM | HIGH",
		"time_horizon": "<string e.g. '2-5 years'>",
		"target_price": <number>,
		"stop_loss": <number>,
		"supporting_data": ["<specific data point>", ...],
		"pros": ["<string>", ...],
		"cons": ["<string>", ...],
		"probability_of_success": <integer 0-100>,
		"key_risk": "<single most important risk>"
	},
	"swing_trade": {
		"verdict": "BUY | HOLD | AVOID | SELL",
		"confidence_pct": <integer 0-100>,
		"risk_level": "LOW | MEDIUM | HIGH",
		"time_horizon": "<string>",
		"target_price": <number>,
		"stop_loss": <number>,
		"supporting_data": ["<specific data point>", ...],
		"pros": ["<string>", ...],
		"cons": ["<string>", ...],
		"probability_of_success": <integer 0-100>,
		"key_risk": "<single most important risk>"
	},
	"day_trade": {
		"verdict": "BUY | HOLD | AVOID | SELL",
		"confidence_pct": <integer 0-100>,
		"risk_level": "LOW | MEDIUM | HIGH",
		"time_horizon": "<string>",
		"target_price": <number>,
		"stop_loss": <number>,
		"supporting_data": ["<specific data point>", ...],
		"pros": ["<string>", ...],
		"cons": ["<string>", ...],
		"probability_of_success": <integer 0-100>,
		"key_risk": "<single most important risk>"
	}
}`;

		let verdicts = await callGemini(prompt);
		if (!verdicts) {
			verdicts = await callGroq(prompt);
		}
		if (!verdicts) {
			verdicts = fallbackHorizons(ticker, technical);
		}

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