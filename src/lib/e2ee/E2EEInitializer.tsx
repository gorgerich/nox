"use client";

import { useEffect } from "react";
import { registerCurrentDevice } from "./keys";

/**
 * Client-side component that ensures this browser/device has its own E2EE key bundle.
 */
export function E2EEInitializer() {
  useEffect(() => {
    async function init() {
      try {
        await registerCurrentDevice();
      } catch (error) {
        console.error("[e2ee] Device registration failed:", error);
      }
    }

    init();
  }, []);

  return null;
}
