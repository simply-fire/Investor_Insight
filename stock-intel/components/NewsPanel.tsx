import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { NewsAgentOutput } from "@/lib/types";

type NewsPanelProps = {
	data: NewsAgentOutput;
};

function sentimentClass(sentiment: number) {
	if (sentiment > 0.2) return "bg-emerald-600 text-white";
	if (sentiment < -0.2) return "bg-red-600 text-white";
	return "bg-slate-500 text-white";
}

export function NewsPanel({ data }: NewsPanelProps) {
	const normalized = Math.max(-1, Math.min(1, data.aggregate_sentiment));
	const pointerPct = ((normalized + 1) / 2) * 100;

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Sentiment Gauge</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					  <div className="relative h-3 w-full rounded-full bg-linear-to-r from-red-500 via-slate-300 to-emerald-500">
						<div
							className="absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-foreground"
							style={{ left: `${pointerPct}%` }}
							aria-label="Sentiment pointer"
						/>
					</div>
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>-1.0</span>
						<span className="font-medium">{normalized.toFixed(2)}</span>
						<span>+1.0</span>
					</div>
				</CardContent>
			</Card>

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{data.top_stories.map((story, index) => (
					<Card key={`${story.title}-${index}`}>
						<CardHeader>
							<CardTitle className="text-sm leading-snug">{story.title}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2">
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs text-muted-foreground">{story.source ?? "Unknown source"}</span>
								<Badge className={sentimentClass(story.sentiment)}>{story.sentiment.toFixed(2)}</Badge>
							</div>
							<p className="text-sm text-muted-foreground">{story.one_line_impact}</p>
							<a
								href={story.url ?? "#"}
								target="_blank"
								rel="noreferrer"
								className="text-xs font-medium text-primary underline-offset-4 hover:underline"
							>
								Read article
							</a>
						</CardContent>
					</Card>
				))}
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Macro Tailwinds</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
							{data.macro_tailwinds.map((tailwind, index) => (
								<li key={`${tailwind}-${index}`}>{tailwind}</li>
							))}
						</ul>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Macro Headwinds</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
							{data.macro_headwinds.map((headwind, index) => (
								<li key={`${headwind}-${index}`}>{headwind}</li>
							))}
						</ul>
					</CardContent>
				</Card>
			</div>

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