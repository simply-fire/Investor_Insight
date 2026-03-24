import type { OHLCV, Technicals } from "@/lib/types";

function emptyTechnicals(): Technicals {
	return {
		rsi_14: 0,
		macd: 0,
		macd_signal: 0,
		macd_hist: 0,
		sma_50: 0,
		sma_200: 0,
		ema_20: 0,
		bollinger_upper: 0,
		bollinger_lower: 0,
		bollinger_mid: 0,
		volume_avg_20: 0,
		support_levels: [],
		resistance_levels: [],
	};
}

function average(values: number[]): number {
	if (!values.length) {
		return 0;
	}

	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateRsiWilder(closes: number[], period = 14): number {
	if (closes.length <= period) {
		return 0;
	}

	let gains = 0;
	let losses = 0;

	for (let i = 1; i <= period; i += 1) {
		const change = closes[i] - closes[i - 1];
		if (change >= 0) {
			gains += change;
		} else {
			losses += Math.abs(change);
		}
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

	if (avgLoss === 0) {
		return 100;
	}

	const rs = avgGain / avgLoss;
	return 100 - (100 / (1 + rs));
}

function calculateEmaSeries(values: number[], period: number): number[] {
	if (!values.length) {
		return [];
	}

	const k = 2 / (period + 1);
	const ema: number[] = [values[0]];

	for (let i = 1; i < values.length; i += 1) {
		ema.push((values[i] * k) + (ema[i - 1] * (1 - k)));
	}

	return ema;
}

function findSupportAndResistance(closes: number[]): { support: number[]; resistance: number[] } {
	const support: number[] = [];
	const resistance: number[] = [];

	for (let i = 2; i < closes.length - 2; i += 1) {
		const window = closes.slice(i - 2, i + 3);
		const current = closes[i];
		const min = Math.min(...window);
		const max = Math.max(...window);

		if (current === min) {
			support.push(current);
		}

		if (current === max) {
			resistance.push(current);
		}
	}

	return {
		support: support.slice(-3),
		resistance: resistance.slice(-3),
	};
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

export function computeTechnicals(ohlcv: OHLCV[]): Technicals {
	try {
		if (!ohlcv.length) {
			return emptyTechnicals();
		}

		const closes = ohlcv.map((candle) => candle.close);
		const volumes = ohlcv.map((candle) => candle.volume);

		const rsi14 = calculateRsiWilder(closes, 14);

		const ema12Series = calculateEmaSeries(closes, 12);
		const ema26Series = calculateEmaSeries(closes, 26);
		const macdSeries = closes.map((_, index) => ema12Series[index] - ema26Series[index]);
		const signalSeries = calculateEmaSeries(macdSeries, 9);

		const macd = macdSeries.at(-1) ?? 0;
		const macdSignal = signalSeries.at(-1) ?? 0;
		const macdHist = macd - macdSignal;

		const sma50 = average(closes.slice(-50));
		const sma200 = average(closes.slice(-200));
		const ema20 = calculateEmaSeries(closes, 20).at(-1) ?? 0;

		const bbWindow = closes.slice(-20);
		const bollingerMid = average(bbWindow);
		const variance = average(bbWindow.map((value) => (value - bollingerMid) ** 2));
		const stdDev = Math.sqrt(variance);
		const bollingerUpper = bollingerMid + (2 * stdDev);
		const bollingerLower = bollingerMid - (2 * stdDev);

		const volumeAvg20 = average(volumes.slice(-20));
		const levels = findSupportAndResistance(closes);

		return {
			rsi_14: round(rsi14),
			macd: round(macd),
			macd_signal: round(macdSignal),
			macd_hist: round(macdHist),
			sma_50: round(sma50),
			sma_200: round(sma200),
			ema_20: round(ema20),
			bollinger_upper: round(bollingerUpper),
			bollinger_lower: round(bollingerLower),
			bollinger_mid: round(bollingerMid),
			volume_avg_20: round(volumeAvg20),
			support_levels: levels.support.map(round),
			resistance_levels: levels.resistance.map(round),
		};
	} catch (error) {
		console.error("[computeTechnicals] Error:", error);
		return emptyTechnicals();
	}
}