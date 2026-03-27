"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AnalysisResult } from "@/lib/types";
import { createClient } from "@/lib/supabase";

type AnalysisStatus = "idle" | "loading" | "ready" | "error";

type AnalysisState = {
  status: AnalysisStatus;
  data: AnalysisResult | null;
  error: string | null;
};

const recentDispatchAt = new Map<string, number>();
const DEV_DISPATCH_DEDUPE_MS = 1500;

function isLikelyDuplicateDevDispatch(ticker: string): boolean {
  if (process.env.NODE_ENV !== "development") {
    return false;
  }

  const now = Date.now();
  const last = recentDispatchAt.get(ticker) ?? 0;
  recentDispatchAt.set(ticker, now);
  return now - last < DEV_DISPATCH_DEDUPE_MS;
}

export function useAnalysis(ticker: string): AnalysisState {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<AnalysisState>({
    status: "idle",
    data: null,
    error: null,
  });
  const currentTickerRef = useRef("");

  useEffect(() => {
    const normalizedTicker = ticker.trim().toUpperCase();
    currentTickerRef.current = normalizedTicker;

    if (!normalizedTicker) {
      setState({ status: "error", data: null, error: "Ticker is required." });
      return;
    }

    let isMounted = true;
    const channelName = `analysis_cache_${normalizedTicker}_${Date.now()}`;
    const channel = supabase.channel(channelName);

    const cleanupChannel = () => {
      void supabase.removeChannel(channel);
    };

    const handleRealtimeReady = (payload: { new: { data?: AnalysisResult } }) => {
      if (!isMounted || currentTickerRef.current !== normalizedTicker) {
        return;
      }

      const row = payload.new as { data?: AnalysisResult };
      setState({ status: "ready", data: row.data ?? null, error: null });
      cleanupChannel();
    };

    const subscribeForCacheUpdate = () => {
      channel
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "analysis_cache",
            filter: `ticker=eq.${normalizedTicker}`,
          },
          handleRealtimeReady,
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "analysis_cache",
            filter: `ticker=eq.${normalizedTicker}`,
          },
          handleRealtimeReady,
        )
        .subscribe();
    };

    const start = async () => {
      try {
        if (isLikelyDuplicateDevDispatch(normalizedTicker)) {
          setState({ status: "loading", data: null, error: null });
          subscribeForCacheUpdate();
          return;
        }

        const response = await fetch("/api/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: normalizedTicker }),
        });

        if (response.status === 200) {
          const body = (await response.json()) as AnalysisResult;
          if (!isMounted || currentTickerRef.current !== normalizedTicker) {
            return;
          }

          setState({ status: "ready", data: body, error: null });
          cleanupChannel();
          return;
        }

        if (response.status === 202) {
          if (!isMounted || currentTickerRef.current !== normalizedTicker) {
            return;
          }

          setState({ status: "loading", data: null, error: null });
          subscribeForCacheUpdate();

          return;
        }

        const errBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Orchestration failed (${response.status})`);
      } catch (error) {
        if (!isMounted || currentTickerRef.current !== normalizedTicker) {
          return;
        }

        const message = error instanceof Error ? error.message : "Failed to fetch analysis";
        setState({ status: "error", data: null, error: message });
        cleanupChannel();
      }
    };

    void start();

    return () => {
      isMounted = false;
      cleanupChannel();
    };
  }, [supabase, ticker]);

  return state;
}
