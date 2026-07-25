/**
 * Guards against a split chat theme: a dark history with a light composer, or
 * a white notice card floating on a dark background.
 *
 *   npm run validate:chat-theme-consistency
 *
 * The invariant is that one effective scheme governs the whole chat subtree.
 * Components that legitimately use the *app* palette (composer, notices,
 * service pills) must be re-pointed at the chat's surfaces when the chat runs
 * its own preset, and must be left alone when the chat follows the app.
 */
import {
  DEFAULT_APPEARANCE,
  getChatAppearanceVars,
  resolveChatScheme,
  type AppearanceSettings,
  type ColorScheme,
} from "../src/app/(app)/chats/[chatId]/ChatAppearance";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}${detail ? " :: " + detail : ""}`);
  }
}

const withPreset = (preset: AppearanceSettings["preset"]): AppearanceSettings => ({ ...DEFAULT_APPEARANCE, preset });

// --- "system" follows the app ------------------------------------------------
for (const appScheme of ["light", "dark"] as ColorScheme[]) {
  check(
    `system preset follows the app (${appScheme})`,
    resolveChatScheme(withPreset("system"), appScheme) === appScheme,
  );
}

// A chat that follows the app must not override the app palette — doing so
// would be circular, since the system preset's values *are* the app tokens.
for (const appScheme of ["light", "dark"] as ColorScheme[]) {
  const vars = getChatAppearanceVars(withPreset("system"), appScheme);
  check(
    `system preset leaves the app palette untouched (${appScheme})`,
    vars["--background"] === undefined && vars["--navigation-background"] === undefined,
  );
  check(`system preset publishes color-scheme (${appScheme})`, vars["color-scheme"] === appScheme);
}

// --- an explicit preset governs the whole subtree ----------------------------
const DARK_PRESETS: AppearanceSettings["preset"][] = ["midnight", "graphite", "ocean"];
const LIGHT_PRESETS: AppearanceSettings["preset"][] = ["ice", "milk"];

for (const preset of DARK_PRESETS) {
  for (const appScheme of ["light", "dark"] as ColorScheme[]) {
    check(`${preset} stays dark under a ${appScheme} app`, resolveChatScheme(withPreset(preset), appScheme) === "dark");
  }
  const vars = getChatAppearanceVars(withPreset(preset), "light");
  // The composer is the component that regressed, so assert it explicitly.
  check(`${preset} re-points the composer surface`, typeof vars["--navigation-background"] === "string" && vars["--navigation-background"] === vars["--chat-composer-bg"]);
  check(`${preset} re-points the notice surface`, typeof vars["--surface-elevated"] === "string");
  check(`${preset} re-points the primary text token`, typeof vars["--text-primary"] === "string");
  check(`${preset} re-points the separator`, typeof vars["--separator"] === "string");
  check(`${preset} publishes color-scheme dark`, vars["color-scheme"] === "dark");
}

for (const preset of LIGHT_PRESETS) {
  for (const appScheme of ["light", "dark"] as ColorScheme[]) {
    check(`${preset} stays light under a ${appScheme} app`, resolveChatScheme(withPreset(preset), appScheme) === "light");
  }
  const vars = getChatAppearanceVars(withPreset(preset), "dark");
  check(`${preset} re-points the composer surface under a dark app`, vars["--navigation-background"] === vars["--chat-composer-bg"]);
  check(`${preset} publishes color-scheme light`, vars["color-scheme"] === "light");
}

// --- every app token the chat subtree relies on must be covered -------------
const REQUIRED = [
  "--background",
  "--surface",
  "--surface-elevated",
  "--background-elevated",
  "--surface-muted",
  "--foreground",
  "--text-primary",
  "--muted",
  "--text-secondary",
  "--border-subtle",
  "--separator",
  "--navigation-background",
  "--navigation-background-fallback",
  "--input-background",
  "--placeholder",
  "--surface-pressed",
];
const midnight = getChatAppearanceVars(withPreset("midnight"), "light");
for (const token of REQUIRED) {
  check(`midnight overrides ${token}`, typeof midnight[token] === "string" && midnight[token].length > 0);
}

// --- a wallpaper is a scheme decision too ------------------------------------
// This is the reported defect: system preset + dark wallpaper under a light app
// darkened the history while the composer stayed light.
const darkWallpaper: AppearanceSettings = { ...DEFAULT_APPEARANCE, preset: "system", wallpaper: "orbit-night" };
check("dark wallpaper darkens the whole chat under a light app", resolveChatScheme(darkWallpaper, "light") === "dark");
const dwVars = getChatAppearanceVars(darkWallpaper, "light");
check("dark wallpaper re-points the composer surface", typeof dwVars["--navigation-background"] === "string");
check("dark wallpaper re-points the notice surface", typeof dwVars["--surface-elevated"] === "string");
check("dark wallpaper publishes color-scheme dark", dwVars["color-scheme"] === "dark");

const lightWallpaper: AppearanceSettings = { ...DEFAULT_APPEARANCE, preset: "system", wallpaper: "botanical-light" };
check("light wallpaper lightens the whole chat under a dark app", resolveChatScheme(lightWallpaper, "dark") === "light");
check(
  "light wallpaper re-points the composer surface under a dark app",
  typeof getChatAppearanceVars(lightWallpaper, "dark")["--navigation-background"] === "string",
);

const noWallpaper: AppearanceSettings = { ...DEFAULT_APPEARANCE, preset: "system", wallpaper: "none" };
for (const appScheme of ["light", "dark"] as ColorScheme[]) {
  check(`no wallpaper still follows the app (${appScheme})`, resolveChatScheme(noWallpaper, appScheme) === appScheme);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll chat-theme-consistency checks passed.");
