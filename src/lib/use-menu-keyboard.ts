"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Keyboard behaviour for a menu opened from a button.
 *
 * Claiming `role="menu"` is a promise. A screen reader announces "menu" and
 * the user then expects the menu keys — arrows to move through the items,
 * Home and End to jump, Escape to leave. A popup that only responds to a
 * click announces itself as something it is not, which is worse than having
 * no role at all: the user is told a set of keys will work, tries them, and
 * nothing happens.
 *
 * What this implements, from the ARIA authoring practices for a menu button:
 *
 *   - focus lands on the first item when the menu opens;
 *   - ArrowDown / ArrowUp move between items and wrap around;
 *   - Home / End jump to the first and last item;
 *   - Escape closes and returns focus to the button that opened it;
 *   - Tab closes as well, rather than walking through items one at a time.
 *
 * Items are found by their menu-item roles and carry `tabindex="-1"`, so the menu
 * is one stop in the page's tab order and the arrows do the moving inside it.
 * That is the roving-tabindex pattern, and it is why Tab closes: within a
 * composite widget, Tab means "I am done here".
 */
export function useMenuKeyboard<T extends HTMLElement>(
  isOpen: boolean,
  onClose: () => void,
  triggerRef?: RefObject<HTMLElement | null>,
): RefObject<T | null> {
  const menuRef = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const menu = menuRef.current;
    if (!menu) return;

    // Re-queried on every keystroke rather than captured once: a menu whose
    // items depend on props can change while it is open, and a stale list
    // moves focus to an element that is no longer there.
    const itemsNow = () =>
      Array.from(
        // Radio and checkbox items are menu items too — a menu that only moved
        // between the plain ones would skip half of itself.
        menu.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
        ),
      ).filter((item) => !item.hasAttribute("disabled"));

    const focusAt = (index: number) => {
      const items = itemsNow();
      if (items.length === 0) return;
      const wrapped = ((index % items.length) + items.length) % items.length;
      items[wrapped].focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const items = itemsNow();
      const current = items.indexOf(document.activeElement as HTMLElement);

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          onCloseRef.current();
          triggerRef?.current?.focus();
          return;
        case "Tab":
          // Not prevented: the menu closes and focus continues on its way.
          onCloseRef.current();
          return;
        case "ArrowDown":
          event.preventDefault();
          focusAt(current < 0 ? 0 : current + 1);
          return;
        case "ArrowUp":
          event.preventDefault();
          focusAt(current < 0 ? -1 : current - 1);
          return;
        case "Home":
          event.preventDefault();
          focusAt(0);
          return;
        case "End":
          event.preventDefault();
          focusAt(items.length - 1);
          return;
        default:
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // A frame late, so items rendered with the menu are present to receive it.
    const timer = window.setTimeout(() => focusAt(0), 30);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [isOpen, triggerRef]);

  return menuRef;
}
