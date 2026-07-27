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
    <div data-chat-scheme={scheme} style={themeVars} className={className}>
      {children}
    </div>,
    document.body,
  );
}
