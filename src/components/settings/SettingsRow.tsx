"use client";

import type { ReactNode } from "react";

/**
 * The row primitives every settings screen is built from.
 *
 * One height, one padding, one type scale, one chevron. Previously each screen
 * invented its own row, which is why the same idea — "a thing you tap to open
 * a sub-screen" — looked different in three places.
 *
 * Title is the only text that reads first: `text-[17px]` at regular weight.
 * Everything else (subtitle, value, footnote) is `text-[13px]`/`text-[15px]`
 * in muted, so hierarchy is carried by contrast rather than by weight
 * escalation.
 */

const ROW = "flex w-full items-center gap-3 px-4 py-3 text-left min-h-[52px]";
const TITLE = "truncate text-[17px] text-foreground";
const SUBTITLE = "mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted";
const VALUE = "shrink-0 text-[15px] text-muted";

function Chevron() {
  return (
    <svg
      className="h-[18px] w-[18px] shrink-0 text-muted/45"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** Tap to open a sub-screen. Optional right-hand value, always secondary. */
export function SettingsNavRow({
  title,
  subtitle,
  value,
  icon,
  onClick,
  disabled,
}: {
  title: string;
  subtitle?: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${ROW} transition-smooth hover:bg-surface-hover active:bg-surface-hover disabled:opacity-45`}
    >
      {icon ? (
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className={`block ${TITLE}`}>{title}</span>
        {subtitle ? <span className={`block ${SUBTITLE}`}>{subtitle}</span> : null}
      </span>
      {value ? <span className={VALUE}>{value}</span> : null}
      <Chevron />
    </button>
  );
}

/** Static information. No affordance, because nothing happens when tapped. */
export function SettingsValueRow({
  title,
  subtitle,
  value,
  icon,
}: {
  title: string;
  subtitle?: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className={ROW}>
      {icon ? (
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className={TITLE}>{title}</p>
        {subtitle ? <p className={SUBTITLE}>{subtitle}</p> : null}
      </div>
      {value ? <span className={VALUE}>{value}</span> : null}
    </div>
  );
}

/**
 * A switch row. The whole row is the label, so the hit target is the row and
 * there is no dead zone between the text and the control.
 */
export function SettingsToggleRow({
  title,
  subtitle,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  subtitle?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`${ROW} ${disabled ? "opacity-45" : "cursor-pointer"}`}>
      <span className="min-w-0 flex-1">
        <span className={`block ${TITLE}`}>{title}</span>
        {subtitle ? <span className={`block ${SUBTITLE}`}>{subtitle}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-[31px] w-[51px] shrink-0 rounded-full bg-surface-tertiary transition-colors duration-200 peer-checked:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
      >
        {/* Driven by the prop, not by `peer-checked`: the knob is a descendant
            of the track rather than a sibling of the input, and the peer
            variant only reaches siblings. */}
        <span
          className={`absolute left-0.5 top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </label>
  );
}

/**
 * A plain action inside a group — accent-coloured text, no button chrome.
 * Used where a full primary button would be one blue rectangle too many.
 */
export function SettingsActionRow({
  title,
  subtitle,
  onClick,
  disabled,
  busy,
  tone = "accent",
}: {
  title: string;
  subtitle?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** `danger` is reserved for actions that destroy something. */
  tone?: "accent" | "danger" | "neutral";
}) {
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "neutral" ? "text-foreground" : "text-primary";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`${ROW} transition-smooth hover:bg-surface-hover active:bg-surface-hover disabled:opacity-40`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[17px] ${toneClass}`}>{busy ? "Подождите…" : title}</span>
        {subtitle ? <span className={`block ${SUBTITLE}`}>{subtitle}</span> : null}
      </span>
    </button>
  );
}

/**
 * A footnote that carries a small warning.
 *
 * Deliberately not a card: a persistent amber panel reads as an active alarm
 * even when nothing is wrong. An icon plus muted amber text says the same
 * thing without shouting it.
 */
export function SettingsNote({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning";
  children: ReactNode;
}) {
  return (
    <span className="flex gap-1.5">
      <svg
        className={`mt-[3px] h-[14px] w-[14px] shrink-0 ${tone === "warning" ? "text-warning" : "text-muted"}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        {tone === "warning" ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        )}
      </svg>
      <span className={tone === "warning" ? "text-warning/85" : undefined}>{children}</span>
    </span>
  );
}

/**
 * An editable field that still reads as a row.
 *
 * The label stays on the left at a fixed width and the value is typed on the
 * right, which is how a phone shows an editable account field. The previous
 * screens stacked a floating label above a full-width bordered input, and that
 * is a web form, not a settings screen.
 */
export function SettingsInputRow({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  maxLength,
  multiline = false,
  prefix,
  hideLabel = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  multiline?: boolean;
  prefix?: string;
  /** For a group whose own label already says the same word. */
  hideLabel?: boolean;
}) {
  const field =
    "min-w-0 flex-1 bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted/60";

  if (multiline) {
    return (
      <div className="px-4 py-3">
        <label htmlFor={id} className={hideLabel ? "sr-only" : "block text-[13px] text-muted"}>
          {label}
        </label>
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={3}
          className={`${field} block w-full resize-none leading-snug ${hideLabel ? "" : "mt-1"}`}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
      <label htmlFor={id} className="w-[104px] shrink-0 text-[17px] text-foreground">
        {label}
      </label>
      {prefix ? <span className="shrink-0 text-[17px] text-muted">{prefix}</span> : null}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        maxLength={maxLength}
        className={`${field} ${prefix ? "-ml-2" : ""}`}
      />
    </div>
  );
}

/**
 * A segmented control — the phone's answer to "pick one of three".
 * Three filled buttons in a row were three primary actions competing; this is
 * one control with one selected state.
 */
export function SettingsSegmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1 rounded-xl bg-surface-tertiary p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-[34px] flex-1 rounded-lg px-2 text-[14px] transition-smooth ${
              selected
                ? "bg-surface text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.14)]"
                : "text-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The one filled accent button a screen is allowed, for its single main action. */
export function SettingsPrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="fast-tap h-12 w-full rounded-full bg-primary text-[17px] font-medium text-primary-foreground transition-smooth disabled:opacity-40"
    >
      {children}
    </button>
  );
}
