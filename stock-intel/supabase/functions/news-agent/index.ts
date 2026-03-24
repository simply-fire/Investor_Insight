import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { corsHeaders } from "../_shared/cors.ts";

type NewsRequest = {
	ticker?: string;
	company_name?: string;
};

type Article = {
	title: string;
	source: string;
	url: string;
	published_at: string;
	summary: string;
};

type LlmNewsAssessment = {
	sentiment: number;
	impact: "SHORT" | "MEDIUM" | "LONG";
	affected_metric: "revenue" | "margins" | "regulation" | "competition" | "macro" | "other";
	one_line_impact: string;
};

type NewsAgentOutput = {
	ticker: string;
	aggregate_sentiment: number;
	sentiment_label: "NEGATIVE" | "MILDLY_NEGATIVE" | "NEUTRAL" | "MILDLY_POSITIVE" | "POSITIVE";
	top_stories: Array<{
		title: string;
		sentiment: number;
		impact: "SHORT" | "MEDIUM" | "LONG";
		one_line_impact: string;
	}>;
	macro_headwinds: string[];
	macro_tailwinds: string[];
	summary: string;
};

function toArticle(raw: Record<string, unknown>): Article {
	const source = raw.source as { name?: string } | undefined;
	return {
		title: String(raw.title ?? "Untitled"),
		source: String(source?.name ?? "Unknown"),
		url: String(raw.url ?? ""),
		published_at: String(raw.publishedAt ?? ""),
		summary: String(raw.description ?? raw.content ?? ""),
	};
}

function clampSentiment(value: number): number {
	return Math.max(-1, Math.min(1, Math.round(value * 100) / 100));
}

function sentimentLabel(value: number): NewsAgentOutput["sentiment_label"] {
	if (value <= -0.45) return "NEGATIVE";
	if (value < -0.15) return "MILDLY_NEGATIVE";
	if (value < 0.15) return "NEUTRAL";
	if (value < 0.45) return "MILDLY_POSITIVE";
	return "POSITIVE";
}

function fallbackAssessment(article: Article): LlmNewsAssessment {
	const text = `${article.title} ${article.summary}`.toLowerCase();
	const negativeWords = ["miss", "lawsuit", "decline", "cut", "regulatory", "probe", "down"];
	const positiveWords = ["beat", "growth", "upgrade", "expansion", "record", "up", "surge"];

	const neg = negativeWords.filter((w) => text.includes(w)).length;
	const pos = positiveWords.filter((w) => text.includes(w)).length;
	const score = clampSentiment((pos - neg) * 0.2);

	return {
		sentiment: score,
		impact: Math.abs(score) > 0.45 ? "MEDIUM" : "SHORT",
		affected_metric: "other",
		one_line_impact: score >= 0 ? "News flow suggests mild support for sentiment." : "News flow suggests mild pressure on sentiment.",
	};
}

async function callGeminiForArticle(ticker: string, article: Article): Promise<LlmNewsAssessment> {
	try {
		const geminiKey = Deno.env.get("GEMINI_API_KEY");
		if (!geminiKey) {
			return fallbackAssessment(article);
		}

		const prompt = `Analyze this financial news article for ${ticker}.
Return JSON only:
{
	"sentiment": <-1.0 to 1.0>,
	"impact": "SHORT | MEDIUM | LONG",
	"affected_metric": "revenue | margins | regulation | competition | macro | other",
	"one_line_impact": "<15 word description of how this affects the stock>"
}
Article: ${article.title}. ${article.summary}`;

		const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
				generationConfig: { responseMimeType: "application/json" },
			}),
		});

		if (!response.ok) {
			return fallbackAssessment(article);
		}

		const raw = await response.json();
		const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
		if (typeof text !== "string") {
			return fallbackAssessment(article);
		}

		const parsed = JSON.parse(text) as LlmNewsAssessment;
		return {
			sentiment: clampSentiment(Number(parsed.sentiment ?? 0)),
			impact: parsed.impact ?? "SHORT",
			affected_metric: parsed.affected_metric ?? "other",
			one_line_impact: String(parsed.one_line_impact ?? "No direct impact identified."),
		};
	} catch (error) {
		console.error("[news-agent] Article Gemini error:", error);
		return fallbackAssessment(article);
	}
}

