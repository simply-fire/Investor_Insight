export function buildNewsSummaryPrompt(
	ticker: string,
	articleTitle: string,
	articleSummary: string,
): string {
	const normalizedTicker = ticker.toUpperCase().trim();

	return `Analyze this financial news article for ${normalizedTicker}.
Return JSON only:
{
  "sentiment": <-1.0 to 1.0>,
  "impact": "SHORT | MEDIUM | LONG",
  "affected_metric": "revenue | margins | regulation | competition | macro | other",
  "one_line_impact": "<15 word description of how this affects the stock>"
}
Article: ${articleTitle}. ${articleSummary}`;
}