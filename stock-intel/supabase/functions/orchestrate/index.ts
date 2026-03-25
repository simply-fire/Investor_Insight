import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Content-Type": "application/json",
};

type OrchestrateRequest = {
	ticker?: string;
};

function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...corsHeaders,
			...extraHeaders,
		},
	});
}

serve(async (req: Request): Promise<Response> => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}

	try {
		if (req.method !== "POST") {
			return jsonResponse({ error: "Method not allowed" }, 405);
		}

		const body = (await req.json()) as OrchestrateRequest;
		const ticker = (body.ticker ?? "").trim().toUpperCase();

		if (!ticker || ticker.length > 15) {
			return jsonResponse({ error: "ticker is required and must be <= 15 characters" }, 400);
		}

		const supabaseUrl = Deno.env.get("SUPABASE_URL");
		const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
		const inngestEventKey = Deno.env.get("INNGEST_EVENT_KEY");

		if (!supabaseUrl || !serviceRoleKey) {
			throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
		}

		if (!inngestEventKey) {
			throw new Error("Missing INNGEST_EVENT_KEY");
		}

		const supabase = createClient(supabaseUrl, serviceRoleKey);

		const { data: cachedRow, error: cacheError } = await supabase
			.from("analysis_cache")
			.select("data")
			.eq("ticker", ticker)
			.gt("expires_at", new Date().toISOString())
			.limit(1)
			.maybeSingle();

		if (cacheError) {
			throw new Error(`Cache lookup failed: ${cacheError.message}`);
		}

		if (cachedRow?.data) {
			return jsonResponse(cachedRow.data, 200, { "X-Cache": "HIT" });
		}

		const inngestResponse = await fetch(`https://inn.gs/e/${inngestEventKey}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: "stock/analyze",
				data: { ticker },
			}),
		});

		if (!inngestResponse.ok) {
			const bodyText = await inngestResponse.text();
			throw new Error(`Inngest event publish failed (${inngestResponse.status}): ${bodyText}`);
		}

		return jsonResponse({ status: "analyzing", ticker }, 202, { "X-Cache": "MISS" });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return jsonResponse({ error: message }, 500);
	}
});