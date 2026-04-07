"use client";

import { useEffect, useRef, useState } from "react";
import { fetchUserPricingPreferences, updateUserPricingPreferences } from "@/lib/api";
import type { UserPricingPreferences } from "@/lib/types";

const DEFAULT_PREFERENCES: UserPricingPreferences = {
  preferredDisplayCurrency: "USD",
  showPriceFreshness: true
};

let cachedPreferences: UserPricingPreferences | null = null;

export function useUserPricingPreferences(initial?: Partial<UserPricingPreferences>) {
  const hasInitial =
    initial?.preferredDisplayCurrency === "USD"
    || initial?.preferredDisplayCurrency === "EUR"
    || typeof initial?.showPriceFreshness === "boolean";

  const [preferences, setPreferences] = useState<UserPricingPreferences>({
    ...DEFAULT_PREFERENCES,
    ...cachedPreferences,
    ...initial
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const updateSeqRef = useRef(0);

  useEffect(() => {
    if (cachedPreferences) {
      setPreferences((previous) => ({
        ...previous,
        ...cachedPreferences
      }));
      return;
    }

    if (hasInitial) {
      cachedPreferences = {
        ...DEFAULT_PREFERENCES,
        ...initial
      };
      return;
    }

    let mounted = true;
    setLoading(true);
    fetchUserPricingPreferences()
      .then((next) => {
        if (!mounted) {
          return;
        }
        cachedPreferences = next;
        setPreferences(next);
        setError("");
      })
      .catch((requestError) => {
        if (!mounted) {
          return;
        }
        setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar preferencias.");
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const patchPreferences = async (patch: Partial<UserPricingPreferences>) => {
    const requestId = ++updateSeqRef.current;
    const previous = preferences;
    const next = {
      ...preferences,
      ...patch
    };
    cachedPreferences = next;
    setPreferences(next);
    setError("");
    try {
      const saved = await updateUserPricingPreferences(next);
      if (updateSeqRef.current === requestId) {
        cachedPreferences = saved;
        setPreferences(saved);
      }
    } catch (requestError) {
      if (updateSeqRef.current === requestId) {
        cachedPreferences = previous;
        setPreferences(previous);
        setError(requestError instanceof Error ? requestError.message : "No se pudieron guardar preferencias.");
      }
    }
  };

  return {
    preferences,
    loading,
    error,
    setPreferredDisplayCurrency: async (preferredDisplayCurrency: UserPricingPreferences["preferredDisplayCurrency"]) => {
      await patchPreferences({ preferredDisplayCurrency });
    },
    setShowPriceFreshness: async (showPriceFreshness: boolean) => {
      await patchPreferences({ showPriceFreshness });
    }
  };
}
