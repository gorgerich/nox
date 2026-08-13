"use client";

import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

/**
 * Portals mounted on document.body sit outside the chat root, so they inherit
 * nothing from it — a context menu or sheet would fall back to the app palette
 * and could appear light on a dark chat.
 *
 * This re-applies the chat's variables and effective scheme on the portal
 * wrapper, so anything rendered inside resolves the same tokens as the chat
 * itself. One wrapper for all of them, rather than repainting each portal.
 *
 * `data-theme` is the one that does the work. The inline variables cover the
 * two dozen semantic tokens the chat re-points by hand, but the glass family —
 * `--glass-material` and its relatives, which every frosted surface paints
 * from — is declared only under `:root, [data-theme="light"]` and
 * `[data-theme="dark"]`. Without the attribute those kept the app's values, so
 * a chat that had switched to the light scheme still drew a dark composer, a
 * dark action menu and a dark emoji panel over its light history.
 */
export function ChatThemePortal({
  themeVars,
  scheme,
  children,
  className,
}: {
  themeVars: CSSProperties;
  scheme: "light" | "dark";
  children: ReactNode;
  className?: string;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div data-theme={scheme} data-chat-scheme={scheme} style={themeVars} className={className}>
      {children}
    </div>,
    document.body,
  );
}
