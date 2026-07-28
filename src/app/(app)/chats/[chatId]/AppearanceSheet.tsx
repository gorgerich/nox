"use client";

/**
 * The conversation's appearance, as a finished screen rather than a control
 * panel.
 *
 * Three things drive the structure:
 *
 *  - **A live preview, from the real components.** The preview renders actual
 *    message bubbles through the actual `resolveChatScheme` and the actual
 *    appearance variables. A hand-drawn mock would be free to disagree with the
 *    conversation, and eventually would.
 *
 *  - **A draft.** Editing works on a copy. The conversation behind the sheet is
 *    not repainted on every slider movement, storage is not written on every
 *    keystroke, and "Готово" commits once. Closing with unsaved changes asks.
 *
 *  - **Two schemes at once.** The sheet's own chrome follows the *app* scheme;
 *    the preview follows the *draft chat* scheme. Picking a dark chat theme in a
 *    light app must darken the preview, not the sheet.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  CHAT_WALLPAPERS,
  DEFAULT_APPEARANCE,
  PRESETS,
  getChatAppearanceVars,
  resolveChatScheme,
  type AppearanceSettings,
  type ChatPresetKey,
  type ChatWallpaperKey,
  type ColorScheme,
} from "./ChatAppearance";

const PRESET_LABELS: Record<ChatPresetKey, { title: string; hint?: string }> = {
  system: { title: "Системная", hint: "Следует оформлению приложения" },
  milk: { title: "Молоко" },
  ice: { title: "Лёд" },
  ocean: { title: "Океан" },
  emerald: { title: "Изумруд" },
  graphite: { title: "Графит" },
  midnight: { title: "Полночь" },
};

const INCOMING_LABELS: { value: AppearanceSettings["incomingStyle"]; label: string }[] = [
  { value: "filled", label: "Заливка" },
  { value: "glass", label: "Стекло" },
  // "Минимал" said nothing about what it does. This is the same option, named.
  { value: "minimal", label: "Без заливки" },
];

const RADIUS_LABELS: { value: AppearanceSettings["bubbleRadius"]; label: string }[] = [
  { value: "soft", label: "Мягкие" },
  { value: "round", label: "Круглые" },
];

/**
 * `outgoingColor` is stored as a hex value and mapped to a token set inside
 * ChatAppearance. These are the values that map to a real token — offering a
 * colour with no token behind it would show a swatch that changes nothing.
 */
const OUTGOING_COLORS: { value: string; label: string }[] = [
  { value: "#3f3f46", label: "Графит" },
  { value: "#3b82f6", label: "Синий" },
  { value: "#8b5cf6", label: "Фиолетовый" },
  { value: "#0ea5e9", label: "Голубой" },
  { value: "#10b981", label: "Зелёный" },
  { value: "#f97316", label: "Оранжевый" },
];

function sameSettings(a: AppearanceSettings, b: AppearanceSettings): boolean {
  return (Object.keys(a) as (keyof AppearanceSettings)[]).every((key) => a[key] === b[key]);
}

