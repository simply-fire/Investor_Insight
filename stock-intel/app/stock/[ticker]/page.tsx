"use client";

import { useParams } from "next/navigation";

import { ChatPanel } from "@/components/ChatPanel";
import { FundamentalPanel } from "@/components/FundamentalPanel";
import { LoadingState } from "@/components/LoadingState";
import { NewsPanel } from "@/components/NewsPanel";
import { TechnicalPanel } from "@/components/TechnicalPanel";
import { VerdictCard } from "@/components/VerdictCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAnalysis } from "@/hooks/useAnalysis";

export default function StockPage() {
	const params = useParams<{ ticker: string }>();
	const ticker = (params.ticker ?? "").toUpperCase();
	const { status, data, error } = useAnalysis(ticker);

	const companyName = data?.quote?.company_name ?? ticker;
	const currentPrice = data?.quote?.price ?? data?.technical.current_price ?? 0;
	const changePct = data?.quote?.change_pct ?? 0;

	return (
		<main className="min-h-screen bg-background p-4 md:p-6">
			<div className="mx-auto w-full max-w-7xl space-y-6">
				<header className="rounded-xl border bg-card p-4 md:p-6">
					<h1 className="text-4xl font-semibold tracking-tight">{ticker}</h1>
					<p className="mt-1 text-lg text-muted-foreground">{companyName}</p>
					<div className="mt-3 flex items-baseline gap-3">
						<span className="text-2xl font-semibold tabular-nums">${currentPrice.toFixed(2)}</span>
						<span className={`text-sm font-medium ${changePct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
							{changePct >= 0 ? "+" : ""}
							{changePct.toFixed(2)}%
						</span>
					</div>
				</header>

				{status === "loading" || status === "idle" ? <LoadingState /> : null}

				{status === "error" ? (
					<Card>
						<CardHeader>
							<CardTitle>Analysis failed</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<p className="text-sm text-muted-foreground">{error ?? "Unknown error"}</p>
							<Button onClick={() => window.location.reload()}>Retry</Button>
						</CardContent>
					</Card>
				) : null}

				{status === "ready" && data ? (
					<Tabs defaultValue="overview" className="space-y-4">
						<TabsList className="w-full justify-start overflow-x-auto" variant="line">
							<TabsTrigger value="overview">Overview</TabsTrigger>
							<TabsTrigger value="fundamentals">Fundamentals</TabsTrigger>
							<TabsTrigger value="technical">Technical</TabsTrigger>
							<TabsTrigger value="news">News</TabsTrigger>
							<TabsTrigger value="chat">Chat</TabsTrigger>
						</TabsList>

						<TabsContent value="overview">
							<div className="grid gap-4 xl:grid-cols-3">
								<VerdictCard horizon="Long Term" verdict={data.verdict.long_term} />
								<VerdictCard horizon="Swing Trade" verdict={data.verdict.swing_trade} />
								<VerdictCard horizon="Day Trade" verdict={data.verdict.day_trade} />
							</div>
						</TabsContent>

						<TabsContent value="fundamentals">
							<FundamentalPanel data={data.fundamental} />
						</TabsContent>

						<TabsContent value="technical">
							<TechnicalPanel data={data.technical} ohlcv={data.ohlcv ?? []} />
						</TabsContent>

						<TabsContent value="news">
							<NewsPanel data={data.news} />
						</TabsContent>

						<TabsContent value="chat">
							<ChatPanel ticker={ticker} analysisReady={status === "ready"} />
						</TabsContent>
					</Tabs>
				) : null}
			</div>
		</main>
	);
}