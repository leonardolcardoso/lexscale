import { useCallback } from "react";
import { useLocation } from "wouter";

export function useBackNavigation(fallbackPath = "/") {
  const [, navigate] = useLocation();

  return useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }

    navigate(fallbackPath, { replace: true });
  }, [fallbackPath, navigate]);
}