// --- small building blocks ---------------------------------------------------

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="appearance-section">
      <div className="appearance-section-head">
        <h3 className="appearance-section-title">{title}</h3>
        {hint ? <p className="appearance-section-hint">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="appearance-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`appearance-segment ${value === option.value ? "is-selected" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The preview. Deliberately built from the same tokens the conversation uses:
 * the bubbles read `--bubble-*`, the wallpaper reads the same variables, and the
 * scheme comes from `resolveChatScheme` — so if the two ever diverge, it is a
 * bug in one place rather than a difference between a mock and reality.
 */
function LivePreview({ draft, appScheme }: { draft: AppearanceSettings; appScheme: ColorScheme }) {
  const scheme = resolveChatScheme(draft, appScheme);
  const vars = getChatAppearanceVars(draft, appScheme) as React.CSSProperties;

  return (
    <div
      className="appearance-preview"
      data-chat-scheme={scheme}
      // Radius and incoming style are component-level settings in the real
      // conversation, not variables, so the preview reads them the same way.
      data-radius={draft.bubbleRadius}
      data-incoming={draft.incomingStyle}
      style={vars}
      aria-label="Предпросмотр оформления"
    >
      <div className="appearance-preview-surface">
        <div className="appearance-preview-row appearance-preview-row-in">
          <div className="appearance-preview-bubble appearance-preview-bubble-in">
            <span className="appearance-preview-sender">Ангелина</span>
            <span className="appearance-preview-text">Уже вышла, буду через десять минут</span>
            <span className="appearance-preview-meta">12:41</span>
          </div>
        </div>

        <div className="appearance-preview-row appearance-preview-row-out">
          <div className="appearance-preview-bubble appearance-preview-bubble-out">
            <span className="appearance-preview-reply">
              <span className="appearance-preview-reply-name">Ангелина</span>
              <span className="appearance-preview-reply-text">Уже вышла…</span>
            </span>
            <span className="appearance-preview-text">Отлично, ждём</span>
            <span className="appearance-preview-meta">
              12:42
              <Check className="appearance-preview-tick" aria-hidden="true" />
            </span>
          </div>
        </div>

        <div className="appearance-preview-row appearance-preview-row-out">
          <div className="appearance-preview-bubble appearance-preview-bubble-out appearance-preview-bubble-media">
            <span className="appearance-preview-media" aria-hidden="true" />
            <span className="appearance-preview-meta appearance-preview-meta-onmedia">12:43</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- the sheet ---------------------------------------------------------------

type SheetProps = {
  isOpen: boolean;
  onClose: () => void;
  settings: AppearanceSettings;
  onUpdate: (settings: Partial<AppearanceSettings>, isGlobal?: boolean) => void;
  onReset: () => void;
  appScheme: ColorScheme;
};

/**
 * Mounts the sheet only while it is open, so each opening starts from the saved
 * settings. Seeding the draft from an effect instead would mean a render with
 * stale values followed by a second render — and a synchronous setState in an
 * effect, which is the cascade React warns about.
 */
export function AppearanceSheet(props: SheetProps) {
  if (!props.isOpen) return null;
  return <AppearanceSheetContent {...props} />;
}

function AppearanceSheetContent({
  isOpen,
  onClose,
  settings,
  onUpdate,
  onReset,
  appScheme,
}: SheetProps) {
  // The draft is keyed by the open/close cycle rather than seeded in an effect:
  // remounting on open gives a fresh copy of the saved settings without a
  // synchronous setState during render, and without re-seeding mid-edit.
  const [draft, setDraft] = useState<AppearanceSettings>(settings);
  const [confirmingExit, setConfirmingExit] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const titleId = useId();

  const dirty = useMemo(() => !sameSettings(draft, settings), [draft, settings]);
  const customised = useMemo(() => !sameSettings(draft, DEFAULT_APPEARANCE), [draft]);

  /** The dock is an app surface; it has no business showing through a modal. */
  useEffect(() => {
    if (!isOpen) return;
    window.dispatchEvent(new CustomEvent("nox:dock-visibility", { detail: { hidden: true } }));
    return () => {
      window.dispatchEvent(new CustomEvent("nox:dock-visibility", { detail: { hidden: false } }));
    };
  }, [isOpen]);

  /**
   * Background scroll is locked while the sheet is open.
   *
   * Via an attribute and a stylesheet rule rather than an inline style: the
   * conversation writes to `document.body.style.overflow` too, and whichever
   * effect ran last was winning. An attribute is nobody else's to clear.
   */
  useEffect(() => {
    if (!isOpen) return;
    document.body.dataset.modalOpen = "1";
    return () => {
      delete document.body.dataset.modalOpen;
    };
  }, [isOpen]);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmingExit(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  /** Escape closes; Tab is trapped inside the sheet. */
  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;

      const sheet = sheetRef.current;
      if (!sheet) return;
      const focusable = sheet.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => {
      sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
    }, 60);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
      // Focus goes back where it came from, not to the top of the document.
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [isOpen, requestClose]);

  // Swipe down to dismiss, on the header only, so scrolling the body cannot
  // close the sheet by accident.
  const dragStart = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const onDragStart = (event: React.PointerEvent) => {
    dragStart.current = event.clientY;
  };
  const onDragMove = (event: React.PointerEvent) => {
    if (dragStart.current === null) return;
    setDragOffset(Math.max(0, event.clientY - dragStart.current));
  };
  const onDragEnd = () => {
    if (dragOffset > 120) requestClose();
    dragStart.current = null;
    setDragOffset(0);
  };

  const apply = (patch: Partial<AppearanceSettings>) => setDraft((current) => ({ ...current, ...patch }));

  if (!isOpen || typeof document === "undefined") return null;

  const body = (
    <div
      className="appearance-root"
      // The chrome follows the app, never the chat: a dark chat theme must not
      // drag the sheet into dark with it.
      data-theme={appScheme}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button type="button" className="appearance-backdrop" aria-label="Закрыть" onClick={requestClose} />

      <div
        ref={sheetRef}
        className="appearance-sheet"
        style={dragOffset ? { transform: `translateY(${dragOffset}px)` } : undefined}
      >
        <header
          className="appearance-header"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <span className="appearance-grabber" aria-hidden="true" />
          <div className="appearance-header-row">
            <button type="button" className="appearance-header-action" onClick={requestClose}>
              <X className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">Закрыть</span>
            </button>
            <h2 id={titleId} className="appearance-title">
              Оформление
            </h2>
            <button
              type="button"
              className="appearance-header-action appearance-header-text"
              onClick={() => setDraft(DEFAULT_APPEARANCE)}
              disabled={!customised}
            >
              Сбросить
            </button>
          </div>
        </header>

        <div className="appearance-body">
          <LivePreview draft={draft} appScheme={appScheme} />

          <Section title="Тема" hint="Основа оформления диалога">
            <div className="appearance-cards" role="radiogroup" aria-label="Тема">
              {(Object.keys(PRESETS) as ChatPresetKey[]).map((key) => {
                const meta = PRESET_LABELS[key] ?? { title: key };
                const selected = draft.preset === key;
                const cardVars = getChatAppearanceVars({ ...draft, preset: key }, appScheme) as React.CSSProperties;
                const cardScheme = resolveChatScheme({ ...draft, preset: key }, appScheme);
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={meta.hint ? `${meta.title}. ${meta.hint}` : meta.title}
                    className={`appearance-card ${selected ? "is-selected" : ""}`}
                    onClick={() => apply({ preset: key })}
                  >
                    <span className="appearance-card-preview" data-chat-scheme={cardScheme} style={cardVars}>
                      <span className="appearance-card-bubble-in" />
                      <span className="appearance-card-bubble-out" />
                    </span>
                    <span className="appearance-card-title">{meta.title}</span>
                    {meta.hint ? <span className="appearance-card-hint">{meta.hint}</span> : null}
                    {selected ? <Check className="appearance-card-check" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Обои" hint="Можно оставить тему и сменить только фон">
            <div className="appearance-cards" role="radiogroup" aria-label="Обои">
              {CHAT_WALLPAPERS.map((wallpaper) => {
                const selected = draft.wallpaper === wallpaper.id;
                const cardVars = getChatAppearanceVars(
                  { ...draft, wallpaper: wallpaper.id as ChatWallpaperKey },
                  appScheme,
                ) as React.CSSProperties;
                return (
                  <button
                    key={wallpaper.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={wallpaper.label}
                    className={`appearance-card ${selected ? "is-selected" : ""}`}
                    onClick={() => apply({ wallpaper: wallpaper.id as ChatWallpaperKey })}
                  >
                    <span className="appearance-card-preview appearance-card-wallpaper" style={cardVars} />
                    <span className="appearance-card-title">{wallpaper.label}</span>
                    {selected ? <Check className="appearance-card-check" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Цвет исходящих">
            <div className="appearance-swatches" role="radiogroup" aria-label="Цвет исходящих сообщений">
              {OUTGOING_COLORS.map((color) => {
                const selected = draft.outgoingColor.toLowerCase() === color.value;
                return (
                  <button
                    key={color.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={color.label}
                    className={`appearance-swatch ${selected ? "is-selected" : ""}`}
                    style={{ background: color.value }}
                    onClick={() => apply({ outgoingColor: color.value })}
                  >
                    {selected ? <Check className="appearance-swatch-check" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Входящие сообщения">
            <Segmented
              value={draft.incomingStyle}
              options={INCOMING_LABELS}
              onChange={(value) => apply({ incomingStyle: value })}
              label="Стиль входящих сообщений"
            />
          </Section>

          <Section title="Форма сообщений">
            <Segmented
              value={draft.bubbleRadius}
              options={RADIUS_LABELS}
              onChange={(value) => apply({ bubbleRadius: value })}
              label="Форма сообщений"
            />
          </Section>

          {draft.wallpaper !== "none" ? (
            <Section title="Затемнение обоев" hint="Чем выше, тем спокойнее фон под текстом">
              <input
                type="range"
                className="appearance-range"
                min={8}
                max={70}
                step={1}
                value={draft.wallpaperIntensity}
                aria-label="Затемнение обоев"
                onChange={(event) => apply({ wallpaperIntensity: Number(event.target.value) })}
              />
            </Section>
          ) : null}
        </div>

        <footer className="appearance-footer">
          <button
            type="button"
            className="appearance-primary"
            disabled={!dirty}
            onClick={() => {
              onUpdate(draft);
              onClose();
            }}
          >
            Готово
          </button>
        </footer>

        {confirmingExit ? (
          <div className="appearance-confirm" role="alertdialog" aria-label="Несохранённые изменения">
            <div className="appearance-confirm-card">
              <p className="appearance-confirm-title">Сохранить оформление?</p>
              <p className="appearance-confirm-text">Изменения ещё не применены к диалогу.</p>
              <div className="appearance-confirm-actions">
                <button
                  type="button"
                  className="appearance-secondary"
                  onClick={() => {
                    setConfirmingExit(false);
                    onClose();
                  }}
                >
                  Выйти без изменений
                </button>
                <button
                  type="button"
                  className="appearance-primary"
                  onClick={() => {
                    onUpdate(draft);
                    setConfirmingExit(false);
                    onClose();
                  }}
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  void onReset;
  return createPortal(body, document.body);
}
