"use client";

import { useEffect, useMemo, useRef } from "react";
import {
	CandlestickSeries,
	ColorType,
	createChart,
	LineSeries,
	LineStyle,
	type ISeriesApi,
	type Time,
} from "lightweight-charts";
import {
	Line,
	LineChart,
	ReferenceLine,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OHLCV, TechnicalAgentOutput } from "@/lib/types";

type TechnicalPanelProps = {
	data: TechnicalAgentOutput | null | undefined;
	ohlcv: OHLCV[];
};

function average(values: number[]) {
	if (!values.length) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeSma(values: number[], period: number) {
	return values.map((_, index) => {
		if (index + 1 < period) return null;
		return average(values.slice(index + 1 - period, index + 1));
	});
}

function computeBollinger(values: number[], period: number) {
	return values.map((_, index) => {
		if (index + 1 < period) return null;
		const window = values.slice(index + 1 - period, index + 1);
		const mid = average(window);
		const variance = average(window.map((v) => (v - mid) ** 2));
		const stdDev = Math.sqrt(variance);
		return { upper: mid + (2 * stdDev), lower: mid - (2 * stdDev) };
	});
}

function computeRsiSeries(closes: number[], period = 14) {
	if (closes.length <= period) return [] as Array<{ index: number; rsi: number }>;

	const result: Array<{ index: number; rsi: number }> = [];
	let gains = 0;
	let losses = 0;

	for (let index = 1; index <= period; index += 1) {
		const change = closes[index] - closes[index - 1];
		if (change >= 0) gains += change;
		else losses += Math.abs(change);
	}

	let avgGain = gains / period;
	let avgLoss = losses / period;

	for (let index = period + 1; index < closes.length; index += 1) {
		const change = closes[index] - closes[index - 1];
		const gain = change > 0 ? change : 0;
		const loss = change < 0 ? Math.abs(change) : 0;
		avgGain = ((avgGain * (period - 1)) + gain) / period;
		avgLoss = ((avgLoss * (period - 1)) + loss) / period;

		const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
		const rsi = 100 - (100 / (1 + rs));
		result.push({ index, rsi: Number(rsi.toFixed(2)) });
	}

	return result;
}

function trendClass(trend: TechnicalAgentOutput["trend"]) {
	if (trend === "BULLISH") return "bg-emerald-600 text-white";
	if (trend === "BEARISH") return "bg-red-600 text-white";
	return "bg-slate-500 text-white";
}

export function TechnicalPanel({ data, ohlcv }: TechnicalPanelProps) {
	const chartRef = useRef<HTMLDivElement | null>(null);
	const supportLevels = data?.key_levels?.support ?? [];
	const resistanceLevels = data?.key_levels?.resistance ?? [];

	const closes = useMemo(() => ohlcv.map((item) => item.close), [ohlcv]);
	const sma50 = useMemo(() => computeSma(closes, 50), [closes]);
	const sma200 = useMemo(() => computeSma(closes, 200), [closes]);
	const bollinger = useMemo(() => computeBollinger(closes, 20), [closes]);
	const rsiSeries = useMemo(() => computeRsiSeries(closes, 14), [closes]);

	useEffect(() => {
		if (!data || !chartRef.current || ohlcv.length === 0) {
			return;
		}

		const chart = createChart(chartRef.current, {
			height: 420,
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: "#94a3b8",
			},
			rightPriceScale: {
				borderColor: "#475569",
			},
			timeScale: {
				borderColor: "#475569",
			},
			grid: {
				vertLines: { color: "rgba(148,163,184,0.1)" },
				horzLines: { color: "rgba(148,163,184,0.1)" },
			},
		});

		const candles = chart.addSeries(CandlestickSeries, {
			upColor: "#16a34a",
			borderUpColor: "#16a34a",
			wickUpColor: "#16a34a",
			downColor: "#dc2626",
			borderDownColor: "#dc2626",
			wickDownColor: "#dc2626",
		});

		const addLine = (color: string, width = 2, lineStyle = LineStyle.Solid) =>
			chart.addSeries(LineSeries, {
				color,
				lineWidth: width,
				lineStyle,
			});

		const sma50Series = addLine("#3b82f6", 2, LineStyle.Dashed);
		const sma200Series = addLine("#f59e0b", 2, LineStyle.Dashed);
		const bbUpperSeries = addLine("#94a3b8", 1, LineStyle.Solid);
		const bbLowerSeries = addLine("#94a3b8", 1, LineStyle.Solid);

		candles.setData(
			ohlcv.map((item) => ({
				time: item.date.slice(0, 10) as Time,
				open: item.open,
				high: item.high,
				low: item.low,
				close: item.close,
			})),
		);

		const mapSeries = (
			series: ISeriesApi<"Line">,
			values: Array<number | null>,
		) => {
			series.setData(
				values
					.map((value, index) => {
						if (value === null) return null;
						return {
							time: ohlcv[index].date.slice(0, 10) as Time,
							value,
						};
					})
					.filter((item): item is { time: Time; value: number } => item !== null),
			);
		};

		mapSeries(sma50Series, sma50);
		mapSeries(sma200Series, sma200);
		mapSeries(
			bbUpperSeries,
			bollinger.map((item) => item?.upper ?? null),
		);
		mapSeries(
			bbLowerSeries,
			bollinger.map((item) => item?.lower ?? null),
		);

		supportLevels.forEach((level) => {
			candles.createPriceLine({
				price: level,
				color: "#22c55e",
				lineWidth: 1,
				axisLabelVisible: true,
				title: "Support",
			});
		});

		resistanceLevels.forEach((level) => {
			candles.createPriceLine({
				price: level,
				color: "#ef4444",
				lineWidth: 1,
				axisLabelVisible: true,
				title: "Resistance",
			});
		});

		chart.timeScale().fitContent();

		return () => {
			chart.remove();
		};
	}, [bollinger, data, ohlcv, resistanceLevels, sma50, sma200, supportLevels]);

	if (!data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Technical Analysis Unavailable</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						Technical signals are not available for this run. Retry analysis to regenerate this section.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between gap-2">
						<CardTitle>Technical Regime</CardTitle>
						<Badge className={trendClass(data.trend)}>{data.trend}</Badge>
					</div>
				</CardHeader>
				<CardContent>
					<div ref={chartRef} className="w-full" />
				</CardContent>
			</Card>

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<Card>
					<CardHeader>
						<CardTitle>RSI</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-2xl font-semibold tabular-nums">{data.indicators.rsi_14.value?.toFixed(2) ?? "--"}</p>
						<Badge variant="outline" className="mt-2">{data.indicators.rsi_14.signal}</Badge>
						<p className="mt-2 text-xs text-muted-foreground">{data.indicators.rsi_14.note}</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>MACD</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-2xl font-semibold tabular-nums">{data.indicators.macd.value?.toFixed(2) ?? "--"}</p>
						<Badge variant="outline" className="mt-2">{data.indicators.macd.signal}</Badge>
						<p className="mt-2 text-xs text-muted-foreground">{data.indicators.macd.note}</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>SMA Cross</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-lg font-semibold">{data.indicators.sma_50_vs_200.signal}</p>
						<Badge variant="outline" className="mt-2">Trend Signal</Badge>
						<p className="mt-2 text-xs text-muted-foreground">{data.indicators.sma_50_vs_200.note}</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Bollinger</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-lg font-semibold">{data.indicators.bollinger.position ?? "MID_BAND"}</p>
						<Badge variant="outline" className="mt-2">{data.indicators.bollinger.signal}</Badge>
						<p className="mt-2 text-xs text-muted-foreground">Position relative to 20D volatility bands.</p>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>RSI Mini-Chart</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="h-25 w-full">
						<ResponsiveContainer width="100%" height="100%">
							<LineChart data={rsiSeries}>
								<XAxis hide dataKey="index" />
								<YAxis domain={[0, 100]} hide />
								<ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" />
								<ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 4" />
								<Line
									dataKey="rsi"
									type="monotone"
									dot={false}
									stroke="#3b82f6"
									strokeWidth={2}
									isAnimationActive={false}
								/>
							</LineChart>
						</ResponsiveContainer>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}