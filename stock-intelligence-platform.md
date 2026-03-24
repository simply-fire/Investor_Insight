# Stock Intelligence Platform — Full Build Spec for Claude Code

> **Purpose:** This document is the single source of truth for building the Stock Intelligence Platform. Claude Code should read this end-to-end before writing any code. Every module is self-contained and independently testable. Build in the order listed.

---

## 1. Project Overview

A web application that gives retail investors deep, data-backed investment intelligence on any stock. Users enter a ticker and receive:

- Fundamental analysis (financials, ratios, valuation)
- Technical analysis (indicators, signals, chart patterns)
- News & sentiment (global macro + company-specific)
- A synthesised investment verdict for three horizons: **Long Term**, **Swing Trade**, **Day Trade**
- A chatbot to ask follow-up questions grounded in the analysis

---

## 2. Tech Stack

### Frontend
| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | Server components, streaming, free deploy on Vercel |
| Styling | Tailwind CSS + shadcn/ui | Pre-built components, fast iteration |
| Charts | lightweight-charts (TradingView OSS) + Recharts | Candlestick + supplementary charts |
| Language | TypeScript throughout | Type safety across frontend and edge functions |

### Backend / Infrastructure
| Layer | Choice | Why |
|---|---|---|
| BaaS | Supabase (free tier) | Auth + Postgres + Edge Functions + Realtime — zero infra |
| Edge Functions | Deno (Supabase native) | Serverless, 150s timeout — sufficient for full pipeline |
| Job durability | Inngest (free tier: 50K runs/month) | Step-level retries, observability, no server needed |
| Deploy | Vercel (free tier) | Native Next.js, CI/CD on push |

### LLMs (all free tier)
| Model | Provider | Used For |
|---|---|---|
| Gemini 1.5 Flash | Google AI Studio | Primary: verdict synthesis, news summarisation |
| Llama 3.1 70B | Groq | Fallback + technical signal narration (very fast) |
| Mistral 7B | Mistral AI | Chat agent (low latency, conversational) |

### Free Data APIs
| Data | Source | Notes |
|---|---|---|
| Price / OHLCV | Yahoo Finance (via `yfinance` Python or `yahoo-finance2` npm) | No API key needed |
| Fundamentals | Alpha Vantage (free: 25 req/day) | Cache aggressively |
| Company news | NewsAPI or GNews (free: 100 req/day) | Cache per ticker per 4hrs |
| Macro indicators | FRED API (St. Louis Fed) | Completely free, no rate limit concern |
| Additional fundamentals | Financial Modeling Prep (free tier) | P/E, EPS, revenue, debt ratios |

---

## 3. Supabase Free Tier — Limits & Strategy

| Resource | Free Limit | Our Usage Pattern |
|---|---|---|
| Postgres | 500 MB | Analysis JSON per ticker ~10KB; 50K tickers = 500MB — monitor |
| Edge Function invocations | 500K / month | ~6 invocations per analysis; 80K analyses/month possible |
| Edge Function timeout | 150 seconds | Full pipeline runs in 8–12s — well within limit |
| Bandwidth | 2 GB / month | API responses are JSON, very small |
| Realtime connections | 200 concurrent | Fine for MVP |

**Cache strategy:** Every analysis result is cached in Postgres with a TTL. Check cache before invoking any agent. This is the single most important cost control mechanism.

- Markets open (weekdays 09:30–16:00 ET): TTL = 4 hours
- After market close / weekends: TTL = 24 hours

---

## 4. Architecture Overview

```
User (Browser)
    │
    ▼
Next.js Frontend (Vercel)
    │  API calls + Realtime subscription
    ▼
Supabase Edge Function: /orchestrate
    │
    ├── Check analysis_cache (Postgres)
    │       └── Cache HIT → return immediately (~500ms)
    │
    └── Cache MISS → Inngest job triggered
            │
            ├── [Parallel] fundamental-agent
            ├── [Parallel] technical-agent
            ├── [Parallel] news-agent
            ├── [Parallel] macro-agent
            │
            └── verdict-agent (receives all 4 outputs)
                    │
                    ├── Write to analysis_cache
                    ├── Write to verdicts table
                    └── Push via Supabase Realtime → Frontend
```

