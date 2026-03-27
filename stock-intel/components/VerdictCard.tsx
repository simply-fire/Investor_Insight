import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { VerdictHorizon } from "@/lib/types";

type VerdictCardProps = {
	horizon: "Long Term" | "Swing Trade" | "Day Trade";
	verdict: VerdictHorizon;
};

function verdictClass(value: VerdictHorizon["verdict"]) {
	if (value === "BUY") return "bg-emerald-600 text-white";
	if (value === "HOLD") return "bg-amber-500 text-black";
	return "bg-red-600 text-white";
}

function riskClass(value: VerdictHorizon["risk_level"]) {
	if (value === "LOW") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200";
	if (value === "MEDIUM") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
	return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
}

export function VerdictCard({ horizon, verdict }: VerdictCardProps) {
	return (
		<Card className="h-full">
			<CardHeader className="space-y-3">
				<div className="flex items-center justify-between gap-2">
					<CardTitle>{horizon}</CardTitle>
					<Badge className={verdictClass(verdict.verdict)}>{verdict.verdict}</Badge>
				</div>
				<div className="space-y-2">
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>Confidence</span>
						<span>{verdict.confidence_pct}%</span>
					</div>
					<Progress value={verdict.confidence_pct} />
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center justify-between">
					<span className="text-sm text-muted-foreground">Risk level</span>
					<Badge className={riskClass(verdict.risk_level)}>{verdict.risk_level}</Badge>
				</div>

				<div className="flex items-center justify-between gap-4 text-sm">
					<div>
						<p className="text-muted-foreground">Target</p>
						<p className="font-semibold">${verdict.target_price.toFixed(2)}</p>
					</div>
					<div className="text-right">
						<p className="text-muted-foreground">Stop loss</p>
						<p className="font-semibold">${verdict.stop_loss.toFixed(2)}</p>
					</div>
				</div>

				<div className="rounded-lg border border-border p-3 text-center">
					<p className="text-3xl font-semibold tabular-nums">{verdict.probability_of_success}%</p>
					<p className="text-xs uppercase tracking-wide text-muted-foreground">Probability of success</p>
				</div>

				<Accordion defaultValue={[]} type="multiple" className="rounded-lg border px-3">
					<AccordionItem value="pros-cons" className="border-0">
						<AccordionTrigger>Pros and Cons</AccordionTrigger>
						<AccordionContent>
							<div className="space-y-3">
								<div>
									<p className="mb-1 text-sm font-medium">Pros</p>
									<ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
										{verdict.pros.map((item) => (
											<li key={item}>{item}</li>
										))}
									</ul>
								</div>
								<div>
									<p className="mb-1 text-sm font-medium">Cons</p>
									<ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
										{verdict.cons.map((item) => (
											<li key={item}>{item}</li>
										))}
									</ul>
								</div>
							</div>
						</AccordionContent>
					</AccordionItem>
				</Accordion>

				<div>
					<p className="mb-1 text-sm font-medium">Supporting data</p>
					<ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
						{verdict.supporting_data.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</div>

				<div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
					<p className="font-medium">Key risk</p>
					<p className="mt-1">{verdict.key_risk}</p>
				</div>
			</CardContent>
		</Card>
	);
}