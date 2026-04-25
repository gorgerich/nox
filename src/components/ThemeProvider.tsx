"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

type ThemePreference = "dark" | "light" | "system";
type EffectiveTheme = "dark" | "light";

interface ThemeContextType {
  theme: ThemePreference;
  effectiveTheme: EffectiveTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem("nox:theme") as ThemePreference) || "system";
  });
  
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>("dark");

  const applyTheme = useCallback((pref: ThemePreference) => {
    const root = document.documentElement;
    let targetTheme: EffectiveTheme = "dark";

    if (pref === "system") {
      targetTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } else {
      targetTheme = pref;
    }

    root.dataset.theme = targetTheme;
    root.classList.toggle("dark", targetTheme === "dark");
    
    // We update state inside an effect usually, but applyTheme is called from effect.
    // To avoid cascading, we can use a ref or just ignore if it's necessary.
    // Better: update effectiveTheme in the same effect.
    return targetTheme;
  }, []);

  useEffect(() => {
    const target = applyTheme(theme);
    // Use a small timeout to avoid cascading render warning in some environments
    const timeoutId = setTimeout(() => setEffectiveTheme(target), 0);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentTheme = localStorage.getItem("nox:theme") as ThemePreference | null;
      if (!currentTheme || currentTheme === "system") {
        const t = applyTheme("system");
        setEffectiveTheme(t);
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => {
      clearTimeout(timeoutId);
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [applyTheme, theme]);

  const setTheme = (newTheme: ThemePreference) => {
    setThemeState(newTheme);
    localStorage.setItem("nox:theme", newTheme);
    applyTheme(newTheme);
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
