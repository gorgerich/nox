/**
 * Global interface scale.
 *
 * The whole feature rests on one decision: `rem`. The root element's font size
 * is the multiplier, and every size expressed in `rem` follows it — which in
 * this codebase is nearly everything, because Tailwind's own scale is `rem`
 * based. `text-sm`, `h-11`, `w-6`, `gap-3`, `px-4` all move together, so type,
 * icons, avatars, control heights and the spacing around them stay in
 * proportion instead of drifting apart at the extremes.
 *
 * Not `transform: scale()`, and not `zoom`. Both would take the viewport with
 * them: fixed chrome, the keyboard inset, and `env(safe-area-inset-*)` are all
 * measured in real device pixels, and scaling the root would put the composer
 * behind the keyboard and the dock under the home indicator. Those stay in
 * `px` here precisely so this setting cannot reach them.
 *
 * Media queries are unaffected too — `rem` inside `@media` resolves against the
 * browser's initial font size, never the root's — so breakpoints do not shift
 * as the user drags the slider.
 */

export const UI_SCALE_STORAGE_KEY = "nox:ui-scale";

export type UiScaleLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const UI_SCALE_DEFAULT: UiScaleLevel = 4;

/**
 * Seven stops, calibrated on a 320px iPhone SE rather than picked off a curve.
 *
 * The top end stops at 1.16 because past that the chat header's title and its
 * two call buttons stop fitting on the narrowest phone; the bottom stops at
 * 0.86 because below it the 11px timestamps fall under the size where they can
 * still be read at arm's length. Steps are deliberately uneven: the ones near
 * the default are small enough to be a fine adjustment, the outer ones larger
 * because someone reaching for them wants a real change.
 */
export const UI_SCALE_STEPS: Record<UiScaleLevel, number> = {
  1: 0.86,
  2: 0.91,
  3: 0.955,
  4: 1,
  5: 1.06,
  6: 1.11,
  7: 1.16,
};

export const UI_SCALE_LABELS: Record<UiScaleLevel, string> = {
  1: "Очень мелкий",
  2: "Мелкий",
  3: "Компактный",
  4: "Стандартный",
  5: "Крупный",
  6: "Очень крупный",
  7: "Максимальный",
};

export const UI_SCALE_LEVELS: UiScaleLevel[] = [1, 2, 3, 4, 5, 6, 7];

export function isUiScaleLevel(value: unknown): value is UiScaleLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}

/** Parses whatever is in storage, falling back to the default for anything else. */
export function parseUiScaleLevel(raw: string | null | undefined): UiScaleLevel {
  const parsed = Number(raw);
  return isUiScaleLevel(parsed) ? parsed : UI_SCALE_DEFAULT;
}

export function uiScaleFactor(level: UiScaleLevel): number {
  return UI_SCALE_STEPS[level];
}

/**
 * Writes the scale onto the root element.
 *
 * Two properties, deliberately. `--ui-scale` is the token components can read;
 * `data-ui-scale` carries the level for tests and for styling that needs to
 * know which stop is active rather than by how much. The font size itself is
 * set from `--ui-scale` in CSS, not here, so there is exactly one place that
 * decides what the multiplier means.
 */
export function applyUiScale(level: UiScaleLevel, root: HTMLElement): void {
  root.style.setProperty("--ui-scale", String(uiScaleFactor(level)));
  root.dataset.uiScale = String(level);
}
