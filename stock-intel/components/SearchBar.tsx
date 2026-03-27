"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

type SearchBarProps = {
	onSearch?: (ticker: string) => void;
};

export function SearchBar({ onSearch }: SearchBarProps) {
	const router = useRouter();
	const [ticker, setTicker] = useState("");
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const normalized = ticker.trim().toUpperCase();
		if (!normalized) {
			setError("Ticker is required.");
			return;
		}

		if (normalized.length > 10) {
			setError("Ticker must be 10 characters or fewer.");
			return;
		}

		setError(null);
		onSearch?.(normalized);
		router.push(`/stock/${normalized}`);
	};

	return (
		<form onSubmit={handleSubmit} className="w-full space-y-2">
			<div className="flex w-full flex-col gap-2 sm:flex-row">
				<input
					type="text"
					value={ticker}
					onChange={(event) => setTicker(event.target.value)}
					placeholder="Enter ticker (e.g. AAPL)"
					className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
					aria-label="Ticker"
				/>
				<Button type="submit" className="h-10 px-4">
					Analyse
				</Button>
			</div>
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
		</form>
	);
}