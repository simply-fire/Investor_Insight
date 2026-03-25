import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";

type FundamentalRequest = {
	ticker?: string;
};

type FundamentalAgentOutput = {
	ticker: string;
	valuation: { pe_ratio: number; pb_ratio: number; score: number; note: string };
	profitability: { profit_margin: number; roe: number; score: number; note: string };
	growth: { revenue_growth_yoy: number; eps_growth: number; score: number; note: string };
	financial_health: { debt_to_equity: number; current_ratio: number; score: number; note: string };
	dividend: { dividend_yield: number; score: number; note: string };
	overall_score: number;
	summary: string;
};

function toNumber(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function clampScore(score: number): number {
	return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

function valuationScore(pe: number, pb: number): number {
	let score = 5;
	if (pe > 0) {
		if (pe < 15) score += 3;
		else if (pe < 25) score += 1;
		else if (pe > 40) score -= 3;
		else if (pe > 30) score -= 1;
	}
	if (pb > 0) {
		if (pb < 3) score += 2;
		else if (pb > 12) score -= 2;
	}
	return clampScore(score);
}

function profitabilityScore(profitMargin: number, roe: number): number {
	let score = 4;
	if (profitMargin >= 0.2) score += 3;
	else if (profitMargin >= 0.1) score += 2;
	else if (profitMargin < 0) score -= 3;

	if (roe >= 0.2) score += 3;
	else if (roe >= 0.1) score += 2;
	else if (roe < 0.05) score -= 2;

	return clampScore(score);
}

function growthScore(revenueGrowth: number, epsGrowth: number): number {
	let score = 4;
	if (revenueGrowth >= 0.15) score += 3;
	else if (revenueGrowth >= 0.05) score += 2;
	else if (revenueGrowth < 0) score -= 3;

	if (epsGrowth >= 0.15) score += 3;
	else if (epsGrowth >= 0.05) score += 2;
	else if (epsGrowth < 0) score -= 2;

	return clampScore(score);
}

function healthScore(debtToEquity: number, currentRatio: number): number {
	let score = 5;
	if (debtToEquity > 2) score -= 3;
	else if (debtToEquity > 1) score -= 1;
	else if (debtToEquity > 0 && debtToEquity < 0.5) score += 2;

	if (currentRatio >= 2) score += 2;
	else if (currentRatio >= 1) score += 1;
	else if (currentRatio > 0 && currentRatio < 0.8) score -= 2;

	return clampScore(score);
}

function dividendScore(dividendYield: number): number {
	if (dividendYield >= 0.04) return 9;
	if (dividendYield >= 0.025) return 7;
	if (dividendYield > 0) return 5;
	return 3;
}

async function summarizeWithGemini(payload: FundamentalAgentOutput): Promise<string> {
	try {
		const geminiKey = Deno.env.get("GEMINI_API_KEY");
		if (!geminiKey) {
			return "Fundamentals indicate mixed signals with a balance of strengths and valuation risks. Review profitability, growth consistency, and balance-sheet resilience before taking a directional view.";
		}

		const prompt = `You are a senior equity analyst. Write a plain-English 50-100 word summary for ${payload.ticker} fundamentals using these exact values: ${JSON.stringify(payload)}. Be concise and balanced.`;
		const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;

		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
			}),
		});

		if (!response.ok) {
			return "Fundamental profile is serviceable, but investors should monitor valuation pressure, earnings quality, and debt trends for forward risk.";
		}

		const raw = await response.json();
		const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
		return typeof text === "string" && text.trim().length > 0
			? text.trim()
			: "Fundamental data suggests a mixed outlook with strong and weak areas that should be weighed against valuation and risk tolerance.";
	} catch (error) {
		console.error("[fundamental-agent] Gemini summary error:", error);
		return "Fundamental data is available, but summary generation failed. Use the scored dimensions to guide interpretation.";
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
		const body = (await req.json()) as FundamentalRequest;
		const ticker = (body.ticker ?? "").toUpperCase().trim();

		if (!ticker) {
			return new Response(JSON.stringify({ error: "ticker is required" }), {
				status: 400,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			});
		}

		console.log("[fundamental-agent] Starting analysis for", ticker);

		const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
		const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
		if (supabaseUrl && supabaseKey) {
			createClient(supabaseUrl, supabaseKey);
		}

		const alphaKey = Deno.env.get("ALPHA_VANTAGE_KEY");
		if (!alphaKey) {
			console.error("[fundamental-agent] ALPHA_VANTAGE_KEY is missing!");
			return new Response(
				JSON.stringify({ error: "ALPHA_VANTAGE_KEY is missing", detail: "Set env var and retry." }),
				{ status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
			);
		}

		console.log("[fundamental-agent] Fetching from Alpha Vantage...");
		const overviewUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(alphaKey)}`;
		const overviewResponse = await fetch(overviewUrl);
		if (!overviewResponse.ok) {
			console.error("[fundamental-agent] Alpha Vantage error:", overviewResponse.status, overviewResponse.statusText);
			return new Response(JSON.stringify({ error: "Failed to fetch Alpha Vantage overview" }), {
				status: 502,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			});
		}

		console.log("[fundamental-agent] Alpha Vantage response received");
		const raw = await overviewResponse.json();

		const peRatio = toNumber(raw?.PERatio);
		const pbRatio = toNumber(raw?.PriceToBookRatio);
		const profitMargin = toNumber(raw?.ProfitMargin);
		const roe = toNumber(raw?.ReturnOnEquityTTM);
		const revenueGrowth = toNumber(raw?.QuarterlyRevenueGrowthYOY);
		const epsGrowth = toNumber(raw?.QuarterlyEarningsGrowthYOY);
		const debtToEquity = toNumber(raw?.DebtToEquity);
		const currentRatio = toNumber(raw?.CurrentRatio);
		const dividendYield = toNumber(raw?.DividendYield);

		const valuation = {
			pe_ratio: peRatio,
			pb_ratio: pbRatio,
			score: valuationScore(peRatio, pbRatio),
			note: peRatio > 30 ? "Premium valuation vs peers" : "Valuation appears reasonable against current metrics",
		};

		const profitability = {
			profit_margin: profitMargin,
			roe,
			score: profitabilityScore(profitMargin, roe),
			note: profitMargin > 0.2 ? "Strong margin profile" : "Profitability is moderate and should be monitored",
		};

		const growth = {
			revenue_growth_yoy: revenueGrowth,
			eps_growth: epsGrowth,
			score: growthScore(revenueGrowth, epsGrowth),
			note: revenueGrowth > 0.08 ? "Healthy top-line momentum" : "Growth has slowed versus high-growth peers",
		};

		const financialHealth = {
			debt_to_equity: debtToEquity,
			current_ratio: currentRatio,
			score: healthScore(debtToEquity, currentRatio),
			note: debtToEquity > 1.5 ? "Balance sheet is leveraged" : "Leverage looks manageable",
		};

		const dividend = {
			dividend_yield: dividendYield,
			score: dividendScore(dividendYield),
			note: dividendYield > 0 ? "Shareholder return supported by dividend" : "No meaningful dividend support",
		};

		const overallScore = clampScore(
			(valuation.score + profitability.score + growth.score + financialHealth.score + dividend.score) / 5,
		);

		const result: FundamentalAgentOutput = {
			ticker,
			valuation,
			profitability,
			growth,
			financial_health: financialHealth,
			dividend,
			overall_score: overallScore,
			summary: "",
		};

		result.summary = await summarizeWithGemini(result);

		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error("[fundamental-agent] Error:", error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return new Response(
			JSON.stringify({ error: "Analysis failed", detail: errorMessage }),
			{ status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
		);
	}
});