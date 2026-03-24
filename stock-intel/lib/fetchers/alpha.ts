import { createClient } from "@supabase/supabase-js";

import type { Fundamentals } from "@/lib/types";

const ALPHA_LIMIT_PER_DAY = 25;

function getSupabaseAdminClient() {
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !serviceRoleKey) {
		return null;
	}

	return createClient(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

function dayBoundsIso() {
	const now = new Date();
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const end = new Date(start);
	end.setUTCDate(end.getUTCDate() + 1);
	return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function isAtDailyLimit(apiName: string, limit: number): Promise<boolean> {
	try {
		const supabase = getSupabaseAdminClient();
		if (!supabase) {
			return false;
		}

		const { startIso, endIso } = dayBoundsIso();
		const { count, error } = await supabase
			.from("api_usage_log")
			.select("id", { count: "exact", head: true })
			.eq("api_name", apiName)
			.gte("called_at", startIso)
			.lt("called_at", endIso);

		if (error) {
			console.warn("[fetchFundamentals] Failed api_usage_log check:", error.message);
			return false;
		}

		return (count ?? 0) >= limit;
	} catch (error) {
		console.warn("[fetchFundamentals] Usage limit check error:", error);
		return false;
	}
}

async function logApiUsage(apiName: string, status: string, ticker: string) {
	try {
		const supabase = getSupabaseAdminClient();
		if (!supabase) {
			return;
		}

		const payload = {
			api_name: `${apiName}:${status}:${ticker}`,
		};

		const { error } = await supabase.from("api_usage_log").insert(payload);
		if (error) {
			console.warn("[fetchFundamentals] Failed to log api usage:", error.message);
		}
	} catch (error) {
		console.warn("[fetchFundamentals] Usage log insert error:", error);
	}
}

function toNumber(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function parseAlphaOverview(ticker: string, raw: Record<string, unknown>): Fundamentals {
	return {
		ticker: ticker.toUpperCase(),
		pe_ratio: toNumber(raw.PERatio),
		eps: toNumber(raw.EPS),
		revenue_growth: toNumber(raw.QuarterlyRevenueGrowthYOY),
		debt_to_equity: toNumber(raw.DebtToEquity),
		profit_margin: toNumber(raw.ProfitMargin),
		roe: toNumber(raw.ReturnOnEquityTTM),
		current_ratio: toNumber(raw.CurrentRatio),
		price_to_book: toNumber(raw.PriceToBookRatio),
		dividend_yield: toNumber(raw.DividendYield),
		source: "alpha_vantage",
	};
}

function parseFmpProfile(ticker: string, raw: Record<string, unknown>): Fundamentals {
	return {
		ticker: ticker.toUpperCase(),
		pe_ratio: toNumber(raw.pe),
		eps: toNumber(raw.eps),
		revenue_growth: 0,
		debt_to_equity: 0,
		profit_margin: 0,
		roe: 0,
		current_ratio: 0,
		price_to_book: toNumber(raw.priceToBookRatio),
		dividend_yield: toNumber(raw.lastDiv),
		source: "fmp",
	};
}

async function fetchFromFmp(ticker: string): Promise<Fundamentals | null> {
	try {
		const fmpKey = process.env.FMP_API_KEY;
		if (!fmpKey) {
			console.warn("[fetchFundamentals] FMP fallback skipped: missing FMP_API_KEY");
			return null;
		}

		const url = `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(ticker)}?apikey=${encodeURIComponent(fmpKey)}`;
		const response = await fetch(url, { cache: "no-store" });
		if (!response.ok) {
			console.error("[fetchFundamentals] FMP request failed:", response.status, response.statusText);
			await logApiUsage("fmp", "error", ticker);
			return null;
		}

		const payload = (await response.json()) as unknown;
		const first = Array.isArray(payload) ? (payload[0] as Record<string, unknown> | undefined) : undefined;
		if (!first) {
			console.warn("[fetchFundamentals] FMP returned empty payload");
			await logApiUsage("fmp", "empty", ticker);
			return null;
		}

		await logApiUsage("fmp", "success", ticker);
		return parseFmpProfile(ticker, first);
	} catch (error) {
		console.error("[fetchFundamentals] FMP fallback error:", error);
		await logApiUsage("fmp", "error", ticker);
		return null;
	}
}

export async function fetchFundamentals(ticker: string): Promise<Fundamentals | null> {
	try {
		const normalizedTicker = ticker.toUpperCase();
		const atLimit = await isAtDailyLimit("alpha_vantage", ALPHA_LIMIT_PER_DAY);

		if (atLimit) {
			console.warn("[fetchFundamentals] Alpha Vantage daily limit reached. Falling back to FMP.");
			return fetchFromFmp(normalizedTicker);
		}

		const apiKey = process.env.ALPHA_VANTAGE_KEY;
		if (!apiKey) {
			console.warn("[fetchFundamentals] Missing ALPHA_VANTAGE_KEY. Falling back to FMP.");
			return fetchFromFmp(normalizedTicker);
		}

		const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(normalizedTicker)}&apikey=${encodeURIComponent(apiKey)}`;
		const response = await fetch(url, { cache: "no-store" });

		if (!response.ok) {
			console.error("[fetchFundamentals] Alpha Vantage request failed:", response.status, response.statusText);
			await logApiUsage("alpha_vantage", "error", normalizedTicker);
			return fetchFromFmp(normalizedTicker);
		}

		const payload = (await response.json()) as Record<string, unknown>;
		if (!payload.Symbol) {
			console.warn("[fetchFundamentals] Alpha Vantage payload missing Symbol, using FMP fallback.");
			await logApiUsage("alpha_vantage", "empty", normalizedTicker);
			return fetchFromFmp(normalizedTicker);
		}

		await logApiUsage("alpha_vantage", "success", normalizedTicker);
		return parseAlphaOverview(normalizedTicker, payload);
	} catch (error) {
		console.error("[fetchFundamentals] Error:", error);
		return null;
	}
}