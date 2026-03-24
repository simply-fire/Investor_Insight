import dotenv from "dotenv";

import { fetchFundamentals } from "../lib/fetchers/alpha";
import { fetchMacroData } from "../lib/fetchers/fred";
import { fetchNews } from "../lib/fetchers/news";
import { computeTechnicals } from "../lib/fetchers/technicals";
import { fetchOHLCV, fetchQuote } from "../lib/fetchers/yahoo";

dotenv.config({ path: ".env.local", quiet: true });

async function run() {
  const ticker = "AAPL";

  console.log("\n=== fetchQuote ===");
  const quote = await fetchQuote(ticker);
  console.log(JSON.stringify(quote, null, 2));

  console.log("\n=== fetchOHLCV ===");
  const ohlcv = await fetchOHLCV(ticker, 200);
  console.log(`Rows: ${ohlcv.length}`);
  console.log(JSON.stringify(ohlcv.slice(-3), null, 2));

  console.log("\n=== computeTechnicals ===");
  const technicals = computeTechnicals(ohlcv);
  console.log(JSON.stringify(technicals, null, 2));

  console.log("\n=== fetchFundamentals ===");
  const fundamentals = await fetchFundamentals(ticker);
  console.log(JSON.stringify(fundamentals, null, 2));

  console.log("\n=== fetchNews ===");
  const news = await fetchNews(ticker, quote.company_name || "Apple Inc.");
  console.log(JSON.stringify(news, null, 2));

  console.log("\n=== fetchMacroData ===");
  const macro = await fetchMacroData();
  console.log(JSON.stringify(macro, null, 2));
}

run().catch((error) => {
  console.error("[test-fetchers] Unexpected failure:", error);
  process.exitCode = 1;
});
