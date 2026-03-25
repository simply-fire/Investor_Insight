import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("OK", { headers: corsHeaders });
  }

  try {
    const alphaKey = Deno.env.get("ALPHA_VANTAGE_KEY") || "NOT_SET";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || "NOT_SET";
    const fredKey = Deno.env.get("FRED_API_KEY") || "NOT_SET";

    const result = {
      status: "ok",
      env: {
        ALPHA_VANTAGE_KEY: alphaKey.substring(0, 10) + "...",
        GEMINI_API_KEY: geminiKey.substring(0, 10) + "...",
        FRED_API_KEY: fredKey.substring(0, 10) + "..." ,
      },
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Test failed", detail: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
