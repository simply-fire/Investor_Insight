import yahooFinance from "yahoo-finance2";

import type { OHLCV, QuoteData } from "@/lib/types";

const yahoo = new yahooFinance({
	suppressNotices: ["yahooSurvey", "ripHistorical"],
});

function emptyQuote(ticker: string): QuoteData {
	return {
		ticker: ticker.toUpperCase(),
		price: 0,
		change_pct: 0,
		volume: 0,
		market_cap: 0,
		company_name: ticker.toUpperCase(),
		sector: "Unknown",
	};
}

export async function fetchQuote(ticker: string): Promise<QuoteData> {
	try {
		const normalizedTicker = ticker.toUpperCase();
		const [quote, summary] = await Promise.all([
			yahoo.quote(normalizedTicker),
			yahoo.quoteSummary(normalizedTicker, {
				modules: ["assetProfile", "price"],
			}),
		]);

		const companyName =
			quote.longName ?? quote.shortName ?? summary.price?.longName ?? normalizedTicker;

		return {
			ticker: normalizedTicker,
			price: Number(quote.regularMarketPrice ?? 0),
			change_pct: Number(quote.regularMarketChangePercent ?? 0),
			volume: Number(quote.regularMarketVolume ?? 0),
			market_cap: Number(quote.marketCap ?? 0),
			company_name: companyName,
			sector: summary.assetProfile?.sector ?? "Unknown",
		};
	} catch (error) {
		console.error("[fetchQuote] Error:", error);
		return emptyQuote(ticker);
	}
}

export async function fetchOHLCV(ticker: string, days: number): Promise<OHLCV[]> {
	try {
		const normalizedTicker = ticker.toUpperCase();
		const period1 = new Date();
		const period2 = new Date();
		period1.setDate(period1.getDate() - Math.max(days * 2, days + 30));

		// Use chart() instead of deprecated historical(), with fallback to historical
		let candles: Array<{ date?: Date; open?: number; high?: number; low?: number; close?: number; volume?: number }> = [];
		
		try {
			// Try chart() method first (preferred)
			const chartData = await yahoo.chart(normalizedTicker, {
				period1,
				period2,
				interval: "1d",
			});
			candles = chartData.quotes || [];
		} catch (chartError) {
			// Fallback to historical() if chart() fails
			console.warn("[fetchOHLCV] chart() failed, trying historical():", String(chartError).substring(0, 100));
			try {
				candles = await yahoo.historical(normalizedTicker, {
					period1,
					period2,
					interval: "1d",
				});
			} catch (historicalError) {
				console.error("[fetchOHLCV] Both chart() and historical() failed:", historicalError);
				return [];
			}
		}

		// Filter: only include candles with valid date and close price (minimum viable data)
		return candles
			.filter((candle): candle is { date: Date; open: number; high: number; low: number; close: number; volume: number } => {
				return !!(
					candle.date &&
					typeof candle.close === "number" &&
					candle.close > 0 &&
					candle.open &&
					candle.high &&
					candle.low
				);
			})
			.map((candle) => ({
				date: candle.date.toISOString(),
				open: Number(candle.open),
				high: Number(candle.high),
				low: Number(candle.low),
				close: Number(candle.close),
				volume: Number(candle.volume ?? 0),
			}))
			.slice(-days);
	} catch (error) {
		console.error("[fetchOHLCV] Error:", error);
		return [];
	}
}