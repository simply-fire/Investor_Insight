import type { MacroData } from "@/lib/types";

function emptyMacroData(): MacroData {
	return {
		fed_funds_rate: 0,
		cpi_yoy: 0,
		unemployment_rate: 0,
		gdp_growth_qoq: 0,
		yield_10y: 0,
		yield_2y: 0,
		yield_spread: 0,
	};
}

function toNumber(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

interface FredObservation {
	value: string;
}

interface FredResponse {
	observations?: FredObservation[];
}

async function fetchSeries(seriesId: string, limit = 1): Promise<number[]> {
	const apiKey = process.env.FRED_API_KEY;
	if (!apiKey) {
		console.warn(`[fetchMacroData] Missing FRED_API_KEY for ${seriesId}`);
		return [];
	}

	const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}&limit=${limit}&sort_order=desc&file_type=json`;
	const response = await fetch(url, { cache: "no-store" });

	if (!response.ok) {
		console.error(`[fetchMacroData] FRED request failed for ${seriesId}:`, response.status, response.statusText);
		return [];
	}

	const payload = (await response.json()) as FredResponse;
	return (payload.observations ?? [])
		.map((obs) => toNumber(obs.value))
		.filter((value) => Number.isFinite(value));
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

export async function fetchMacroData(): Promise<MacroData> {
	try {
		const [fedFunds, cpiSeries, unemployment, gdpGrowth, yield10y, yield2y] = await Promise.all([
			fetchSeries("FEDFUNDS", 1),
			fetchSeries("CPIAUCSL", 13),
			fetchSeries("UNRATE", 1),
			fetchSeries("A191RL1Q225SBEA", 1),
			fetchSeries("DGS10", 1),
			fetchSeries("DGS2", 1),
		]);

		const cpiLatest = cpiSeries[0] ?? 0;
		const cpiPriorYear = cpiSeries[12] ?? 0;
		const cpiYoy = cpiPriorYear > 0 ? ((cpiLatest - cpiPriorYear) / cpiPriorYear) * 100 : 0;

		const yield10 = yield10y[0] ?? 0;
		const yield2 = yield2y[0] ?? 0;

		return {
			fed_funds_rate: round(fedFunds[0] ?? 0),
			cpi_yoy: round(cpiYoy),
			unemployment_rate: round(unemployment[0] ?? 0),
			gdp_growth_qoq: round(gdpGrowth[0] ?? 0),
			yield_10y: round(yield10),
			yield_2y: round(yield2),
			yield_spread: round(yield10 - yield2),
		};
	} catch (error) {
		console.error("[fetchMacroData] Error:", error);
		return emptyMacroData();
	}
}