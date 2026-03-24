export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuoteData {
  ticker: string;
  price: number;
  change_pct: number;
  volume: number;
  market_cap: number;
  company_name: string;
  sector: string;
}

export interface Fundamentals {
  ticker: string;
  pe_ratio: number;
  eps: number;
  revenue_growth: number;
  debt_to_equity: number;
  profit_margin: number;
  roe: number;
  current_ratio: number;
  price_to_book: number;
  dividend_yield: number;
  source: "alpha_vantage" | "fmp";
}

export interface Technicals {
  rsi_14: number;
  macd: number;
  macd_signal: number;
  macd_hist: number;
  sma_50: number;
  sma_200: number;
  ema_20: number;
  bollinger_upper: number;
  bollinger_lower: number;
  bollinger_mid: number;
  volume_avg_20: number;
  support_levels: number[];
  resistance_levels: number[];
}

export interface Article {
  title: string;
  source: string;
  url: string;
  published_at: string;
  summary: string;
}

export interface NewsData {
  ticker: string;
  company_news: Article[];
  global_news: Article[];
}

export interface MacroData {
  fed_funds_rate: number;
  cpi_yoy: number;
  unemployment_rate: number;
  gdp_growth_qoq: number;
  yield_10y: number;
  yield_2y: number;
  yield_spread: number;
}

export interface FundamentalDimension {
  score: number;
  note: string;
}

export interface ValuationDimension extends FundamentalDimension {
  pe_ratio: number;
  pb_ratio: number;
}

export interface ProfitabilityDimension extends FundamentalDimension {
  profit_margin: number;
  roe: number;
}

export interface GrowthDimension extends FundamentalDimension {
  revenue_growth_yoy: number;
  eps_growth: number;
}

export interface FinancialHealthDimension extends FundamentalDimension {
  debt_to_equity: number;
  current_ratio: number;
}

export interface FundamentalAgentOutput {
  ticker: string;
  valuation: ValuationDimension;
  profitability: ProfitabilityDimension;
  growth: GrowthDimension;
  financial_health: FinancialHealthDimension;
  overall_score: number;
  summary: string;
}

export interface TechnicalIndicatorReading {
  value?: number;
  signal: string;
  note: string;
  position?: string;
}

export interface TechnicalAgentOutput {
  ticker: string;
  current_price: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  indicators: {
    rsi_14: TechnicalIndicatorReading;
    macd: TechnicalIndicatorReading;
    sma_50_vs_200: TechnicalIndicatorReading;
    bollinger: TechnicalIndicatorReading;
  };
  key_levels: {
    support: number[];
    resistance: number[];
  };
  pattern_detected: string;
  overall_signal: string;
}

export interface NewsStoryImpact {
  title: string;
  sentiment: number;
  impact: "SHORT" | "MEDIUM" | "LONG";
  one_line_impact: string;
}

export interface NewsAgentOutput {
  ticker: string;
  aggregate_sentiment: number;
  sentiment_label: "NEGATIVE" | "MILDLY_NEGATIVE" | "NEUTRAL" | "MILDLY_POSITIVE" | "POSITIVE";
  top_stories: NewsStoryImpact[];
  macro_headwinds: string[];
  macro_tailwinds: string[];
  summary: string;
}

export interface MacroAgentOutput {
  ticker: string;
  macro_score: number;
  rate_environment_impact: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  inflation_impact: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  key_tailwinds: string[];
  key_headwinds: string[];
  summary: string;
  macro_data: MacroData;
}

export interface VerdictHorizon {
  verdict: "BUY" | "HOLD" | "AVOID" | "SELL";
  confidence_pct: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  time_horizon: string;
  target_price: number;
  stop_loss: number;
  supporting_data: string[];
  pros: string[];
  cons: string[];
  probability_of_success: number;
  key_risk: string;
}

export interface FullVerdicts {
  long_term: VerdictHorizon;
  swing_trade: VerdictHorizon;
  day_trade: VerdictHorizon;
}

export interface AnalysisResult {
  ticker: string;
  quote: QuoteData;
  fundamental: FundamentalAgentOutput;
  technical: TechnicalAgentOutput;
  news: NewsAgentOutput;
  macro: MacroAgentOutput;
  verdict: FullVerdicts;
}