---

## 5. Folder Structure

```
/
├── app/
│   ├── page.tsx                        # Home: search bar + recent tickers
│   ├── stock/
│   │   └── [ticker]/
│   │       └── page.tsx                # Main analysis page
│   └── api/
│       └── inngest/
│           └── route.ts                # Inngest webhook handler
│
├── components/
│   ├── SearchBar.tsx
│   ├── VerdictCard.tsx                 # Long/Swing/Trade verdict display
│   ├── FundamentalPanel.tsx
│   ├── TechnicalPanel.tsx
│   ├── NewsPanel.tsx
│   ├── ChatPanel.tsx
│   └── LoadingState.tsx               # Streaming progress UI
│
├── lib/
│   ├── fetchers/
│   │   ├── yahoo.ts                    # Price, OHLCV, volume
│   │   ├── alpha.ts                    # Fundamentals via Alpha Vantage
│   │   ├── news.ts                     # NewsAPI / GNews
│   │   ├── fred.ts                     # Macro data from FRED
│   │   └── technicals.ts              # RSI, MACD, Bollinger, MA computation
│   ├── prompts/
│   │   ├── verdict-prompt.ts
│   │   ├── news-summary-prompt.ts
│   │   └── chat-prompt.ts
│   ├── supabase.ts                     # Supabase client (browser)
│   ├── supabase-server.ts             # Supabase client (server components)
│   └── inngest.ts                     # Inngest client + function definitions
│
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── functions/
│       ├── orchestrate/
│       │   └── index.ts
│       ├── fundamental-agent/
│       │   └── index.ts
│       ├── technical-agent/
│       │   └── index.ts
│       ├── news-agent/
│       │   └── index.ts
│       ├── macro-agent/
│       │   └── index.ts
│       ├── verdict-agent/
│       │   └── index.ts
│       └── chat/
│           └── index.ts
│
├── .env.local
├── .env.example
└── package.json
```

---

## 6. Database Schema

Run this migration via Supabase dashboard or `supabase db push`.

```sql
-- Cache table: stores full analysis per ticker
CREATE TABLE analysis_cache (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker        TEXT NOT NULL,
  exchange      TEXT,
  data          JSONB NOT NULL,         -- full merged agent output
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  INDEX         (ticker, expires_at)
);

-- Verdicts table: stores the final investment verdicts
CREATE TABLE verdicts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker        TEXT NOT NULL,
  long_term     JSONB NOT NULL,         -- see verdict schema below
  swing_trade   JSONB NOT NULL,
  day_trade     JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Chat sessions: stores conversation history per ticker per user
CREATE TABLE chat_sessions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker        TEXT NOT NULL,
  user_id       UUID REFERENCES auth.users(id),
  messages      JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Realtime on analysis_cache so frontend gets live updates
ALTER PUBLICATION supabase_realtime ADD TABLE analysis_cache;
```

### Verdict JSON Schema (each of long_term, swing_trade, day_trade)

```json
{
  "verdict": "BUY | HOLD | AVOID | SELL",
  "confidence_pct": 72,
  "risk_level": "LOW | MEDIUM | HIGH",
  "time_horizon": "2–5 years",
  "target_price": 185.00,
  "stop_loss": 142.00,
  "supporting_data": [
    "Revenue CAGR of 18% over 3 years",
    "RSI at 42 — oversold territory",
    "Fed rate cut expected Q1 — tailwind for growth stocks"
  ],
  "pros": [
    "Strong moat in cloud segment",
    "Improving operating margins"
  ],
  "cons": [
    "High P/E of 38 — priced for perfection",
    "China revenue exposure (~15%)"
  ],
  "probability_of_success": 68,
  "key_risk": "Macro recession reducing enterprise cloud spend"
}
```

---

## 7. Environment Variables

