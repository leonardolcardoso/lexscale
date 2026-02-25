import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = useMemo(() => {
    if (!mounted) {
      return "dark";
    }
    return theme === "system" ? resolvedTheme : theme;
  }, [mounted, resolvedTheme, theme]);

  return (
    <div className="fixed bottom-5 right-5 z-[90]">
      <div className="theme-toggle-shell flex items-center gap-1 rounded-full p-1 shadow-xl">
        <button
          type="button"
          onClick={() => setTheme("light")}
          className={cn("theme-toggle-option", activeTheme === "light" && "is-active")}
          aria-label="Ativar modo claro"
          aria-pressed={activeTheme === "light"}
          title="Modo claro"
        >
          <Sun className="h-5 w-5" />
          <span className="sr-only">Claro</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          className={cn("theme-toggle-option", activeTheme === "dark" && "is-active")}
          aria-label="Ativar modo escuro"
          aria-pressed={activeTheme === "dark"}
          title="Modo escuro"
        >
          <Moon className="h-5 w-5" />
          <span className="sr-only">Escuro</span>
        </button>
      </div>
    </div>
  );
}
