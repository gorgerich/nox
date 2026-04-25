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
    setEffectiveTheme(targetTheme);

    // Update meta theme-color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", targetTheme === "dark" ? "#000000" : "#f8fafc");
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentTheme = localStorage.getItem("nox:theme") as ThemePreference | null;
      if (!currentTheme || currentTheme === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
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