```bash
# .env.local

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# LLMs
GEMINI_API_KEY=           # Google AI Studio — free
GROQ_API_KEY=             # Groq — free tier
MISTRAL_API_KEY=          # Mistral — free tier

# Data APIs
ALPHA_VANTAGE_KEY=        # alphavantage.co — free
NEWS_API_KEY=             # newsapi.org — free
FRED_API_KEY=             # fred.stlouisfed.org — free

# Inngest
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

---

## 8. Module Build Plan

Build strictly in this order. Each module must be tested with ticker `AAPL` before proceeding.

---

### Module 1 — Project Scaffold

**Goal:** Running Next.js app that connects to Supabase.

```bash
npx create-next-app@latest stock-intel --typescript --tailwind --app
cd stock-intel
npx shadcn-ui@latest init
npx shadcn-ui@latest add card badge button tabs skeleton separator
npm install @supabase/supabase-js @supabase/ssr inngest lightweight-charts recharts
npm install -D supabase
```

**Checklist:**
- [ ] `lib/supabase.ts` — browser client using `createBrowserClient`
- [ ] `lib/supabase-server.ts` — server client using `createServerClient` with cookie handling
- [ ] `app/page.tsx` — renders "Stock Intelligence" heading and a search input
- [ ] Supabase project created, URL and anon key in `.env.local`
- [ ] `supabase db push` runs without error after adding schema from Module 2

---

### Module 2 — Database Schema

**Goal:** All tables exist, Realtime is enabled.

- Run `001_initial_schema.sql` from section 6
- Verify in Supabase dashboard: Tables tab shows all 3 tables
- Verify Realtime: `analysis_cache` appears in Realtime > Tables

---

### Module 3 — Data Fetcher Layer

**Goal:** Each fetcher returns typed data for `AAPL` when called directly.

#### `lib/fetchers/yahoo.ts`
```typescript
// Returns: { price, change_pct, volume, market_cap, ohlcv: OHLCV[] }
// Use yahoo-finance2 npm package
// OHLCV array: last 200 trading days for technical analysis
export async function fetchQuote(ticker: string): Promise<QuoteData>
export async function fetchOHLCV(ticker: string, days: number): Promise<OHLCV[]>
```

#### `lib/fetchers/alpha.ts`
```typescript
// Returns: { pe_ratio, eps, revenue_growth, debt_to_equity, profit_margin,
//            roe, current_ratio, price_to_book, dividend_yield }
// Alpha Vantage OVERVIEW endpoint
// IMPORTANT: Cache result in memory for the session — only 25 free req/day
export async function fetchFundamentals(ticker: string): Promise<Fundamentals>
```

#### `lib/fetchers/technicals.ts`
```typescript
// Computed from OHLCV data — no external API needed
// Returns: { rsi_14, macd, macd_signal, macd_hist,
//            sma_50, sma_200, ema_20, bollinger_upper,
//            bollinger_lower, bollinger_mid, volume_avg_20,
//            support_levels: number[], resistance_levels: number[] }
export function computeTechnicals(ohlcv: OHLCV[]): Technicals
```

#### `lib/fetchers/news.ts`
```typescript
// Returns: { company_news: Article[], global_news: Article[] }
// company_news: NewsAPI q="{ticker} OR {company_name}" last 7 days
// global_news: GNews q="stock market OR economy OR fed" last 3 days
// Article: { title, source, url, published_at, summary }
export async function fetchNews(ticker: string, companyName: string): Promise<NewsData>
```

#### `lib/fetchers/fred.ts`
```typescript
// Returns: { fed_funds_rate, cpi_yoy, unemployment_rate,
//            gdp_growth_qoq, yield_10y, yield_2y, yield_spread }
// FRED series: FEDFUNDS, CPCAUCSL, UNRATE, A191RL1Q225SBEA, DGS10, DGS2
export async function fetchMacroData(): Promise<MacroData>
```

---

### Module 4 — Agent Edge Functions

Each function lives in `supabase/functions/{agent-name}/index.ts`. Each is a standalone Deno HTTP handler. Each accepts `{ ticker: string }` and returns structured JSON.

**Shared pattern for all agents:**
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  const { ticker } = await req.json()
  // ... fetch data, call LLM if needed, return JSON
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" }
  })
})
```

#### `supabase/functions/fundamental-agent/`

