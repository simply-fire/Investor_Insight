export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Handler for OPTIONS preflight requests
export function handleOptions(): Response {
  return new Response("OK", {
    status: 200,
    headers: corsHeaders,
  });
}
