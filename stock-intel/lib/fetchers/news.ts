import { createClient } from "@supabase/supabase-js";

import type { Article, NewsData } from "@/lib/types";

const NEWSAPI_LIMIT_PER_DAY = 100;
const GROQ_MODEL = "llama-3.1-8b-instant";

interface KeywordPlan {
	include: string[];
	exclude: string[];
}

function emptyNewsData(ticker: string): NewsData {
	return {
		ticker: ticker.toUpperCase(),
		company_news: [],
		global_news: [],
	};
}

function getSupabaseAdminClient() {
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !serviceRoleKey) {
		return null;
	}

	return createClient(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

function dayBoundsIso() {
	const now = new Date();
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const end = new Date(start);
	end.setUTCDate(end.getUTCDate() + 1);
	return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function isAtDailyLimit(apiName: string, limit: number): Promise<boolean> {
	try {
		const supabase = getSupabaseAdminClient();
		if (!supabase) {
			return false;
		}

		const { startIso, endIso } = dayBoundsIso();
		const { count, error } = await supabase
			.from("api_usage_log")
			.select("id", { count: "exact", head: true })
			.eq("api_name", apiName)
			.gte("called_at", startIso)
			.lt("called_at", endIso);

		if (error) {
			console.warn("[fetchNews] Failed api_usage_log check:", error.message);
			return false;
		}

		return (count ?? 0) >= limit;
	} catch (error) {
		console.warn("[fetchNews] Usage limit check error:", error);
		return false;
	}
}

async function logApiUsage(apiName: string, status: string, ticker: string) {
	try {
		const supabase = getSupabaseAdminClient();
		if (!supabase) {
			return;
		}

		const payload = {
			api_name: `${apiName}:${status}:${ticker}`,
		};

		const { error } = await supabase.from("api_usage_log").insert(payload);
		if (error) {
			console.warn("[fetchNews] Failed to log api usage:", error.message);
		}
	} catch (error) {
		console.warn("[fetchNews] Usage log insert error:", error);
	}
}

function mapNewsApiArticle(article: Record<string, unknown>): Article {
	const sourceObj = article.source as { name?: string } | undefined;
	return {
		title: String(article.title ?? "Untitled"),
		source: String(sourceObj?.name ?? "Unknown"),
		url: String(article.url ?? ""),
		published_at: String(article.publishedAt ?? ""),
		summary: String(article.description ?? article.content ?? ""),
	};
}

function mapGnewsArticle(article: Record<string, unknown>): Article {
	const sourceObj = article.source as { name?: string } | undefined;
	return {
		title: String(article.title ?? "Untitled"),
		source: String(sourceObj?.name ?? "Unknown"),
		url: String(article.url ?? ""),
		published_at: String(article.publishedAt ?? ""),
		summary: String(article.description ?? article.content ?? ""),
	};
}

function sanitizeQueryPart(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeText(value: string): string {
	return sanitizeQueryPart(value).toLowerCase();
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)));
}

function baseKeywordPlan(ticker: string, companyName: string): KeywordPlan {
	const cleanTicker = ticker.toUpperCase();
	const cleanCompany = sanitizeQueryPart(companyName);
	const tokens = cleanCompany
		.split(" ")
		.filter((word) => word.length > 2)
		.slice(0, 4);

	return {
		include: unique([
			cleanTicker,
			cleanCompany,
			`${cleanTicker} stock`,
			`${cleanCompany} stock`,
			"earnings",
			"guidance",
			"revenue",
			"analyst",
			...tokens,
		]),
		exclude: unique(["matchmaking", "dating", "wedding", "obituary", "lottery", "classifieds"]),
	};
}

function extractJsonObject(raw: string): string {
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) {
		return "";
	}
	return raw.slice(start, end + 1);
}