**Input:** `{ ticker }`
**Process:**
1. Call `fetchFundamentals(ticker)` — Alpha Vantage
2. Call `fetchQuote(ticker)` — Yahoo Finance
3. Score the stock on 5 dimensions (0–10 each): valuation, profitability, growth, financial health, dividend
4. Return structured JSON with raw data + scores + plain-English summary

**Output:**
```json
{
  "ticker": "AAPL",
  "valuation": { "pe_ratio": 28.4, "pb_ratio": 44.2, "score": 5, "note": "Premium valuation vs peers" },
  "profitability": { "profit_margin": 0.253, "roe": 1.62, "score": 9, "note": "Exceptional margins" },
  "growth": { "revenue_growth_yoy": 0.04, "eps_growth": 0.08, "score": 6, "note": "Slowing growth" },
  "financial_health": { "debt_to_equity": 1.73, "current_ratio": 0.99, "score": 6, "note": "Leveraged but manageable" },
  "overall_score": 6.5,
  "summary": "Apple remains highly profitable with exceptional margins but trades at a premium valuation. Revenue growth is decelerating. Balance sheet is leveraged."
}
```

#### `supabase/functions/technical-agent/`

**Input:** `{ ticker }`
**Process:**
1. Call `fetchOHLCV(ticker, 200)` — Yahoo Finance
2. Call `computeTechnicals(ohlcv)` — local computation
3. Generate signal labels: "BULLISH" | "BEARISH" | "NEUTRAL" for each indicator
4. Detect pattern: golden cross, death cross, RSI divergence, price at support/resistance

**Output:**
```json
{
  "ticker": "AAPL",
  "current_price": 178.50,
  "trend": "BEARISH",
  "indicators": {
    "rsi_14": { "value": 38.2, "signal": "OVERSOLD", "note": "Below 40 — approaching oversold" },
    "macd": { "value": -1.2, "signal": "BEARISH", "note": "Below signal line" },
    "sma_50_vs_200": { "signal": "DEATH_CROSS", "note": "50 MA crossed below 200 MA" },
    "bollinger": { "position": "LOWER_BAND", "signal": "OVERSOLD" }
  },
  "key_levels": {
    "support": [172.0, 165.0],
    "resistance": [185.0, 192.0]
  },
  "pattern_detected": "Approaching major support at 172. RSI oversold. Potential reversal zone.",
  "overall_signal": "CAUTIOUS_BUY — oversold but in downtrend"
}
```

#### `supabase/functions/news-agent/`

**Input:** `{ ticker, company_name }`
**Process:**
1. Call `fetchNews(ticker, company_name)`
2. For each article, call Gemini Flash to extract: sentiment (-1 to 1), key impact, affected metric (revenue / margins / regulation / competition)
3. Aggregate sentiment score
4. Identify the top 3 most impactful news items

**LLM prompt for each article:**
```
Analyze this financial news article for ${ticker}.
Return JSON only:
{
  "sentiment": <-1.0 to 1.0>,
  "impact": "SHORT | MEDIUM | LONG",
  "affected_metric": "revenue | margins | regulation | competition | macro | other",
  "one_line_impact": "<15 word description of how this affects the stock>"
}
Article: ${article.title}. ${article.summary}
```

**Output:**
```json
{
  "ticker": "AAPL",
  "aggregate_sentiment": 0.3,
  "sentiment_label": "MILDLY_POSITIVE",
  "top_stories": [
    {
      "title": "Apple Vision Pro sales disappoint analysts",
      "sentiment": -0.6,
      "impact": "MEDIUM",
      "one_line_impact": "Reduces near-term revenue expectations for hardware segment"
    }
  ],
  "macro_headwinds": ["High interest rates suppressing consumer spending"],
  "macro_tailwinds": ["AI spending cycle benefits App Store revenue"],
  "summary": "News flow is mildly positive. Vision Pro weakness offset by strong services momentum."
}
```

#### `supabase/functions/macro-agent/`

**Input:** `{ ticker, sector }`
**Process:**
1. Call `fetchMacroData()`
2. Call Gemini Flash to interpret macro data in context of the stock's sector
3. Return structured impact assessment

