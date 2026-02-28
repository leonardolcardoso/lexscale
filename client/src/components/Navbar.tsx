import { useState, type MouseEvent } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronDown, LayoutDashboard, LogOut, Menu, Scale, UserCircle2, X } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { buildInitials, fetchMe, logout } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();
  const meQuery = useQuery({
    queryKey: ["auth-navbar-me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });
  const isAuthenticated = Boolean(meQuery.data);
  const displayName = meQuery.data?.first_name?.trim() || meQuery.data?.full_name || "Conta";
  const initials = buildInitials(meQuery.data?.full_name || displayName);
  const userEmail = meQuery.data?.email || "";
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setLocation("/auth?tab=login", { replace: true });
    },
    onError: (error) => {
      toast({
        title: "Falha ao sair",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

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
    <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/85 px-4 py-3 backdrop-blur-xl lg:px-5 lg:py-2 xl:h-16 xl:px-6 xl:py-0">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-3 md:py-1 xl:h-full xl:py-0">
        <div className="flex h-10 items-center justify-between md:h-auto">
          <Link
            href="/"
            onClick={handleLogoClick}
            className="brand-logo-chip flex items-center gap-2 rounded-xl px-2.5 py-1.5 shadow-sm transition-colors md:justify-self-start"
          >
            <Scale className="brand-logo-icon h-6 w-6" />
            <span className="brand-logo-title text-xl font-bold tracking-tight">LexScale</span>
          </Link>

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

        <nav className="hidden items-center gap-1 rounded-full border border-slate-800 bg-slate-900/80 p-1 md:flex md:justify-self-center">
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

        <div className="hidden items-center gap-3 md:flex md:justify-self-end">
          {isAuthenticated ? (
            <>
              <Link href="/dashboard">
                <Button className="h-11 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 px-6 font-bold text-white shadow-lg shadow-cyan-500/25 hover:from-cyan-600 hover:to-blue-700">
                  Abrir Dashboard
                </Button>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-11 rounded-full border-slate-700/80 bg-slate-900/85 px-3 text-slate-100 hover:bg-slate-800"
                  >
                    <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/20 text-[11px] font-bold text-cyan-200">
                      {initials}
                    </span>
                    <span className="max-w-[120px] truncate text-sm font-semibold">{displayName}</span>
                    <ChevronDown className="ml-2 h-4 w-4 text-slate-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 border-slate-700 bg-slate-900/98 text-slate-100">
                  <DropdownMenuLabel className="space-y-0.5">
                    <p className="text-sm font-semibold">{displayName}</p>
                    <p className="truncate text-xs font-normal text-slate-400">{userEmail}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-slate-700" />
                  <DropdownMenuItem className="cursor-pointer focus:bg-slate-800" onClick={() => setLocation("/dashboard")}>
                    <LayoutDashboard className="h-4 w-4 text-cyan-300" />
                    Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer focus:bg-slate-800" onClick={() => setLocation("/profile")}>
                    <UserCircle2 className="h-4 w-4 text-cyan-300" />
                    Meu perfil
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-slate-700" />
                  <DropdownMenuItem
                    className="cursor-pointer text-red-300 focus:bg-red-500/15 focus:text-red-200"
                    disabled={logoutMutation.isPending}
                    onClick={() => logoutMutation.mutate()}
                  >
                    <LogOut className="h-4 w-4" />
                    {logoutMutation.isPending ? "Saindo..." : "Sair"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
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
            </>
          )}
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
              {isAuthenticated ? (
                <>
                  <div className="mb-1 flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-slate-200">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/20 text-[11px] font-bold text-cyan-200">
                      {initials}
                    </span>
                    <div>
                      <p className="text-sm font-semibold leading-tight">{displayName}</p>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-300/80">Sessão ativa</p>
                    </div>
                  </div>
                  <Link href="/dashboard" className="flex-1" onClick={() => setMenuOpen(false)}>
                    <Button className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 font-bold text-white">
                      Dashboard
                    </Button>
                  </Link>
                  <Link href="/profile" className="flex-1" onClick={() => setMenuOpen(false)}>
                    <Button variant="outline" className="w-full rounded-xl border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800">
                      Perfil
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    className="w-full rounded-xl border-red-800/70 bg-red-950/20 font-semibold text-red-200 hover:bg-red-900/30"
                    onClick={() => {
                      setMenuOpen(false);
                      logoutMutation.mutate();
                    }}
                    disabled={logoutMutation.isPending}
                  >
                    {logoutMutation.isPending ? "Saindo..." : "Sair"}
                  </Button>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
