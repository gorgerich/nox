"use client";

import { useCallback, useState } from "react";
import {
  UI_SCALE_LABELS,
  UI_SCALE_LEVELS,
  type UiScaleLevel,
} from "@/lib/ui-scale";

/**
 * The interface-size control: a small A, seven stops, a large A.
 *
 * Built on a real `<input type="range">` rather than a div with pointer
 * handlers. That one decision buys the whole accessibility surface for free —
 * arrow keys, Home/End, the announced value, VoiceOver's rotor, and the
 * platform's own touch behaviour on iPhone, including dragging from anywhere
 * on the track and tapping to jump. What is custom here is only the paint: the
 * native track and thumb are hidden and replaced, because the system control
 * cannot show discrete tick marks the way the iOS text-size slider does.
 *
 * The two A glyphs are not decoration — they are the only thing that says what
 * direction the slider runs, so they carry the same weight change the setting
 * itself applies. They are marked `aria-hidden` because the input's own label
 * already says it in words.
 */
export function UiScaleSlider({
  value,
  onChange,
}: {
  value: UiScaleLevel;
  onChange: (level: UiScaleLevel) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(event.target.value);
      if (next >= 1 && next <= 7) onChange(next as UiScaleLevel);
    },
    [onChange],
  );

  // Where the thumb sits, 0-1 across the track.
  const progress = (value - 1) / (UI_SCALE_LEVELS.length - 1);

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-surface px-4 py-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="w-5 shrink-0 text-center text-[0.8125rem] font-semibold leading-none text-muted"
        >
          A
        </span>

        <div className="relative flex-1">
          {/* Track and ticks. Purely visual — every interaction lands on the
              input stacked above it, which covers the same box. */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
            <div className="relative h-1 rounded-full bg-foreground/12">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{
                  width: `${progress * 100}%`,
                  // No transition while a finger is down: the fill has to be
                  // where the thumb is, not easing towards it.
                  transition: dragging ? "none" : "width 140ms ease-out",
                }}
              />
              <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-[2px]">
                {UI_SCALE_LEVELS.map((level) => (
                  <span
                    key={level}
                    className={`h-2.5 w-[2px] rounded-full ${
                      level <= value ? "bg-primary/70" : "bg-foreground/20"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <input
            type="range"
            min={1}
            max={7}
            step={1}
            value={value}
            onChange={handleChange}
            onPointerDown={() => setDragging(true)}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            onBlur={() => setDragging(false)}
            aria-label="Размер интерфейса"
            aria-valuetext={UI_SCALE_LABELS[value]}
            // A 44px-tall transparent control over a 4px track: the hit area is
            // the whole strip, which is what makes it usable with a thumb.
            className="ui-scale-range relative h-11 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none"
          />

          {/* The thumb, after the input so the focus ring can select it. Also
              non-interactive: it follows the input's value, it does not set
              it. */}
          <div
            className="ui-scale-thumb pointer-events-none absolute top-1/2 h-7 w-7 rounded-full border border-black/5 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22),0_3px_8px_rgba(0,0,0,0.12)] dark:border-white/10"
            style={{
              left: `calc(${progress * 100}% - ${progress * 1.75}rem)`,
              transform: `translateY(-50%) scale(${dragging ? 1.08 : 1})`,
              transition: dragging
                ? "transform 120ms ease-out"
                : "left 140ms ease-out, transform 120ms ease-out",
            }}
          />
        </div>

        <span
          aria-hidden="true"
          className="w-5 shrink-0 text-center text-[1.375rem] font-semibold leading-none text-foreground"
        >
          A
        </span>
      </div>

      <p className="text-center text-[0.8125rem] font-medium text-muted tabular-nums">
        {UI_SCALE_LABELS[value]}
      </p>
    </div>
  );
}
