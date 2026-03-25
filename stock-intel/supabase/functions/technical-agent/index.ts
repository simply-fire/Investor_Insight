import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";

type TechnicalRequest = {
	ticker?: string;
};

type OHLCV = {
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
};

type TechnicalAgentOutput = {
	ticker: string;
	current_price: number;
	trend: "BULLISH" | "BEARISH" | "NEUTRAL";
	indicators: {
		rsi_14: { value: number; signal: "OVERSOLD" | "OVERBOUGHT" | "NEUTRAL"; note: string };
		macd: { value: number; signal: "BULLISH" | "BEARISH" | "NEUTRAL"; note: string };
		sma_50_vs_200: { signal: "GOLDEN_CROSS" | "DEATH_CROSS" | "NEUTRAL"; note: string };
		bollinger: { position: "UPPER_BAND" | "MID_BAND" | "LOWER_BAND"; signal: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL" };
	};
	key_levels: { support: number[]; resistance: number[] };
	pattern_detected: string;
	overall_signal: string;
};

function average(values: number[]): number {
	if (!values.length) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

async function fetchAlphaVantageOHLCV(ticker: string, apiKey: string): Promise<OHLCV[]> {
	const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Alpha Vantage request failed: HTTP ${response.status}`);
	}
	const data = await response.json() as Record<string, unknown>;

	const info = typeof data["Information"] === "string" ? data["Information"] : "";
	const note = typeof data["Note"] === "string" ? data["Note"] : "";
	const errorMessage = typeof data["Error Message"] === "string" ? data["Error Message"] : "";
	if (info) {
		throw new Error(`Alpha Vantage info: ${info}`);
	}
	if (note) {
		throw new Error(`Alpha Vantage note: ${note}`);
	}
	if (errorMessage) {
		throw new Error(`Alpha Vantage error: ${errorMessage}`);
	}

	const timeSeries = data["Time Series (Daily)"] as Record<string, Record<string, unknown>> | undefined;
	if (!timeSeries) {
		throw new Error("Alpha Vantage response missing Time Series (Daily)");
	}

	const dates = Object.keys(timeSeries).sort();
	const ohlcv: OHLCV[] = dates.slice(-200).map((date) => {
		const candle = timeSeries[date];
		return {
			date,
			open: Number(candle["1. open"] ?? 0),
			high: Number(candle["2. high"] ?? 0),
			low: Number(candle["3. low"] ?? 0),
			close: Number(candle["4. close"] ?? 0),
			volume: Number(candle["5. volume"] ?? 0),
		};
	});

	return ohlcv;
}

function calculateEmaSeries(values: number[], period: number): number[] {
	if (!values.length) return [];
	const k = 2 / (period + 1);
	const ema: number[] = [values[0]];
	for (let i = 1; i < values.length; i += 1) {
		ema.push((values[i] * k) + (ema[i - 1] * (1 - k)));
	}
	return ema;
}

function calculateRsiWilder(closes: number[], period = 14): number {
	if (closes.length <= period) return 0;

	let gains = 0;
	let losses = 0;
	for (let i = 1; i <= period; i += 1) {
		const change = closes[i] - closes[i - 1];
		if (change >= 0) gains += change;
		else losses += Math.abs(change);
	}

	let avgGain = gains / period;
	let avgLoss = losses / period;

	for (let i = period + 1; i < closes.length; i += 1) {
		const change = closes[i] - closes[i - 1];
		const gain = change > 0 ? change : 0;
		const loss = change < 0 ? Math.abs(change) : 0;
		avgGain = ((avgGain * (period - 1)) + gain) / period;
		avgLoss = ((avgLoss * (period - 1)) + loss) / period;
	}

	if (avgLoss === 0) return 100;
	const rs = avgGain / avgLoss;
	return 100 - (100 / (1 + rs));
}

function findSupportAndResistance(closes: number[]): { support: number[]; resistance: number[] } {
	const support: number[] = [];
	const resistance: number[] = [];

	for (let i = 2; i < closes.length - 2; i += 1) {
		const window = closes.slice(i - 2, i + 3);
		const current = closes[i];
		if (current === Math.min(...window)) support.push(current);
		if (current === Math.max(...window)) resistance.push(current);
	}

	return {
		support: support.slice(-3).map(round),
		resistance: resistance.slice(-3).map(round),
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
		const body = (await req.json()) as TechnicalRequest;
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

		const alphaKey = Deno.env.get("ALPHA_VANTAGE_KEY");
		if (!alphaKey) {
			return new Response(
				JSON.stringify({ error: "ALPHA_VANTAGE_KEY is missing" }),
				{ status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
			);
		}

		let candles: OHLCV[] = [];

		try {
			candles = await fetchAlphaVantageOHLCV(ticker, alphaKey);
		} catch (error) {
			console.error("[technical-agent] Alpha Vantage error:", error);
			return new Response(
				JSON.stringify({ 
					error: "Technical data unavailable", 
					detail: error instanceof Error ? error.message : "Failed to fetch OHLCV data"
				}),
				{ status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
			);
		}

		if (!candles.length) {
			return new Response(JSON.stringify({ error: "No OHLCV data available" }), {
				status: 502,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			});
		}

		const closes = candles.map((c) => c.close);
		const currentPrice = closes.at(-1) ?? 0;

		const rsi = calculateRsiWilder(closes, 14);
		const ema12Series = calculateEmaSeries(closes, 12);
		const ema26Series = calculateEmaSeries(closes, 26);
		const macdSeries = closes.map((_, idx) => ema12Series[idx] - ema26Series[idx]);
		const signalSeries = calculateEmaSeries(macdSeries, 9);
		const macd = macdSeries.at(-1) ?? 0;
		const macdSignal = signalSeries.at(-1) ?? 0;

		const sma50 = average(closes.slice(-50));
		const sma200 = average(closes.slice(-200));

		const bbWindow = closes.slice(-20);
		const bbMid = average(bbWindow);
		const variance = average(bbWindow.map((v) => (v - bbMid) ** 2));
		const stdDev = Math.sqrt(variance);
		const bbUpper = bbMid + (2 * stdDev);
		const bbLower = bbMid - (2 * stdDev);

		const levels = findSupportAndResistance(closes);

		const rsiSignal = rsi < 30 ? "OVERSOLD" : rsi > 70 ? "OVERBOUGHT" : "NEUTRAL";
		const macdSignalLabel = macd > macdSignal ? "BULLISH" : macd < macdSignal ? "BEARISH" : "NEUTRAL";
		const crossSignal = sma50 > sma200 ? "GOLDEN_CROSS" : sma50 < sma200 ? "DEATH_CROSS" : "NEUTRAL";
		const bbPosition = currentPrice <= bbLower
			? "LOWER_BAND"
			: currentPrice >= bbUpper
			? "UPPER_BAND"
			: "MID_BAND";
		const bbSignal = bbPosition === "LOWER_BAND" ? "OVERSOLD" : bbPosition === "UPPER_BAND" ? "OVERBOUGHT" : "NEUTRAL";

		const trend: "BULLISH" | "BEARISH" | "NEUTRAL" =
			crossSignal === "GOLDEN_CROSS" && macdSignalLabel === "BULLISH"
				? "BULLISH"
				: crossSignal === "DEATH_CROSS" && macdSignalLabel === "BEARISH"
				? "BEARISH"
				: "NEUTRAL";

		let pattern = "No strong chart pattern detected";
		if (crossSignal === "GOLDEN_CROSS") pattern = "Golden cross suggests trend-strengthening momentum.";
		if (crossSignal === "DEATH_CROSS") pattern = "Death cross suggests medium-term downside pressure.";
		if (rsiSignal === "OVERSOLD") pattern = `${pattern} RSI indicates oversold conditions near support.`;

		const overallSignal =
			trend === "BULLISH"
				? "BUY_BIAS"
				: trend === "BEARISH" && rsiSignal !== "OVERSOLD"
				? "RISK_OFF"
				: "CAUTIOUS_BUY";

		const result: TechnicalAgentOutput = {
			ticker,
			current_price: round(currentPrice),
			trend,
			indicators: {
				rsi_14: {
					value: round(rsi),
					signal: rsiSignal,
					note: rsiSignal === "OVERSOLD" ? "RSI below 30" : rsiSignal === "OVERBOUGHT" ? "RSI above 70" : "RSI in neutral range",
				},
				macd: {
					value: round(macd),
					signal: macdSignalLabel,
					note: macdSignalLabel === "BULLISH" ? "MACD above signal line" : macdSignalLabel === "BEARISH" ? "MACD below signal line" : "MACD flat",
				},
				sma_50_vs_200: {
					signal: crossSignal,
					note: crossSignal === "GOLDEN_CROSS" ? "50-day MA above 200-day MA" : crossSignal === "DEATH_CROSS" ? "50-day MA below 200-day MA" : "Moving averages converged",
				},
				bollinger: {
					position: bbPosition,
					signal: bbSignal,
				},
			},
			key_levels: {
				support: levels.support,
				resistance: levels.resistance,
			},
			pattern_detected: pattern,
			overall_signal: overallSignal,
		};

		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error("[technical-agent] Error:", error);
		return new Response(
			JSON.stringify({ error: "Analysis failed", detail: error instanceof Error ? error.message : String(error) }),
			{ status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
		);
	}
});