import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";

type ChatMessage = {
	role: string;
	content: string;
};

type ChatRequest = {
	ticker?: string;
	message?: string;
	messages?: ChatMessage[];
	session_id?: string;
};

const DISCLAIMER = "Always end responses with: 'This is analysis data only, not financial advice.'";

function toJsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...corsHeaders,
			"Content-Type": "application/json",
		},
	});
}

function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
	return messages
		.filter((m) => m && typeof m.role === "string" && typeof m.content === "string")
		.map((m) => {
			const role = m.role.trim().toLowerCase();
			if (role === "assistant" || role === "system") {
				return { role, content: m.content.trim() };
			}
			return { role: "user", content: m.content.trim() };
		})
		.filter((m) => m.content.length > 0);
}

function buildGroundedPrompt(ticker: string, analysisContext: unknown): string {
	const normalizedTicker = ticker.toUpperCase().trim();

	return `You are a financial analyst assistant specialising in ${normalizedTicker}.
You have just completed a full analysis of this stock. Answer the user's questions
using ONLY the data from this analysis. If asked something not covered in the analysis,
say so clearly. Be concise, specific, and always cite the relevant data point.

ANALYSIS CONTEXT:
${JSON.stringify(analysisContext)}

IMPORTANT: Never give general financial advice. Always refer to the specific data above.
Do not recommend buying or selling - describe what the data shows.

DISCLAIMER:
${DISCLAIMER}`;
}

async function persistSession(
	supabase: ReturnType<typeof createClient>,
	ticker: string,
	sessionId: string,
	historyMessages: ChatMessage[],
	userMessage: string,
	assistantReply: string,
): Promise<void> {
	const pairToAppend: ChatMessage[] = [
		{ role: "user", content: userMessage },
		{ role: "assistant", content: assistantReply },
	];

	const { data: existingRow, error: selectError } = await supabase
		.from("chat_sessions")
		.select("messages")
		.eq("id", sessionId)
		.eq("ticker", ticker)
		.maybeSingle();

	if (selectError) {
		throw new Error(`Failed loading chat session: ${selectError.message}`);
	}

	const baseMessages = Array.isArray(existingRow?.messages) ? (existingRow.messages as ChatMessage[]) : historyMessages;
	const nextMessages = [...baseMessages, ...pairToAppend];

	const { error: upsertError } = await supabase.from("chat_sessions").upsert(
		{
			id: sessionId,
			ticker,
			messages: nextMessages,
			updated_at: new Date().toISOString(),
		},
		{ onConflict: "id" },
	);

	if (upsertError) {
		throw new Error(`Failed writing chat session: ${upsertError.message}`);
	}
}

serve(async (req: Request): Promise<Response> => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}

	if (req.method !== "POST") {
		return toJsonResponse({ error: "Method not allowed" }, 405);
	}

	try {
		const body = (await req.json()) as ChatRequest;
		const ticker = (body.ticker ?? "").toUpperCase().trim();
		const message = (body.message ?? "").trim();
		const incomingMessages = normalizeMessages(body.messages ?? []);

		if (!ticker) {
			return toJsonResponse({ error: "ticker is required" }, 400);
		}

		if (!message) {
			return toJsonResponse({ error: "message is required" }, 400);
		}

		const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
		const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
		const mistralApiKey = Deno.env.get("MISTRAL_API_KEY") ?? "";

		if (!supabaseUrl || !serviceRoleKey) {
			throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
		}

		if (!mistralApiKey) {
			throw new Error("Missing MISTRAL_API_KEY");
		}

		const supabase = createClient(supabaseUrl, serviceRoleKey);

		const { data: analysisRow, error: analysisError } = await supabase
			.from("analysis_cache")
			.select("data")
			.eq("ticker", ticker)
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle();

		if (analysisError) {
			throw new Error(`Failed to load analysis context: ${analysisError.message}`);
		}

		if (!analysisRow?.data) {
			return toJsonResponse({ reply: `I don't have an analysis for ${ticker} yet. Please run an analysis first.` }, 200);
		}

		const systemPrompt = buildGroundedPrompt(ticker, analysisRow.data);
		const mergedMessages = [...incomingMessages];
		const lastMessage = mergedMessages[mergedMessages.length - 1];
		if (!lastMessage || lastMessage.role !== "user" || lastMessage.content !== message) {
			mergedMessages.push({ role: "user", content: message });
		}
		const recentMessages = mergedMessages.slice(-10);

		const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${mistralApiKey}`,
			},
			body: JSON.stringify({
				model: "mistral-small-latest",
				stream: true,
				messages: [
					{ role: "system", content: systemPrompt },
					...recentMessages,
				],
			}),
		});

		if (!mistralResponse.ok || !mistralResponse.body) {
			const detail = await mistralResponse.text();
			throw new Error(`Mistral request failed (${mistralResponse.status}): ${detail.slice(0, 240)}`);
		}

		const providedSessionId = (body.session_id ?? "").trim();
		const isNewSession = providedSessionId.length === 0;
		const sessionId = providedSessionId || crypto.randomUUID();
		let assistantReply = "";

		const decoder = new TextDecoder();
		const encoder = new TextEncoder();
		const reader = mistralResponse.body.getReader();

		let buffer = "";
		const flushSseEvent = async (eventBlock: string, writer: WritableStreamDefaultWriter<Uint8Array>): Promise<boolean> => {
			let sawDone = false;
			const lines = eventBlock.split("\n");
			for (const rawLine of lines) {
				const line = rawLine.trim();
				if (!line.startsWith("data:")) {
					continue;
				}

				const payload = line.slice(5).trim();
				if (!payload) {
					continue;
				}

				if (payload === "[DONE]") {
					sawDone = true;
					continue;
				}

				try {
					const parsed = JSON.parse(payload);
					const chunk = parsed?.choices?.[0]?.delta?.content;
					if (typeof chunk === "string" && chunk.length > 0) {
						assistantReply += chunk;
						await writer.write(encoder.encode(`data: ${chunk}\n\n`));
					}
				} catch {
					// Ignore malformed upstream frame.
				}
			}

			return sawDone;
		};

		const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
		const writer = writable.getWriter();

		void (async () => {
			let shouldStop = false;
			try {
				while (!shouldStop) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}

					buffer += decoder.decode(value ?? new Uint8Array(), { stream: true });
					const events = buffer.split(/\r?\n\r?\n/);
					buffer = events.pop() ?? "";

					for (const event of events) {
						const sawDone = await flushSseEvent(event, writer);
						if (sawDone) {
							shouldStop = true;
							break;
						}
					}
				}

				if (buffer.trim().length > 0) {
					await flushSseEvent(buffer, writer);
				}
			} catch (streamError) {
				console.error("[chat] Stream bridge error:", streamError);
			} finally {
				try {
					await reader.cancel();
				} catch {
					// Ignore cancel errors.
				}

				try {
					await writer.write(encoder.encode("data: [DONE]\n\n"));
				} catch {
					// Ignore write errors when client disconnects.
				}

				try {
					await writer.close();
				} catch {
					// Ignore close errors.
				}

				try {
					await persistSession(supabase, ticker, sessionId, incomingMessages, message, assistantReply);
				} catch (persistError) {
					console.error("[chat] Failed to persist chat session:", persistError);
				}
			}
		})();

		const responseHeaders: Record<string, string> = {
			...corsHeaders,
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		};

		if (isNewSession) {
			responseHeaders["X-Session-Id"] = sessionId;
		}

		return new Response(readable, {
			headers: {
				...responseHeaders,
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return toJsonResponse({ error: message }, 500);
	}
});