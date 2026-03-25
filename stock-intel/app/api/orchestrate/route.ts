import { NextRequest, NextResponse } from "next/server";

function requireEnv(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing ${key}`);
  }

  return value;
}

export async function POST(req: NextRequest) {
  try {
    const { ticker } = (await req.json()) as { ticker?: string };

    const supabaseUrl = requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = requireEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");

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

    const data = await response.json();

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "X-Cache": response.headers.get("X-Cache") ?? "UNKNOWN",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}