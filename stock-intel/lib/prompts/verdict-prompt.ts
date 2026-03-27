export function buildVerdictPrompt(
	ticker: string,
	fundamental: Record<string, unknown>,
	technical: Record<string, unknown>,
	news: Record<string, unknown>,
	macro: Record<string, unknown>,
): string {
	const normalizedTicker = ticker.toUpperCase().trim();

	return `You are a senior equity analyst. Respond ONLY with valid JSON.

RULES:
1. Be data-specific - reference actual numbers from the provided data.
2. Every pro/con must cite a specific metric.
3. probability_of_success must be conservative (this is a realistic win rate, not optimism).
4. If data is missing for a section, use the available data and note the gap in key_risk.
5. Respond ONLY with valid JSON - no markdown fences, no explanation, no preamble.

Return all 3 horizons (long_term, swing_trade, day_trade) in one JSON object in a single response.

Ticker: ${normalizedTicker}

AGENT OUTPUTS:

[FUNDAMENTAL_AGENT_JSON]
${JSON.stringify(fundamental, null, 2)}

[TECHNICAL_AGENT_JSON]
${JSON.stringify(technical, null, 2)}

[NEWS_AGENT_JSON]
${JSON.stringify(news, null, 2)}

[MACRO_AGENT_JSON]
${JSON.stringify(macro, null, 2)}

REQUIRED VERDICT SCHEMA EXAMPLE (use this exact shape and keys):
{
	"long_term": {
		"verdict": "BUY | HOLD | AVOID | SELL",
		"confidence_pct": 72,
		"risk_level": "LOW | MEDIUM | HIGH",
		"time_horizon": "2-5 years",
		"target_price": 185.0,
		"stop_loss": 142.0,
		"supporting_data": [
			"Revenue CAGR of 18% over 3 years",
			"RSI at 42 - oversold territory",
			"Fed rate cut expected Q1 - tailwind for growth stocks"
		],
		"pros": [
			"Strong moat in cloud segment",
			"Improving operating margins"
		],
		"cons": [
			"High P/E of 38 - priced for perfection",
			"China revenue exposure (~15%)"
		],
		"probability_of_success": 68,
		"key_risk": "Macro recession reducing enterprise cloud spend"
	},
	"swing_trade": {
		"verdict": "BUY | HOLD | AVOID | SELL",
		"confidence_pct": 64,
		"risk_level": "LOW | MEDIUM | HIGH",
		"time_horizon": "2-8 weeks",
		"target_price": 182.0,
		"stop_loss": 171.0,
		"supporting_data": [
			"Price 176.4 is near support at 172.0",
			"MACD histogram improved from -0.8 to -0.2"
		],
		"pros": [
			"RSI 38.2 indicates potential mean reversion"
		],
		"cons": [
			"50DMA below 200DMA (death cross) signals trend risk"
		],
		"probability_of_success": 57,
		"key_risk": "Break below 172 support invalidates setup"
	},
	"day_trade": {
		"verdict": "BUY | HOLD | AVOID | SELL",
		"confidence_pct": 55,
		"risk_level": "LOW | MEDIUM | HIGH",
		"time_horizon": "1-3 days",
		"target_price": 178.2,
		"stop_loss": 174.5,
		"supporting_data": [
			"Intraday volatility 1.9% over last 10 sessions",
			"Volume 22% above 20-day average"
		],
		"pros": [
			"High relative volume can support short-term moves"
		],
		"cons": [
			"News headline risk can reverse intraday momentum"
		],
		"probability_of_success": 52,
		"key_risk": "Unexpected macro headlines can spike volatility"
	}
}`;
}