async function enhanceKeywordsWithGroq(ticker: string, companyName: string): Promise<KeywordPlan> {
	const base = baseKeywordPlan(ticker, companyName);
	const groqKey = process.env.GROQ_API_KEY?.trim();
	if (!groqKey) {
		return base;
	}

	try {
		const prompt = `Generate stock-news retrieval keywords for:\nTicker: ${ticker}\nCompany: ${companyName}\nReturn strict JSON with keys include/exclude only.`;
		const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${groqKey}`,
			},
			body: JSON.stringify({
				model: GROQ_MODEL,
				temperature: 0,
				messages: [
					{ role: "system", content: "Return valid JSON only with shape: { include: string[], exclude: string[] }." },
					{ role: "user", content: prompt },
				],
			}),
		});

		if (!response.ok) {
			return base;
		}

		const payload = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const content = payload.choices?.[0]?.message?.content ?? "";
		const jsonText = extractJsonObject(content);
		if (!jsonText) {
			return base;
		}

		const parsed = JSON.parse(jsonText) as Partial<KeywordPlan>;
		return {
			include: unique([...(parsed.include ?? []), ...base.include]).slice(0, 12),
			exclude: unique([...(parsed.exclude ?? []), ...base.exclude]).slice(0, 12),
		};
	} catch {
		return base;
	}
}

function articleText(article: Article): string {
	return normalizeText(`${article.title} ${article.summary} ${article.source} ${article.url}`);
}

function dedupeArticles(articles: Article[]): Article[] {
	const seen = new Set<string>();
	const out: Article[] = [];
	for (const article of articles) {
		const key = `${article.url}|${normalizeText(article.title)}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(article);
	}
	return out;
}

function scoreCompanyArticle(article: Article, ticker: string, companyName: string, includeKeywords: string[]): number {
	const text = articleText(article);
	const tickerHit = text.includes(normalizeText(ticker)) ? 4 : 0;
	const companyHit = normalizeText(companyName)
		.split(" ")
		.filter((token) => token.length > 2)
		.reduce((acc, token) => acc + (text.includes(token) ? 1 : 0), 0);
	const includeHit = includeKeywords.slice(0, 8).reduce((acc, keyword) => acc + (text.includes(normalizeText(keyword)) ? 1 : 0), 0);
	const financeTerms = ["stock", "shares", "earnings", "revenue", "guidance", "analyst", "nasdaq", "market"];
	const financeHit = financeTerms.reduce((acc, term) => acc + (text.includes(term) ? 1 : 0), 0);
	return tickerHit + companyHit + includeHit + financeHit;
}

function filterRelevantCompanyNews(articles: Article[], ticker: string, companyName: string, plan: KeywordPlan): Article[] {
	const blocked = plan.exclude.map((v) => normalizeText(v));
	return dedupeArticles(articles)
		.filter((article) => {
			const text = articleText(article);
			return !blocked.some((term) => term.length > 0 && text.includes(term));
		})
		.map((article) => ({ article, score: scoreCompanyArticle(article, ticker, companyName, plan.include) }))
		.filter((entry) => entry.score >= 4)
		.sort((a, b) => b.score - a.score)
		.map((entry) => entry.article)
		.slice(0, 10);
}

function buildGnewsQueries(ticker: string, companyName: string): string[] {
	const cleanTicker = sanitizeQueryPart(ticker).toUpperCase();
	const cleanCompany = sanitizeQueryPart(companyName)
		.split(" ")
		.filter((word) => word.length > 1)
		.slice(0, 4)
		.join(" ");

	const queries = [
		`${cleanTicker} stock`,
		cleanCompany ? `${cleanCompany} stock` : "",
		cleanTicker,
	].filter((q) => q.length > 0);

	return Array.from(new Set(queries));
}

