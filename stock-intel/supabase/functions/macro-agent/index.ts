import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";

type MacroRequest = {
	ticker?: string;
	sector?: string;
};

type MacroData = {
	fed_funds_rate: number;
	cpi_yoy: number;
	unemployment_rate: number;
	gdp_growth_qoq: number;
	yield_10y: number;
	yield_2y: number;
	yield_spread: number;
};

type MacroAgentOutput = {
	ticker: string;
	macro_score: number;
	rate_environment_impact: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
	inflation_impact: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
	key_tailwinds: string[];
	key_headwinds: string[];
	summary: string;
	macro_data: MacroData;
};

function toNumber(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function clampScore(score: number): number {
	return Math.max(1, Math.min(10, Math.round(score)));
}

async function fetchFredSeries(seriesId: string, limit = 1): Promise<number[]> {
	const fredKey = Deno.env.get("FRED_API_KEY");
	if (!fredKey) {
		return [];
	}

	const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(fredKey)}&limit=${limit}&sort_order=desc&file_type=json`;
	const response = await fetch(url);
	if (!response.ok) {
		return [];
	}

	const payload = await response.json();
	const observations = (payload?.observations ?? []) as Array<{ value?: string }>;
	return observations.map((obs) => toNumber(obs.value)).filter((v) => Number.isFinite(v));
}

async function macroLlmAssessment(ticker: string, sector: string, macroData: MacroData): Promise<Partial<MacroAgentOutput>> {
	try {
		const geminiKey = Deno.env.get("GEMINI_API_KEY");
		if (!geminiKey) return {};

		const prompt = `Given this macro data and the fact that ${ticker} is in the ${sector} sector,
assess the macro environment's impact on this stock.
Return JSON only:
{
	"macro_score": <1-10, 10=very favorable>,
	"rate_environment_impact": "POSITIVE | NEUTRAL | NEGATIVE",
	"inflation_impact": "POSITIVE | NEUTRAL | NEGATIVE",
	"key_tailwinds": ["<string>"],
	"key_headwinds": ["<string>"],
	"summary": "<2-3 sentence macro assessment>"
}
Macro data: ${JSON.stringify(macroData)}`;

		const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
				generationConfig: { responseMimeType: "application/json" },
			}),
		});

		if (!response.ok) return {};
		const raw = await response.json();
		const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
		if (typeof text !== "string") return {};
		return JSON.parse(text) as Partial<MacroAgentOutput>;
	} catch (error) {
		console.error("[macro-agent] Gemini parse error:", error);
		return {};
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
		let body: MacroRequest;
		try {
			const text = await req.text();
			if (!text || text.length === 0 || text === "{}") {
				return new Response(JSON.stringify({ error: "Empty request body. Expected { ticker, sector? }" }), {
					status: 400,
					headers: { ...corsHeaders, "Content-Type": "application/json" },
				});
			}
			body = JSON.parse(text) as MacroRequest;
		} catch (parseError) {
			return new Response(
				JSON.stringify({ error: `Invalid JSON: ${String(parseError).substring(0, 100)}` }),
				{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
			);
		}
		const ticker = (body.ticker ?? "").toUpperCase().trim();
		const sector = (body.sector ?? "Unknown").trim();

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

		const [fedFunds, cpiSeries, unemployment, gdpGrowth, dgs10, dgs2] = await Promise.all([
			fetchFredSeries("FEDFUNDS", 1),
			fetchFredSeries("CPCAUCSL", 13),
			fetchFredSeries("UNRATE", 1),
			fetchFredSeries("A191RL1Q225SBEA", 1),
			fetchFredSeries("DGS10", 1),
			fetchFredSeries("DGS2", 1),
		]);

		const cpiLatest = cpiSeries[0] ?? 0;
		const cpiYearAgo = cpiSeries[12] ?? 0;
		const cpiYoy = cpiYearAgo > 0 ? ((cpiLatest - cpiYearAgo) / cpiYearAgo) * 100 : 0;

		const macroData: MacroData = {
			fed_funds_rate: round(fedFunds[0] ?? 0),
			cpi_yoy: round(cpiYoy),
			unemployment_rate: round(unemployment[0] ?? 0),
			gdp_growth_qoq: round(gdpGrowth[0] ?? 0),
			yield_10y: round(dgs10[0] ?? 0),
			yield_2y: round(dgs2[0] ?? 0),
			yield_spread: round((dgs10[0] ?? 0) - (dgs2[0] ?? 0)),
		};

		const llm = await macroLlmAssessment(ticker, sector, macroData);

		const heuristicRateImpact: "POSITIVE" | "NEUTRAL" | "NEGATIVE" =
			macroData.fed_funds_rate < 3 ? "POSITIVE" : macroData.fed_funds_rate > 5 ? "NEGATIVE" : "NEUTRAL";

		const heuristicInflationImpact: "POSITIVE" | "NEUTRAL" | "NEGATIVE" =
			macroData.cpi_yoy < 2.5 ? "POSITIVE" : macroData.cpi_yoy > 4 ? "NEGATIVE" : "NEUTRAL";

		const baseScore = clampScore(
			5 +
			(heuristicRateImpact === "POSITIVE" ? 1 : heuristicRateImpact === "NEGATIVE" ? -1 : 0) +
			(heuristicInflationImpact === "POSITIVE" ? 1 : heuristicInflationImpact === "NEGATIVE" ? -1 : 0) +
			(macroData.yield_spread > 0 ? 1 : -1),
		);

		const result: MacroAgentOutput = {
			ticker,
			macro_score: clampScore(toNumber(llm.macro_score) || baseScore),
			rate_environment_impact: (llm.rate_environment_impact as MacroAgentOutput["rate_environment_impact"]) ?? heuristicRateImpact,
			inflation_impact: (llm.inflation_impact as MacroAgentOutput["inflation_impact"]) ?? heuristicInflationImpact,
			key_tailwinds: llm.key_tailwinds && llm.key_tailwinds.length ? llm.key_tailwinds : ["Stabilizing macro indicators support valuation durability."],
			key_headwinds: llm.key_headwinds && llm.key_headwinds.length ? llm.key_headwinds : ["Rate and inflation uncertainty can pressure risk assets."],
			summary:
				typeof llm.summary === "string" && llm.summary.length > 0
					? llm.summary
					: `${ticker} macro backdrop is ${heuristicRateImpact === "NEGATIVE" || heuristicInflationImpact === "NEGATIVE" ? "cautious" : "balanced"} for ${sector}. Focus on rates, inflation trajectory, and yield curve shape for directional risk.`,
			macro_data: macroData,
		};

		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error("[macro-agent] Error:", error);
		return new Response(
			JSON.stringify({ error: "Analysis failed", detail: error instanceof Error ? error.message : String(error) }),
			{ status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
		);
	}
});