**LLM prompt:**
```
Given this macro data and the fact that ${ticker} is in the ${sector} sector, 
assess the macro environment's impact on this stock.
Return JSON only:
{
  "macro_score": <1-10, 10=very favorable>,
  "rate_environment_impact": "POSITIVE | NEUTRAL | NEGATIVE",
  "inflation_impact": "POSITIVE | NEUTRAL | NEGATIVE",
  "key_tailwinds": ["<string>"],
  "key_headwinds": ["<string>"],
  "summary": "<2-3 sentence macro assessment>"
}
Macro data: ${JSON.stringify(macroData)}
```

---

### Module 5 — Orchestrator Edge Function

**File:** `supabase/functions/orchestrate/index.ts`

**Full logic:**

```typescript
serve(async (req) => {
  const { ticker } = await req.json()
  const supabase = createClient(/* service role */)

  // 1. Check cache
  const { data: cached } = await supabase
    .from('analysis_cache')
    .select('data')
    .eq('ticker', ticker)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (cached) return new Response(JSON.stringify(cached.data))

  // 2. Trigger Inngest job (non-blocking) — returns job ID immediately
  await inngest.send({ name: 'stock/analyze', data: { ticker } })

  // 3. Return 202 Accepted — frontend subscribes via Realtime for result
  return new Response(JSON.stringify({ status: 'analyzing', ticker }), { status: 202 })
})
```

**Inngest function (`lib/inngest.ts`):**

```typescript
export const analyzeStock = inngest.createFunction(
  { id: 'analyze-stock', retries: 2 },
  { event: 'stock/analyze' },
  async ({ event, step }) => {
    const { ticker } = event.data

    // All 4 agents in parallel — each is a durable step
    const [fundamental, technical, news, macro] = await Promise.all([
      step.run('fundamental-agent', () => callAgent('fundamental-agent', { ticker })),
      step.run('technical-agent', () => callAgent('technical-agent', { ticker })),
      step.run('news-agent', () => callAgent('news-agent', { ticker })),
      step.run('macro-agent', () => callAgent('macro-agent', { ticker })),
    ])

    // Verdict synthesis — after all agents complete
    const verdict = await step.run('verdict-agent', () =>
      callAgent('verdict-agent', { ticker, fundamental, technical, news, macro })
    )

    // Write to cache + verdicts table
    await step.run('persist', async () => {
      const expiresAt = computeExpiry() // 4h or 24h based on market hours
      await supabase.from('analysis_cache').upsert({
        ticker, data: { fundamental, technical, news, macro, verdict }, expires_at: expiresAt
      })
      await supabase.from('verdicts').insert({ ticker, ...verdict })
    })
  }
)
```

---

### Module 6 — Verdict Agent

**File:** `supabase/functions/verdict-agent/index.ts`

This agent receives all 4 other agents' outputs and calls Gemini Flash with a structured prompt to produce the final three verdicts.

**LLM prompt (in `lib/prompts/verdict-prompt.ts`):**

```
You are a senior equity analyst. Based on the analysis below, produce investment verdicts for THREE time horizons.

RULES:
- Be data-specific. Reference actual numbers from the data.
- Every claim in pros/cons must be backed by data provided.
- Probability of success = realistic win rate, not a sales pitch. Be conservative.
- Respond ONLY with valid JSON matching the schema exactly. No markdown, no explanation.

ANALYSIS DATA:
Fundamental: ${JSON.stringify(fundamental)}
Technical: ${JSON.stringify(technical)}
News & Sentiment: ${JSON.stringify(news)}
Macro: ${JSON.stringify(macro)}

REQUIRED OUTPUT SCHEMA (return this exact structure):
{
  "long_term": { ...verdict schema... },
  "swing_trade": { ...verdict schema... },
  "day_trade": { ...verdict schema... }
}

Where each verdict has:
{
  "verdict": "BUY | HOLD | AVOID | SELL",
  "confidence_pct": <integer 0-100>,
  "risk_level": "LOW | MEDIUM | HIGH",
  "time_horizon": "<string e.g. '2-5 years'>",
  "target_price": <number>,
  "stop_loss": <number>,
  "supporting_data": ["<specific data point>", ...],
  "pros": ["<string>", ...],
  "cons": ["<string>", ...],
  "probability_of_success": <integer 0-100>,
  "key_risk": "<single most important risk>"
}
```

