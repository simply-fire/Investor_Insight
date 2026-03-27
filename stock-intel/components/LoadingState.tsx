"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

const STEPS = [
	"Fetching fundamentals...",
	"Analysing technicals...",
	"Reading news...",
	"Generating verdict...",
];

export function LoadingState() {
	const [stepIndex, setStepIndex] = useState(0);

	useEffect(() => {
		const intervalId = window.setInterval(() => {
			setStepIndex((current) => (current + 1) % STEPS.length);
		}, 2000);

		return () => window.clearInterval(intervalId);
	}, []);

	const progress = useMemo(() => ((stepIndex + 1) / STEPS.length) * 100, [stepIndex]);

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Running Analysis</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					<Progress value={progress}>
						<ProgressLabel>{STEPS[stepIndex]}</ProgressLabel>
						<ProgressValue>{Math.round(progress)}%</ProgressValue>
					</Progress>
				</CardContent>
			</Card>

			<div className="grid gap-4 lg:grid-cols-3">
				<Card>
					<CardHeader>
						<Skeleton className="h-6 w-32" />
					</CardHeader>
					<CardContent className="space-y-3">
						<Skeleton className="h-16 w-full" />
						<Skeleton className="h-4 w-4/5" />
						<Skeleton className="h-4 w-3/5" />
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<Skeleton className="h-6 w-36" />
					</CardHeader>
					<CardContent className="space-y-3">
						<Skeleton className="h-44 w-full" />
						<Skeleton className="h-4 w-4/5" />
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<Skeleton className="h-6 w-28" />
					</CardHeader>
					<CardContent className="space-y-3">
						<Skeleton className="h-20 w-full" />
						<Skeleton className="h-4 w-4/5" />
						<Skeleton className="h-4 w-2/3" />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}