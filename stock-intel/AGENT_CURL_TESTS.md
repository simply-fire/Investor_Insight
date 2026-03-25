# Agent Curl Test Commands (Manual)

This file contains ready-to-run PowerShell commands to test all 5 agents:
- fundamental-agent
- technical-agent
- news-agent
- macro-agent
- verdict-agent

## 1) Set base variables (PowerShell)

Run this once per terminal session:

```powershell
$envFile = ".env.local"
$url = (Get-Content $envFile | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_URL=' } | ForEach-Object { ($_ -split '=',2)[1].Trim() })
$key = (Get-Content $envFile | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' } | ForEach-Object { ($_ -split '=',2)[1].Trim() })

if (-not $url -or -not $key) {
  throw "Could not read NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY from .env.local"
}
```

## 2) fundamental-agent

```powershell
curl.exe -s -X POST "$url/functions/v1/fundamental-agent" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $key" `
  -H "apikey: $key" `
  -d '{"ticker":"AAPL"}'
```

## 3) technical-agent

```powershell
curl.exe -s -X POST "$url/functions/v1/technical-agent" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $key" `
  -H "apikey: $key" `
  -d '{"ticker":"AAPL"}'
```

## 4) news-agent

```powershell
curl.exe -s -X POST "$url/functions/v1/news-agent" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $key" `
  -H "apikey: $key" `
  -d '{"ticker":"AAPL","company_name":"Apple Inc."}'
```

## 5) macro-agent

```powershell
curl.exe -s -X POST "$url/functions/v1/macro-agent" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $key" `
  -H "apikey: $key" `
  -d '{"ticker":"AAPL","sector":"Technology"}'
```

## 6) verdict-agent (with sample input payload)

`verdict-agent` expects outputs from the other agents. Use this sample payload to test quickly.

```powershell
$verdictPayload = @'
{
  "ticker": "AAPL",
  "fundamental": {
    "ticker": "AAPL",
    "overall_score": 6.4,
    "summary": "Balanced fundamentals"
  },
  "technical": {
    "ticker": "AAPL",
    "current_price": 200,
    "trend": "NEUTRAL",
    "overall_signal": "CAUTIOUS_BUY"
  },
  "news": {
    "ticker": "AAPL",
    "aggregate_sentiment": 0.1,
    "sentiment_label": "NEUTRAL",
    "summary": "Mixed recent headlines"
  },
  "macro": {
    "ticker": "AAPL",
    "macro_score": 7,
    "rate_environment_impact": "NEUTRAL",
    "inflation_impact": "NEUTRAL",
    "summary": "Stable macro backdrop"
  }
}
'@

curl.exe -s -X POST "$url/functions/v1/verdict-agent" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $key" `
  -H "apikey: $key" `
  -d $verdictPayload
```

## Optional: pretty-print any response in PowerShell

```powershell
(curl.exe -s -X POST "$url/functions/v1/fundamental-agent" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $key" `
  -H "apikey: $key" `
  -d '{"ticker":"AAPL"}') | ConvertFrom-Json | ConvertTo-Json -Depth 20
```

## Notes

- If a function returns 401/403, recheck the anon key and Authorization/apikey headers.
- If a function returns an upstream data error, the function is reachable and auth is valid; the issue is likely with provider limits/data availability.
- `orchestrate` is currently not implemented in this repo (placeholder only).



