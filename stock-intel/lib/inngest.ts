import { createClient } from "@supabase/supabase-js";
import { Inngest } from "inngest";

import { fetchOHLCV, fetchQuote } from "@/lib/fetchers/yahoo";

type AgentName = "fundamental-agent" | "technical-agent" | "news-agent" | "macro-agent" | "verdict-agent";

type PersistedVerdict = {
	long_term: unknown;
	swing_trade: unknown;
	day_trade: unknown;
};

function requireEnv(value: string | undefined, key: string): string {
	if (!value) {
		throw new Error(`Missing required env var: ${key}`);
	}

	return value;
}

function isPersistedVerdict(value: unknown): value is PersistedVerdict {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return (
		"long_term" in candidate &&
		"swing_trade" in candidate &&
		"day_trade" in candidate
	);
}

async function callAgent(name: AgentName, payload: Record<string, unknown>): Promise<unknown> {
	const supabaseUrl = requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
	const serviceRoleKey = requireEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");

	const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${serviceRoleKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`[${name}] request failed (${response.status} ${response.statusText}): ${body}`);
	}

	return response.json();
}

function computeExpiry(): string {
	const now = new Date();
	const etOffset = -5; // EST (adjust to -4 for EDT — use a proper tz lib or hardcode conservatively)
	const etHour = (now.getUTCHours() + 24 + etOffset) % 24;
	const etMinutes = now.getUTCMinutes();
	const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat
	const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
	const isMarketHours = isWeekday && (etHour > 9 || (etHour === 9 && etMinutes >= 30)) && etHour < 16;
	const ttlMs = isMarketHours ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
	return new Date(Date.now() + ttlMs).toISOString();
}

export const inngest = new Inngest({ 
  id: "stock-intel",
	isDev: process.env.NODE_ENV !== "production",
});

export const analyzeStock = inngest.createFunction(
	{ id: "analyze-stock", retries: 2, triggers: { event: "stock/analyze" } },
	async ({ event, step }) => {
		const ticker = String(event.data?.ticker ?? "").trim().toUpperCase();
		if (!ticker) {
			throw new Error("stock/analyze requires data.ticker");
		}

		const [quote, ohlcv, fundamental, technical, news, macro] = await Promise.all([
			step.run("quote", async () => {
				try {
					return await fetchQuote(ticker);
				} catch (error) {
					console.error("[analyze-stock] quote fetch failed:", error);
					return null;
				}
			}),
			step.run("ohlcv", async () => {
				try {
					return await fetchOHLCV(ticker, 200);
				} catch (error) {
					console.error("[analyze-stock] ohlcv fetch failed:", error);
					return [];
				}
			}),
			step.run("fundamental-agent", async () => {
				try {
					return await callAgent("fundamental-agent", { ticker });
				} catch (error) {
					console.error("[analyze-stock] fundamental-agent failed:", error);
					return null;
				}
			}),
			step.run("technical-agent", async () => {
				try {
					return await callAgent("technical-agent", { ticker });
				} catch (error) {
					console.error("[analyze-stock] technical-agent failed:", error);
					return null;
				}
			}),
			step.run("news-agent", async () => {
				try {
					return await callAgent("news-agent", { ticker });
				} catch (error) {
					console.error("[analyze-stock] news-agent failed:", error);
					return null;
				}
			}),
			step.run("macro-agent", async () => {
				try {
					return await callAgent("macro-agent", { ticker });
				} catch (error) {
					console.error("[analyze-stock] macro-agent failed:", error);
					return null;
				}
			}),
		]);

		const verdict = await step.run("verdict-agent", async () => {
			return callAgent("verdict-agent", {
				ticker,
				fundamental,
				technical,
				news,
				macro,
			});
		});

		await step.run("persist", async () => {
			const supabaseUrl = requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
			const serviceRoleKey = requireEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
			const supabase = createClient(supabaseUrl, serviceRoleKey);

			const expiresAt = computeExpiry();
			const payload = {
				ticker,
				quote,
				ohlcv,
				fundamental,
				technical,
				news,
				macro,
				verdict,
				generated_at: new Date().toISOString(),
			};

			const { error: cacheError } = await supabase
				.from("analysis_cache")
				.upsert(
					{
						ticker,
						data: payload,
						expires_at: expiresAt,
					},
					{
						onConflict: "ticker",
					},
				);

			if (cacheError) {
				throw new Error(`Failed to persist analysis_cache: ${cacheError.message}`);
			}

			if (!isPersistedVerdict(verdict)) {
				throw new Error("verdict-agent returned an invalid payload shape");
			}

			const { error: verdictError } = await supabase
				.from("verdicts")
				.insert({
					ticker,
					long_term: verdict.long_term,
					swing_trade: verdict.swing_trade,
					day_trade: verdict.day_trade,
				});

			if (verdictError) {
				throw new Error(`Failed to insert verdicts row: ${verdictError.message}`);
			}

			return { expires_at: expiresAt };
		});

		return {
			ticker,
			quote,
			ohlcv,
			fundamental,
			technical,
			news,
			macro,
			verdict,
		};
	},
);