import Link from "next/link";

import { SearchBar } from "@/components/SearchBar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase-server";

type CacheTickerRow = {
  ticker: string;
  created_at: string;
};

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("analysis_cache")
    .select("ticker, created_at")
    .order("created_at", { ascending: false })
    .limit(24);

  const seen = new Set<string>();
  const recentTickers = ((data ?? []) as CacheTickerRow[])
    .filter((row) => {
      const key = row.ticker.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);

  return (
    <main className="flex min-h-screen items-center justify-center bg-linear-to-b from-background via-background to-muted/30 p-6">
      <section className="w-full max-w-2xl space-y-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">Investor Insight</CardTitle>
            <p className="text-sm text-muted-foreground">Data-backed investment intelligence</p>
          </CardHeader>
          <CardContent>
            <div className="mx-auto max-w-lg">
              <SearchBar />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recently analysed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {recentTickers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No analyses yet.</p>
              ) : (
                recentTickers.map((row) => (
                  <Link href={`/stock/${row.ticker.toUpperCase()}`} key={row.ticker}>
                    <Badge variant="secondary" className="cursor-pointer">
                      {row.ticker.toUpperCase()}
                    </Badge>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