async function fetchGnews(query: string, max = 5): Promise<Article[]> {
	const apiKey = process.env.GNEWS_API_KEY?.trim();
	if (!apiKey) {
		console.warn("[fetchNews] GNews unavailable: missing GNEWS_API_KEY");
		return [];
	}

	const attempts = [query, sanitizeQueryPart(query)].filter((q) => q.length > 0);

	for (const candidate of Array.from(new Set(attempts))) {
		const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(candidate)}&lang=en&max=${max}&apikey=${encodeURIComponent(apiKey)}`;
		const response = await fetch(url, { cache: "no-store" });

		if (response.ok) {
			const payload = (await response.json()) as { articles?: Record<string, unknown>[] };
			return (payload.articles ?? []).map(mapGnewsArticle);
		}

		const errorBody = await response.text();
		console.error(
			"[fetchNews] GNews request failed:",
			response.status,
			response.statusText,
			`query='${candidate}'`,
			errorBody.slice(0, 300),
		);

		if (response.status !== 400) {
			break;
		}
	}

	return [];
}

export async function fetchNews(ticker: string, companyName: string): Promise<NewsData> {
	try {
		const normalizedTicker = ticker.toUpperCase();
		const keywordPlan = await enhanceKeywordsWithGroq(normalizedTicker, companyName);
		const newsApiAtLimit = await isAtDailyLimit("newsapi", NEWSAPI_LIMIT_PER_DAY);

		if (newsApiAtLimit) {
			console.warn("[fetchNews] NewsAPI daily limit reached. Using GNews for both feeds.");
			const companyQueries = buildGnewsQueries(normalizedTicker, companyName);
			const [companyNews, globalNews] = await Promise.all([
				fetchGnews(companyQueries[0] ?? `${normalizedTicker} stock`, 10),
				fetchGnews("stock market economy fed", 5),
			]);

			await logApiUsage("gnews", "success", normalizedTicker);
			return {
				ticker: normalizedTicker,
				company_news: filterRelevantCompanyNews(companyNews, normalizedTicker, companyName, keywordPlan),
				global_news: dedupeArticles(globalNews).slice(0, 5),
			};
		}

		const newsApiKey = process.env.NEWS_API_KEY?.trim();
		if (!newsApiKey) {
			console.warn("[fetchNews] Missing NEWS_API_KEY. Falling back to GNews.");
			const companyQueries = buildGnewsQueries(normalizedTicker, companyName);
			const [companyNews, globalNews] = await Promise.all([
				fetchGnews(companyQueries[0] ?? `${normalizedTicker} stock`, 10),
				fetchGnews("stock market economy fed", 5),
			]);

			await logApiUsage("gnews", "success", normalizedTicker);
			return {
				ticker: normalizedTicker,
				company_news: filterRelevantCompanyNews(companyNews, normalizedTicker, companyName, keywordPlan),
				global_news: dedupeArticles(globalNews).slice(0, 5),
			};
		}

		const includeQuery = keywordPlan.include.slice(0, 7).map((term) => `"${term}"`).join(" OR ");
		const excludeQuery = keywordPlan.exclude.slice(0, 6).map((term) => `-"${term}"`).join(" ");
		const companyQuery = `${includeQuery} ${excludeQuery}`.trim();
		const companyUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(companyQuery)}&language=en&searchIn=title,description&sortBy=publishedAt&pageSize=25&apiKey=${encodeURIComponent(newsApiKey)}`;
		const globalUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent("stock market economy fed")}&lang=en&max=5&apikey=${encodeURIComponent(process.env.GNEWS_API_KEY?.trim() ?? "")}`;

		const [companyResponse, globalResponse] = await Promise.all([
			fetch(companyUrl, { cache: "no-store" }),
			fetch(globalUrl, { cache: "no-store" }),
		]);

		const companyNews = companyResponse.ok
			? ((await companyResponse.json()) as { articles?: Record<string, unknown>[] }).articles?.map(mapNewsApiArticle) ?? []
			: [];

		const globalNews = globalResponse.ok
			? ((await globalResponse.json()) as { articles?: Record<string, unknown>[] }).articles?.map(mapGnewsArticle) ?? []
			: [];

		await logApiUsage("newsapi", companyResponse.ok ? "success" : "error", normalizedTicker);
		await logApiUsage("gnews", globalResponse.ok ? "success" : "error", normalizedTicker);

		if (!companyResponse.ok) {
			const companyError = await companyResponse.text();
			console.warn(
				"[fetchNews] NewsAPI request failed details:",
				companyResponse.status,
				companyResponse.statusText,
				companyError.slice(0, 300),
			);
			console.warn("[fetchNews] NewsAPI request failed. Falling back to GNews company feed.");
			const companyQueries = buildGnewsQueries(normalizedTicker, companyName);
			const fallbackCompany = await fetchGnews(companyQueries[0] ?? `${normalizedTicker} stock`, 10);
			return {
				ticker: normalizedTicker,
				company_news: filterRelevantCompanyNews(fallbackCompany, normalizedTicker, companyName, keywordPlan),
				global_news: dedupeArticles(globalNews).slice(0, 5),
			};
		}

		return {
			ticker: normalizedTicker,
			company_news: filterRelevantCompanyNews(companyNews, normalizedTicker, companyName, keywordPlan),
			global_news: dedupeArticles(globalNews).slice(0, 5),
		};
	} catch (error) {
		console.error("[fetchNews] Error:", error);
		return emptyNewsData(ticker);
	}
}