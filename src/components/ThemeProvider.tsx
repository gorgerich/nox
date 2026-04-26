"use client";

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

type ThemePreference = "dark" | "light" | "system";
type EffectiveTheme = "dark" | "light";
const THEME_STORAGE_KEY = "nox:theme";

interface ThemeContextType {
  theme: ThemePreference;
  effectiveTheme: EffectiveTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

function resolveEffectiveTheme(preference: ThemePreference): EffectiveTheme {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return preference;
}

function applyRootTheme(preference: ThemePreference) {
  const effectiveTheme = resolveEffectiveTheme(preference);
  const root = document.documentElement;

  root.dataset.theme = effectiveTheme;
  root.dataset.themeMode = preference;
  root.classList.toggle("dark", effectiveTheme === "dark");
  root.classList.remove("light");
  root.style.colorScheme = effectiveTheme;

  return effectiveTheme;
}

function subscribeToSystemTheme(callback: () => void) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", callback);
  return () => {
    mediaQuery.removeEventListener("change", callback);
  };
}

function getSystemThemeSnapshot() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    if (typeof document === "undefined") {
      return "system";
    }

    const rootThemeMode = document.documentElement.dataset.themeMode;
    if (rootThemeMode === "light" || rootThemeMode === "dark" || rootThemeMode === "system") {
      return rootThemeMode;
    }

    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
      ? storedTheme
      : "system";
  });
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemThemeSnapshot,
    () => false,
  );
  const effectiveTheme: EffectiveTheme = theme === "system"
    ? (systemPrefersDark ? "dark" : "light")
    : theme;

  useEffect(() => {
    applyRootTheme(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, effectiveTheme]);

  const setTheme = (newTheme: ThemePreference) => {
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
