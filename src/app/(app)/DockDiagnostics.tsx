"use client";

/**
 * A read-only recorder for the dock's geometry on a real device.
 *
 * The dock does not move by so much as a pixel in the harness, across every
 * viewport, both schemes and every route we can drive. The reported jump on a
 * phone therefore comes from something the harness cannot reproduce — most
 * likely the browser's own chrome collapsing and the safe-area inset changing
 * with it — but that is a hypothesis, and this exists so it can be replaced
 * with a measurement.
 *
 * Off unless explicitly asked for with `?dockDiagnostics=1`. When off it adds
 * no listeners and renders nothing: the code path that could influence layout
 * simply does not run.
 *
 * It records geometry only — no message content, no identifiers, no network.
 * Nothing is uploaded; the JSON is copied out by hand.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Sample = {
  at: number;
  event: string;
  innerHeight: number;
  clientHeight: number;
  visualViewportHeight: number | null;
  visualViewportOffsetTop: number | null;
  dockTop: number | null;
  dockBottom: number | null;
  dockHeight: number | null;
  safeAreaBottom: number;
  /** What the screen itself is, against what the page thinks it has. */
  screenHeight: number;
  /** The three viewport units, resolved. They disagree exactly when this bug shows. */
  dvh: number;
  lvh: number;
  svh: number;
  /** The computed offset the dock is actually positioned by. */
  dockBottomOffset: string;
  scrollY: number;
  orientation: string;
  displayMode: string;
};

const DOCK_SELECTOR = 'nav[aria-label="Нижняя навигация"]';

/** Resolves one viewport unit by measuring an element sized in it. */
function measureUnit(unit: "dvh" | "lvh" | "svh"): number {
  if (typeof document === "undefined") return -1;
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;top:0;left:0;width:1px;height:100${unit};pointer-events:none;visibility:hidden`;
  document.body.appendChild(probe);
  const height = Math.round(probe.getBoundingClientRect().height);
  probe.remove();
  return height;
}

function measure(event: string, sentinel: HTMLElement | null): Sample {
  const dock = document.querySelector(DOCK_SELECTOR);
  const rect = dock?.getBoundingClientRect() ?? null;
  return {
    at: Math.round(performance.now()),
    event,
    innerHeight: window.innerHeight,
    clientHeight: document.documentElement.clientHeight,
    visualViewportHeight: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    visualViewportOffsetTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
    dockTop: rect ? Math.round(rect.top * 100) / 100 : null,
    dockBottom: rect ? Math.round(rect.bottom * 100) / 100 : null,
    dockHeight: rect ? Math.round(rect.height * 100) / 100 : null,
    // The sentinel is a zero-size element whose height is the safe-area inset,
    // which is the only way to read the inset as a number.
    safeAreaBottom: sentinel ? Math.round(sentinel.getBoundingClientRect().height) : -1,
    screenHeight: Math.round(window.screen?.height ?? -1),
    // Resolved through a probe rather than assumed: a unit that disagrees with
    // the others is the whole question here.
    dvh: measureUnit("dvh"),
    lvh: measureUnit("lvh"),
    svh: measureUnit("svh"),
    dockBottomOffset: getComputedStyle(document.documentElement)
      .getPropertyValue("--messenger-dock-bottom")
      .trim() || "(unset)",
    scrollY: Math.round(window.scrollY),
    orientation: window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape",
    displayMode: window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser",
  };
}

export function DockDiagnostics() {
  const [enabled, setEnabled] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [copied, setCopied] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Explicit opt-in only, and never on by default in production.
    setEnabled(new URLSearchParams(window.location.search).get("dockDiagnostics") === "1");
  }, []);

  const record = useCallback((event: string) => {
    setSamples((current) => (current.length >= 400 ? current : [...current, measure(event, sentinelRef.current)]));
  }, []);

  useEffect(() => {
    if (!enabled) return;

    record("mounted");
    let frames = 0;
    let frameHandle = requestAnimationFrame(function tick() {
      record(`frame-${frames}`);
      frames += 1;
      if (frames < 12) frameHandle = requestAnimationFrame(tick);
    });

    const onResize = () => record("resize");
    const onScroll = () => record("scroll");
    const onFocus = () => record("focusin");
    const onBlur = () => record("focusout");
    const onPointer = () => record("pointerdown");
    const onViewport = () => record("visualViewport-resize");
    const onViewportScroll = () => record("visualViewport-scroll");
    const onOrientation = () => record("orientationchange");

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("focusin", onFocus);
    window.addEventListener("focusout", onBlur);
    window.addEventListener("pointerdown", onPointer, { passive: true });
    window.addEventListener("orientationchange", onOrientation);
    window.visualViewport?.addEventListener("resize", onViewport);
    window.visualViewport?.addEventListener("scroll", onViewportScroll);

    const settle = window.setTimeout(() => record("settled-3s"), 3_000);

    return () => {
      cancelAnimationFrame(frameHandle);
      window.clearTimeout(settle);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("focusout", onBlur);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("orientationchange", onOrientation);
      window.visualViewport?.removeEventListener("resize", onViewport);
      window.visualViewport?.removeEventListener("scroll", onViewportScroll);
    };
  }, [enabled, record]);

  if (!enabled) return null;

  const payload = JSON.stringify({ userAgent: navigator.userAgent, samples }, null, 2);
  const moved = samples.length > 1 ? Math.max(...samples.map((s) => Math.abs((s.dockBottom ?? 0) - (samples[samples.length - 1].dockBottom ?? 0)))) : 0;

  return (
    <>
      {/* Zero-height, out of flow, purely to measure the inset. */}
      <div
        ref={sentinelRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          left: 0,
          bottom: 0,
          width: 0,
          height: "env(safe-area-inset-bottom, 0px)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "fixed",
          left: 8,
          top: "calc(env(safe-area-inset-top, 0px) + 8px)",
          zIndex: 2000,
          maxWidth: "min(92vw, 420px)",
          maxHeight: "38vh",
          overflow: "auto",
          padding: "8px 10px",
          borderRadius: 12,
          background: "rgba(12, 16, 24, 0.86)",
          color: "#e8edf6",
          font: "500 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
          pointerEvents: "auto",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <strong>dock diagnostics</strong>
          <span>samples {samples.length}</span>
          <span>max Δbottom {Math.round(moved * 100) / 100}px</span>
          <button
            type="button"
            style={{ marginLeft: "auto", textDecoration: "underline" }}
            onClick={() => {
              navigator.clipboard?.writeText(payload).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "copied" : "copy JSON"}
          </button>
        </div>
        {samples.slice(-8).map((sample, index) => (
          <div key={`${sample.at}-${index}`}>
            {sample.event} · h{sample.innerHeight} · vv{sample.visualViewportHeight ?? "—"} · off
            {sample.visualViewportOffsetTop ?? "—"} · dock {sample.dockBottom ?? "—"} · safe {sample.safeAreaBottom}
          </div>
        ))}
      </div>
    </>
  );
}
