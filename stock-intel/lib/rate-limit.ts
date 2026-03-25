import { SupabaseClient } from "@supabase/supabase-js";

export const API_LIMITS = {
	alpha_vantage: { calls: 25, window_hours: 24 },
	newsapi: { calls: 100, window_hours: 24 },
	gnews: { calls: 100, window_hours: 24 },
	gemini_flash: { calls: 1500, window_hours: 24 },
	groq: { calls: 14400, window_hours: 24 },
	fred: { calls: 99999, window_hours: 24 }, // effectively unlimited
};

export async function checkRateLimit(
	apiName: keyof typeof API_LIMITS,
	supabase: SupabaseClient,
): Promise<boolean> {
	// Returns true = OK to proceed, false = at limit
	const limit = API_LIMITS[apiName];
	const windowStart = new Date(Date.now() - limit.window_hours * 60 * 60 * 1000).toISOString();
	const { count } = await supabase
		.from("api_usage_log")
		.select("*", { count: "exact", head: true })
		.eq("api_name", apiName)
		.gte("called_at", windowStart);

	return (count ?? 0) < limit.calls;
}

export async function logApiCall(
	apiName: string,
	supabase: SupabaseClient,
): Promise<void> {
	await supabase.from("api_usage_log").insert({ api_name: apiName });
}