serve(async (req: Request): Promise<Response> => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}

	if (req.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method not allowed" }), {
			status: 405,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}

	try {
		let body: NewsRequest;
		try {
			const text = await req.text();
			if (!text || text.length === 0 || text === "{}") {
				return new Response(JSON.stringify({ error: "Empty request body. Expected { ticker, company_name? }" }), {
					status: 400,
					headers: { ...corsHeaders, "Content-Type": "application/json" },
				});
			}
			body = JSON.parse(text) as NewsRequest;
		} catch (parseError) {
			return new Response(
				JSON.stringify({ error: `Invalid JSON: ${String(parseError).substring(0, 100)}` }),
				{ status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
			);
		}
		const ticker = (body.ticker ?? "").toUpperCase().trim();
		const companyName = (body.company_name ?? ticker).trim();

		if (!ticker) {
			return new Response(JSON.stringify({ error: "ticker is required" }), {
				status: 400,
				headers: { ...corsHeaders, "Content-Type": "application/json" },
			});
		}

		const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
		const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
		if (supabaseUrl && supabaseKey) {
			createClient(supabaseUrl, supabaseKey);
		}

		const newsApiKey = Deno.env.get("NEWS_API_KEY");
		const gnewsKey = Deno.env.get("GNEWS_API_KEY");

		const companyNewsPromise = (async (): Promise<Article[]> => {
			if (newsApiKey) {
				const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(`${ticker} OR ${companyName}`)}&sortBy=publishedAt&pageSize=10&apiKey=${encodeURIComponent(newsApiKey)}`;
				const response = await fetch(url);
				if (response.ok) {
					const data = await response.json();
					return ((data?.articles ?? []) as Record<string, unknown>[]).map(toArticle);
				}
			}

			if (!gnewsKey) return [];
			const fallbackUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent(`${ticker} ${companyName} stock`)}&token=${encodeURIComponent(gnewsKey)}&max=10`;
			const fallbackResponse = await fetch(fallbackUrl);
			if (!fallbackResponse.ok) return [];
			const fallbackData = await fallbackResponse.json();
			return ((fallbackData?.articles ?? []) as Record<string, unknown>[]).map(toArticle);
		})();

		const globalNewsPromise = (async (): Promise<Article[]> => {
			if (!gnewsKey) return [];
			const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent("stock market economy fed")}&token=${encodeURIComponent(gnewsKey)}&max=5`;
			const response = await fetch(url);
			if (!response.ok) return [];
			const data = await response.json();
			return ((data?.articles ?? []) as Record<string, unknown>[]).map(toArticle);
		})();

		const [companyNews, globalNews] = await Promise.all([companyNewsPromise, globalNewsPromise]);

		const selectedCompany = companyNews.slice(0, 5);
		const selectedGlobal = globalNews.slice(0, 3);
		const selectedAll = [...selectedCompany, ...selectedGlobal];

		const assessments = await Promise.all(selectedAll.map((article) => callGeminiForArticle(ticker, article)));

		const withAssessments = selectedAll.map((article, idx) => ({ article, assessment: assessments[idx] }));
		const agg = withAssessments.length
			? clampSentiment(withAssessments.reduce((sum, item) => sum + item.assessment.sentiment, 0) / withAssessments.length)
			: 0;

		const topStories = withAssessments
			.slice()
			.sort((a, b) => Math.abs(b.assessment.sentiment) - Math.abs(a.assessment.sentiment))
			.slice(0, 3)
			.map((item) => ({
				title: item.article.title,
				sentiment: item.assessment.sentiment,
				impact: item.assessment.impact,
				one_line_impact: item.assessment.one_line_impact,
			}));

		const macroHeadwinds = withAssessments
			.filter((item) => item.assessment.sentiment < -0.15)
			.slice(0, 3)
			.map((item) => item.assessment.one_line_impact);

		const macroTailwinds = withAssessments
			.filter((item) => item.assessment.sentiment > 0.15)
			.slice(0, 3)
			.map((item) => item.assessment.one_line_impact);

		const result: NewsAgentOutput = {
			ticker,
			aggregate_sentiment: agg,
			sentiment_label: sentimentLabel(agg),
			top_stories: topStories,
			macro_headwinds: macroHeadwinds,
			macro_tailwinds: macroTailwinds,
			summary:
				topStories.length > 0
					? `News flow is ${sentimentLabel(agg).toLowerCase().replaceAll("_", " ")}. Most impactful story: ${topStories[0].title}`
					: "Limited news coverage available for this run.",
		};

		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error("[news-agent] Error:", error);
		return new Response(
			JSON.stringify({ error: "Analysis failed", detail: error instanceof Error ? error.message : String(error) }),
			{ status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
		);
	}
});