---

### Module 7 — Chat Agent

**File:** `supabase/functions/chat/index.ts`

**Input:** `{ ticker, message, messages: Message[], analysis_context }`

**Logic:**
1. Retrieve full analysis from `analysis_cache` for the ticker
2. Build system prompt grounding the LLM in that analysis
3. Stream response back using Mistral AI (conversational, low latency)
4. Update `chat_sessions` with the new message pair

**System prompt (`lib/prompts/chat-prompt.ts`):**
```
You are a financial analyst assistant specialising in ${ticker}.
You have just completed a full analysis of this stock. Answer the user's questions
using ONLY the data from this analysis. If asked something not covered in the analysis,
say so clearly. Be concise, specific, and always cite the relevant data point.

ANALYSIS CONTEXT:
${JSON.stringify(analysis_context)}

IMPORTANT: Never give general financial advice. Always refer to the specific data above.
Do not recommend buying or selling — describe what the data shows.
```

---

### Module 8 — Frontend Pages

#### `app/page.tsx` — Home

- Centred search bar with placeholder "Enter ticker (e.g. AAPL, RELIANCE.NS)"
- On submit: navigate to `/stock/[ticker]`
- Show 6 recently analysed tickers as clickable chips (read from `analysis_cache`)

#### `app/stock/[ticker]/page.tsx` — Analysis Page

**Flow:**
1. On load: call `/orchestrate` edge function
2. If 202 returned (cache miss): show loading skeleton + subscribe to Supabase Realtime on `analysis_cache` for this ticker
3. When Realtime fires: hydrate all panels with data
4. If 200 returned (cache hit): render immediately

**Tab layout (shadcn/ui Tabs):**

```
[ Overview ] [ Fundamentals ] [ Technical ] [ News ] [ Chat ]
```

#### `components/VerdictCard.tsx`

Three cards side by side (or stacked on mobile): Long Term, Swing Trade, Day Trade.

Each card shows:
- Verdict badge (color-coded: green=BUY, yellow=HOLD, red=SELL/AVOID)
- Confidence percentage with progress bar
- Risk level indicator
- Target price + stop loss
- Probability of success
- Expandable pros/cons accordion
- Supporting data bullets
- Key risk highlighted in amber

#### `components/TechnicalPanel.tsx`

- `lightweight-charts` candlestick chart with 200-day OHLCV
- Overlays: SMA 50 (blue), SMA 200 (orange), Bollinger Bands (gray)
- Indicator row below chart: RSI, MACD as small Recharts line charts
- Signal badges for each indicator
- Key support/resistance levels marked as horizontal lines on chart

#### `components/FundamentalPanel.tsx`

- Score card: 5 dimension scores (valuation, profitability, growth, health, dividend) as a radar chart
- Metrics table: all raw financial ratios with colour coding (green=good, red=concerning)
- Plain-English summary from the agent

#### `components/NewsPanel.tsx`

- Aggregate sentiment score as a gauge (–1 to +1)
- Top stories list with sentiment badge per story
- Macro tailwinds / headwinds as two columns
- External links to articles open in new tab

#### `components/ChatPanel.tsx`

- Chat UI: message history + input at bottom
- Pre-seeded opening message: "I've analysed {ticker}. Ask me anything about the fundamentals, technicals, or news."
- Stream responses from `/chat` edge function using `ReadableStream`
- Messages persisted in `chat_sessions` table

---

### Module 9 — Auth (Optional but Recommended)

Use Supabase Auth (magic link or Google OAuth).

- Protect `chat_sessions` with Row Level Security (users see only their own chats)
- No auth required to view analysis — analysis is public per ticker
- `middleware.ts` at root: allow unauthenticated access to `/stock/*` pages; require auth only for profile/history pages

---

## 9. Performance Considerations

### Expected Latency

| Scenario | Time |
|---|---|
| Cache hit | 300–600ms |
| Cache miss, full pipeline (parallel agents) | 8–12s |
| Verdict LLM call (Gemini Flash) | 2–4s |
| Chat response (Mistral, streaming) | 1–2s first token |
| Cold start penalty (Supabase Edge Function) | +200–400ms one-time |

