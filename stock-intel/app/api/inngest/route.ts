import { serve } from "inngest/next";

import { analyzeStock, inngest } from "@/lib/inngest";

export const { GET, POST, PUT } = serve({
	client: inngest,
	functions: [analyzeStock],
});