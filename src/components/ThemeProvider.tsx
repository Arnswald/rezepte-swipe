"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  setTheme: () => {},
  resolved: "light",
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Bewusste Entscheidung: nur das beige (helle) Design. Kein Dark-Mode mehr —
  // Christian will überall den gleichen warmen Look (iPhone = Mac = beige).
  const [theme] = useState<Theme>("light");

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  function setTheme(_t: Theme) { /* Dark-Mode deaktiviert — bewusst no-op */ }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved: "light" }}>
      {children}
    </ThemeContext.Provider>
  );
}
