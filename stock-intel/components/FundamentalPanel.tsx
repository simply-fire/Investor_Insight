"use client";

import {
	PolarAngleAxis,
	PolarGrid,
	Radar,
	RadarChart,
	ResponsiveContainer,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { FundamentalAgentOutput } from "@/lib/types";

type FundamentalPanelProps = {
	data: FundamentalAgentOutput;
};

type MetricRow = {
	name: string;
	value: number;
	kind: "high_good" | "low_good" | "neutral";
};

function metricTone(value: number, kind: MetricRow["kind"]) {
	if (kind === "neutral") return "text-muted-foreground";

	const good =
		kind === "high_good"
			? value > 0
			: value > 0 && value <= 1;

	return good
		? "text-emerald-600 dark:text-emerald-400"
		: "text-red-600 dark:text-red-400";
}

export function FundamentalPanel({ data }: FundamentalPanelProps) {
	const radarData = [
		{ axis: "Valuation", score: data.valuation.score },
		{ axis: "Profitability", score: data.profitability.score },
		{ axis: "Growth", score: data.growth.score },
		{ axis: "Health", score: data.financial_health.score },
		{ axis: "Dividend", score: data.dividend?.score ?? 0 },
	];

	const rows: MetricRow[] = [
		{ name: "P/E Ratio", value: data.valuation.pe_ratio, kind: "low_good" },
		{ name: "P/B Ratio", value: data.valuation.pb_ratio, kind: "low_good" },
		{ name: "Profit Margin", value: data.profitability.profit_margin, kind: "high_good" },
		{ name: "ROE", value: data.profitability.roe, kind: "high_good" },
		{ name: "Revenue Growth YoY", value: data.growth.revenue_growth_yoy, kind: "high_good" },
		{ name: "EPS Growth", value: data.growth.eps_growth, kind: "high_good" },
		{ name: "Debt to Equity", value: data.financial_health.debt_to_equity, kind: "low_good" },
		{ name: "Current Ratio", value: data.financial_health.current_ratio, kind: "high_good" },
		{ name: "Dividend Yield", value: data.dividend?.dividend_yield ?? 0, kind: "high_good" },
	];

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Fundamental Score</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-4xl font-semibold tabular-nums">{data.overall_score.toFixed(1)} / 10</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Dimension Breakdown</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="h-72 w-full">
						<ResponsiveContainer width="100%" height="100%">
							<RadarChart data={radarData}>
								<PolarGrid stroke="currentColor" className="text-border" />
								<PolarAngleAxis dataKey="axis" className="text-xs text-muted-foreground" />
								<Radar
									dataKey="score"
									stroke="rgb(59 130 246)"
									fill="rgb(59 130 246)"
									fillOpacity={0.25}
								/>
							</RadarChart>
						</ResponsiveContainer>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Raw Metrics</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Metric</TableHead>
								<TableHead className="text-right">Value</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.name}>
									<TableCell>{row.name}</TableCell>
									<TableCell className={`text-right font-medium tabular-nums ${metricTone(row.value, row.kind)}`}>
										{row.value.toFixed(2)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Summary</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="leading-relaxed text-muted-foreground">{data.summary}</p>
				</CardContent>
			</Card>
		</div>
	);
}