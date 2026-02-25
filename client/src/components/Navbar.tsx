import { useState, type MouseEvent } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Menu, Scale, X } from "lucide-react";

const NAV_ITEMS = [
  { label: "Serviços", href: "/#servicos" },
  { label: "Como Funciona", href: "/#como-funciona" },
  { label: "Dashboards", href: "/#dashboards" },
  { label: "Benefícios", href: "/#beneficios" },
  { label: "Planos", href: "/#planos" },
];

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location, setLocation] = useLocation();

  const handleLogoClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setMenuOpen(false);

    if (location !== "/") {
      setLocation("/");
      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 30);
      return;
    }

    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", "/");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleNavClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    const hash = href.split("#")[1];
    if (!hash) return;

    if (location === "/") {
      event.preventDefault();
      const section = document.getElementById(hash);
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      window.history.replaceState(window.history.state, "", `/#${hash}`);
      setMenuOpen(false);
      return;
    }

    event.preventDefault();
    setMenuOpen(false);
    setLocation(`/#${hash}`);
  };

  return (
    <header className="sticky top-0 z-50 w-full bg-slate-950/95 px-3 pt-3 backdrop-blur-md md:px-6 md:pt-4">
      <div className="mx-auto max-w-7xl rounded-2xl border border-slate-800/85 bg-slate-950/80 backdrop-blur-xl shadow-[0_12px_35px_rgba(2,6,23,0.45)]">
        <div className="flex h-16 items-center justify-between px-4 md:h-20 md:px-6">
          <Link
            href="/"
            onClick={handleLogoClick}
            className="brand-logo-chip flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 shadow-sm transition-colors"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-700 via-blue-600 to-cyan-500 text-white shadow-lg shadow-blue-600/25">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <p className="brand-logo-title text-xl font-extrabold tracking-tight">LexScale</p>
              <p className="brand-logo-subtitle -mt-0.5 text-[11px] font-medium uppercase tracking-[0.18em]">IA Jurídica</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 rounded-full border border-slate-800 bg-slate-900/80 p-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={item.href.replace("/#", "#")}
                onClick={(event) => handleNavClick(event, item.href)}
                className="rounded-full px-3 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800 hover:text-cyan-200"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Link href="/auth?tab=login">
              <Button
                variant="ghost"
                className="rounded-full px-5 font-semibold text-slate-700 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                Login
              </Button>
            </Link>
            <Link href="/auth?tab=register">
              <Button className="h-11 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 font-bold text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-emerald-700">
                Criar Conta Grátis
              </Button>
            </Link>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="text-slate-200 hover:bg-slate-800 md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Abrir menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {menuOpen && (
          <div className="space-y-2 border-t border-slate-800 px-4 py-4 md:hidden">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={item.href.replace("/#", "#")}
                onClick={(event) => handleNavClick(event, item.href)}
                className="block rounded-xl px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
              >
                {item.label}
              </a>
            ))}
            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <Link href="/auth?tab=login" className="flex-1" onClick={() => setMenuOpen(false)}>
                <Button variant="outline" className="w-full rounded-xl font-semibold border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800">
                  Login
                </Button>
              </Link>
              <Link href="/auth?tab=register" className="flex-1" onClick={() => setMenuOpen(false)}>
                <Button className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 font-bold text-white">
                  Criar Conta Grátis
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
