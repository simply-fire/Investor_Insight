import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function requireEnv(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing ${key}`);
  }

  return value;
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as { ticker?: string };
    const ticker = (payload.ticker ?? "").trim().toUpperCase();

    const supabaseUrl = requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = requireEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
    const localInngestUrl = process.env.INNGEST_DEV_URL?.trim() || (
      process.env.NODE_ENV !== "production" ? "http://127.0.0.1:8288" : ""
    );

    if (!ticker) {
      return NextResponse.json({ error: "ticker is required" }, { status: 400 });
    }

    if (localInngestUrl) {
      const supabase = createClient(supabaseUrl, serviceKey);

      const { data: cachedRow, error: cacheError } = await supabase
        .from("analysis_cache")
        .select("data")
        .eq("ticker", ticker)
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .maybeSingle();

      if (cacheError) {
        return NextResponse.json({ error: cacheError.message }, { status: 500 });
      }

      if (cachedRow?.data) {
        return NextResponse.json(cachedRow.data, {
          status: 200,
          headers: { "X-Cache": "HIT" },
        });
      }

      const eventKey = process.env.INNGEST_DEV_EVENT_KEY?.trim() || "local";
      const publishUrl = `${localInngestUrl.replace(/\/+$/, "")}/e/${eventKey}`;
      const eventResponse = await fetch(publishUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "stock/analyze",
          data: { ticker },
        }),
      });

      if (!eventResponse.ok) {
        const detail = await eventResponse.text();
        return NextResponse.json(
          { error: `Local Inngest publish failed (${eventResponse.status}): ${detail}` },
          { status: 502 },
        );
      }

      return NextResponse.json({ status: "analyzing", ticker }, {
        status: 202,
        headers: { "X-Cache": "MISS" },
      });
    }

    const response = await fetch(
      `${supabaseUrl}/functions/v1/orchestrate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ ticker }),
      },
    );

    return new NextResponse(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}