### Why not LangGraph / CrewAI?

Both LangGraph and CrewAI are Python frameworks requiring a persistent server (FastAPI / Docker). Hosting that on free tier (Render, Railway) introduces 30–60 second cold starts after inactivity — much worse than the 200ms Deno cold start on Supabase.

The parallel execution performance is **identical** in both approaches. The bottleneck is always LLM calls and external API calls — not the orchestration layer. Supabase Edge Functions + Inngest give us step-level retries and observability (the main advantage of LangGraph) without any server overhead.

Use LangGraph if you later need: multi-turn agentic loops, conditional re-runs based on intermediate output, or human-in-the-loop approval steps.

---

## 10. Rate Limit Management

```typescript
// lib/rate-limit.ts
// Wrap all external API calls with this pattern

const LIMITS = {
  alpha_vantage: { calls: 25, window_hours: 24 },
  newsapi:       { calls: 100, window_hours: 24 },
  gemini_flash:  { calls: 1500, window_hours: 24, rpm: 15 },
  groq:          { calls: 14400, window_hours: 24 },
}

// Track usage in Postgres: api_usage_log table
// Before each call: check current count against limit
// If at limit: return cached data or graceful fallback message
```

**Fallback chain:**
- Alpha Vantage at limit → use Financial Modeling Prep
- Gemini Flash at limit → fall back to Groq (Llama 3.1 70B)
- NewsAPI at limit → use GNews
- All news APIs at limit → return "News data unavailable for this session" in the news agent output

---

## 11. Error Handling Standards

Every edge function must follow this pattern:

```typescript
try {
  // main logic
  return new Response(JSON.stringify(result), { status: 200 })
} catch (error) {
  console.error(`[${functionName}] Error:`, error)
  return new Response(
    JSON.stringify({ error: 'Analysis failed', detail: error.message, partial: partialData }),
    { status: 500 }
  )
}
```

The orchestrator must handle partial failures — if one agent fails, continue with the others and mark that section as unavailable in the verdict. The verdict agent prompt must handle missing sections gracefully.

---

## 12. Testing Checklist (per module)

Before moving to the next module, verify:

- [ ] Module 1: `npm run dev` runs, Supabase connection confirmed in browser console
- [ ] Module 2: All tables visible in Supabase dashboard, Realtime enabled
- [ ] Module 3: Each fetcher returns data for `AAPL` when tested via `tsx lib/fetchers/yahoo.ts`
- [ ] Module 4: Each agent returns valid JSON for `AAPL` via `supabase functions serve`
- [ ] Module 5: Orchestrator returns 202 on cache miss, 200 on cache hit
- [ ] Module 6: Verdict agent returns all 3 horizons with valid JSON structure
- [ ] Module 7: Chat responds to "What is AAPL's P/E ratio?" with data from the analysis
- [ ] Module 8: Full UI renders for `AAPL` with all 5 tabs populated
- [ ] Module 9: Unauthenticated users can view analysis; chat sessions save correctly

---

## 13. Deployment

### Vercel (Frontend)
```bash
vercel --prod
# Set all NEXT_PUBLIC_* env vars in Vercel dashboard
```

### Supabase Edge Functions
```bash
supabase functions deploy orchestrate
supabase functions deploy fundamental-agent
supabase functions deploy technical-agent
supabase functions deploy news-agent
supabase functions deploy macro-agent
supabase functions deploy verdict-agent
supabase functions deploy chat
```

### Inngest
- Connect Inngest to production via dashboard
- Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Vercel env vars
- Verify functions appear in Inngest dashboard after first event

---

## 14. Future Enhancements (post-MVP)

- Portfolio tracker: save multiple tickers, get aggregate risk view
- Price alerts: Supabase scheduled functions re-analyse when price hits key levels
- Comparison mode: analyse two tickers side by side
- Indian market support: add NSE/BSE data via `nsepy` or Zerodha Kite API
- Backtesting: show historical performance of the strategy signals
- Upgrade LLMs: swap Gemini Flash for Claude Sonnet when budget allows for higher quality verdicts
