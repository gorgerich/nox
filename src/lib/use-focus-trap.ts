"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Keeps keyboard focus inside an open dialog, and hides everything else from
 * assistive technology while it is open.
 *
 * Without this, a dialog is only visually on top. The page underneath is still
 * in the document, so Tab walks straight out of the dialog into controls the
 * user cannot see, and a screen reader keeps reading a page that is, as far as
 * the user is concerned, closed.
 *
 * Four behaviours, which together are what "modal" actually means:
 *
 *   1. focus moves into the dialog when it opens;
 *   2. Tab and Shift+Tab cycle within it instead of escaping;
 *   3. Escape closes it;
 *   4. focus returns to whatever opened it, not to the top of the document.
 *
 * Plus `inert` on every branch of the tree that is not the dialog, which is the
 * platform's own way of saying "this part is not there right now" — it removes
 * those elements from the tab order, from pointer events and from the
 * accessibility tree in one attribute.
 */
export function useFocusTrap<T extends HTMLElement>(
  isOpen: boolean,
  onClose?: () => void,
): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  // Read through a ref so a caller that recreates the callback on every render
  // does not tear the trap down and rebuild it mid-interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const opener = document.activeElement as HTMLElement | null;

    // Walk from the dialog up to <body>, marking every sibling along the way.
    // This works whether the dialog is portalled to the body or rendered inline,
    // because the path from the dialog to the root is exactly what must stay
    // reachable.
    const madeInert: HTMLElement[] = [];
    let node: HTMLElement | null = container;
    while (node && node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children) as Element[]) {
        if (sibling === node) continue;
        if (!(sibling instanceof HTMLElement)) continue;
        if (sibling.inert) continue; // already inert for another reason; leave it alone
        sibling.inert = true;
        madeInert.push(sibling);
      }
      node = parent;
    }

    const focusableIn = (root: HTMLElement) =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
        // A control inside a collapsed section is in the DOM but not reachable;
        // offsetParent is null for anything display:none or inside it.
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!onCloseRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      // Queried on every Tab rather than once: dialog content changes while it
      // is open, and a stale list traps focus on elements that are gone.
      const focusable = focusableIn(container);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!container.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    // A frame late, so content that mounts with the dialog is present and the
    // first focusable element is the real one.
    const focusTimer = window.setTimeout(() => {
      const container = containerRef.current;
      if (!container || container.contains(document.activeElement)) return;
      const focusable = focusableIn(container);
      (focusable[0] ?? container).focus();
    }, 50);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
      for (const element of madeInert) element.inert = false;
      // Back to the control that opened this, so the user resumes where they
      // were rather than at the top of the document.
      opener?.focus?.();
    };
  }, [isOpen]);

  return containerRef;
}
