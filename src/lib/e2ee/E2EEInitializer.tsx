"use client";

import { useEffect } from "react";
import { registerCurrentDevice } from "./keys";

/**
 * Client-side component that ensures this browser/device has its own E2EE key bundle.
 */
export function E2EEInitializer({ userId }: { userId: string }) {
  useEffect(() => {
    async function init() {
      try {
        await registerCurrentDevice(userId);
      } catch (error) {
        console.error("[e2ee] Device registration failed:", error);
      }
    }

    init();
  }, [userId]);

  return null;
}
