"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Message = {
	role: "user" | "assistant";
	content: string;
	timestamp: string;
};

type ChatPanelProps = {
	ticker: string;
	analysisReady: boolean;
};

function nowLabel() {
	return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({ ticker, analysisReady }: ChatPanelProps) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [draft, setDraft] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		setMessages([
			{
				role: "assistant",
				content: `I've analysed ${ticker}. Ask me anything about the fundamentals, technicals, or news.`,
				timestamp: nowLabel(),
			},
		]);
	}, [ticker]);

	useEffect(() => {
		if (!listRef.current) return;
		listRef.current.scrollTop = listRef.current.scrollHeight;
	}, [messages, isStreaming]);

	const canSend = useMemo(
		() => analysisReady && !isStreaming && draft.trim().length > 0,
		[analysisReady, draft, isStreaming],
	);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const content = draft.trim();
		if (!content || !analysisReady || isStreaming) return;

		const nextMessages: Message[] = [
			...messages,
			{ role: "user", content, timestamp: nowLabel() },
			{ role: "assistant", content: "", timestamp: nowLabel() },
		];

		setDraft("");
		if (textareaRef.current) {
			textareaRef.current.style.height = "40px";
		}
		setMessages(nextMessages);
		setIsStreaming(true);

		try {
			const response = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					ticker,
					message: content,
					session_id: sessionId,
					messages: messages.map((item) => ({
						role: item.role,
						content: item.content,
					})),
				}),
			});

			const headerSessionId = response.headers.get("x-session-id");
			if (headerSessionId && !sessionId) {
				setSessionId(headerSessionId);
			}

			if (!response.ok || !response.body) {
				throw new Error(`Chat request failed (${response.status})`);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const events = buffer.split(/\r?\n\r?\n/);
				buffer = events.pop() ?? "";

				for (const eventBlock of events) {
					const lines = eventBlock.split("\n");
					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed.startsWith("data:")) continue;

						const chunk = trimmed.slice(5).trim();
						if (!chunk || chunk === "[DONE]") continue;

						setMessages((current) => {
							const updated = [...current];
							const last = updated.at(-1);
							if (!last || last.role !== "assistant") {
								updated.push({ role: "assistant", content: chunk, timestamp: nowLabel() });
								return updated;
							}

							last.content += chunk;
							return updated;
						});
					}
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "Streaming failed";
			setMessages((current) => [
				...current,
				{
					role: "assistant",
					content: `Unable to complete chat request: ${message}`,
					timestamp: nowLabel(),
				},
			]);
		} finally {
			setIsStreaming(false);
		}
	};

	if (!analysisReady) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Chat</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						Analysis must complete before chat is available
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Analyst Chat</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div ref={listRef} className="h-90 space-y-3 overflow-y-auto rounded-lg border p-3">
					{messages.map((message, index) => (
						<div key={`${message.timestamp}-${index}`} className="space-y-1">
							<p className="text-xs text-muted-foreground">
								{message.role === "user" ? "You" : "Analyst"} · {message.timestamp}
							</p>
							<p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{message.content || "..."}</p>
						</div>
					))}
					{isStreaming ? (
						<div className="inline-flex items-center gap-1 rounded-md bg-muted px-3 py-2 text-sm">
							<span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
							<span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
							<span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
						</div>
					) : null}
				</div>

				<form onSubmit={handleSubmit} className="space-y-2">
					<textarea
						ref={textareaRef}
						value={draft}
						onChange={(event) => {
							setDraft(event.target.value);
							const element = event.currentTarget;
							element.style.height = "40px";
							element.style.height = `${Math.min(element.scrollHeight, 96)}px`;
						}}
						rows={1}
						maxLength={600}
						className="max-h-24 min-h-10 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
						placeholder="Ask about risks, trend quality, or catalysts..."
					/>
					<div className="flex justify-end">
						<Button type="submit" disabled={!canSend}>
							Send
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}