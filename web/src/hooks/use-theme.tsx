import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from "react";

export type ThemeChoice = "light" | "dark" | "system";
const STORAGE_KEY = "swipe-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function readChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // storage unavailable (private mode): follow the system
  }
  return "system";
}

const resolve = (choice: ThemeChoice) => (choice === "system" ? (media.matches ? "dark" : "light") : choice);

interface ThemeState {
  choice: ThemeChoice;
  resolved: "light" | "dark";
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content =
    getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(readChoice()));

  useLayoutEffect(() => {
    const apply = () => {
      const next = resolve(choice);
      setResolved(next);
      applyTheme(next);
    };
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      applyTheme("dark"); // The sign-in screen owns the document again on sign-out.
    };
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // the choice still applies for this visit
    }
    setChoiceState(next);
  }, []);

  return <ThemeContext.Provider value={{ choice, resolved, setChoice }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
