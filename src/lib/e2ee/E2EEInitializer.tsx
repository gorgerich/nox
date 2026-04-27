"use client";

import { useEffect } from "react";
import { ensureKeys, uploadPublicKeys } from "./keys";

/**
 * Client-side component that ensures E2EE keys are generated and registered.
 */
export function E2EEInitializer() {
  useEffect(() => {
    async function init() {
      try {
        const publicJwk = await ensureKeys();
        // Periodically or once per session ensure server has the key
        await uploadPublicKeys(publicJwk);
      } catch (error) {
        console.error("[e2ee] Initialization failed:", error);
      }
    }

    init();
  }, []);

  return null;
}
