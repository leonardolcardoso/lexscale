import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ArrowRight, Bot, CheckCircle2, Scale, Shield } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { login, register } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default function AuthPage() {
  const [location, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
  });
  const { toast } = useToast();
  const goBack = useBackNavigation("/");

  const queryTab = useMemo<"login" | "register">(() => {
    const url = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const value = url?.get("tab");
    return value === "register" ? "register" : "login";
  }, [location]);
  const [activeTab, setActiveTab] = useState<"login" | "register">(queryTab);

  useEffect(() => {
    setActiveTab(queryTab);
  }, [queryTab]);

  useEffect(() => {
    let mounted = true;
    const checkAuth = async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!mounted) return;
      if (res.ok) {
        setLocation("/dashboard", { replace: true });
      }
    };
    checkAuth().catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [setLocation]);

  const openSupportEmail = () => {
    window.location.href = "mailto:contato@lexscale.ai?subject=Suporte%20LexScale";
  };

  const openResetPasswordEmail = () => {
    window.location.href =
      "mailto:contato@lexscale.ai?subject=Recupera%C3%A7%C3%A3o%20de%20senha&body=Ol%C3%A1%2C%20preciso%20redefinir%20minha%20senha.";
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await login(loginForm);
      toast({ title: "Login realizado", description: "Redirecionando para o dashboard." });
      setLocation("/dashboard", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao autenticar.";
      setErrorMessage(message);
      toast({ title: "Falha no login", description: message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await register(registerForm);
      toast({ title: "Conta criada", description: "Bem-vindo(a) ao LexScale." });
      setLocation("/dashboard", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao criar conta.";
      setErrorMessage(message);
      toast({ title: "Falha no cadastro", description: message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTabChange = (value: "login" | "register") => {
    setActiveTab(value);
    setErrorMessage(null);
    setLocation(`/auth?tab=${value}`, { replace: true });
  };

  const authInputClassName =
    "auth-input h-11 rounded-xl border-slate-700/80 bg-slate-950/55 px-4 text-sm font-medium text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-blue-500/60";
  const authLabelClassName = "auth-field-label text-slate-100";

  return (
    <div className="auth-page relative min-h-screen overflow-hidden bg-slate-950">
      <div className="auth-page-bg absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(59,130,246,0.35),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(20,184,166,0.24),transparent_32%),linear-gradient(180deg,#07102a_0%,#060e21_55%,#050a1a_100%)]" />
      <div className="mesh-layer opacity-30" />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden items-center justify-center px-10 py-14 lg:flex xl:px-20">
          <div className="max-w-xl text-slate-100">
            <BrandBadge href="/" className="mb-10" />

            <h2 className="mb-5 text-5xl font-extrabold leading-tight">
              A nova era da <span className="text-gradient">Inteligência Jurídica</span> começa aqui.
            </h2>
            <p className="mb-7 max-w-lg text-sm text-slate-300">
              Entre em segundos e transforme documentos jurídicos em análises claras, rápidas e seguras.
            </p>

            <div className="space-y-6">
              <FeatureLine
                icon={<Bot className="h-5 w-5 text-blue-700 dark:text-blue-200" />}
                title="IA de Alta Precisão"
                desc="Análise documental com 98.7% de acurácia comprovada."
              />
              <FeatureLine
                icon={<Shield className="h-5 w-5 text-cyan-700 dark:text-cyan-200" />}
                title="Segurança Bancária"
                desc="Dados criptografados e conformidade total com a LGPD."
              />
              <FeatureLine
                icon={<CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-200" />}
                title="Resultados Acionáveis"
                desc="Transforme PDFs em decisões estratégicas em minutos."
              />
            </div>
          </div>
        </section>

        <section className="flex items-start justify-center p-6 pt-10 md:p-10 md:pt-12 lg:items-center lg:pt-10">
          <div className="w-full max-w-lg space-y-8">
            <div className="flex items-center justify-between text-slate-900 dark:text-white">
              <Button
                type="button"
                variant="ghost"
                className="h-9 px-2 text-slate-200 hover:bg-slate-800 hover:text-white"
                onClick={goBack}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Voltar
              </Button>
              <BrandBadge href="/" className="lg:hidden" compact />
              <div className="w-[70px] lg:hidden" />
            </div>

            <Card className="auth-form-card relative overflow-hidden border border-slate-700/80 bg-slate-900/85 shadow-[0_24px_60px_rgba(2,6,23,0.55)] backdrop-blur-xl">
              <CardHeader className="space-y-3 pb-4">
                <div className="mx-auto inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-cyan-200">
                  Acesso seguro
                </div>
                <CardTitle className="text-center text-3xl font-extrabold text-slate-100">Boas-vindas</CardTitle>
                <CardDescription className="text-center text-slate-300">
                  Acesse sua conta ou crie uma nova para começar
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-5">
                <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as "login" | "register")} className="w-full">
                  <TabsList className="auth-tabs-list mb-5 grid h-11 w-full grid-cols-2 rounded-xl bg-slate-800/90 p-1.5">
                    <TabsTrigger value="login" className="auth-tab-trigger rounded-lg font-bold text-slate-300 data-[state=active]:bg-slate-950/90 data-[state=active]:text-white">
                      Login
                    </TabsTrigger>
                    <TabsTrigger value="register" className="auth-tab-trigger rounded-lg font-bold text-slate-300 data-[state=active]:bg-slate-950/90 data-[state=active]:text-white">
                      Cadastro
                    </TabsTrigger>
                  </TabsList>

                  <div className="mb-1 min-h-10">
                    {errorMessage ? <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">{errorMessage}</p> : null}
                  </div>

                  <div className="relative min-h-[366px] overflow-hidden sm:min-h-[384px]">
                    <form
                      onSubmit={handleLogin}
                      className={cn(
                        "absolute inset-0 space-y-4 transition-all duration-300 ease-out",
                        activeTab === "login"
                          ? "visible translate-y-0 opacity-100"
                          : "pointer-events-none invisible translate-y-2 opacity-0",
                      )}
                      aria-hidden={activeTab !== "login"}
                    >
                      <div className="space-y-2.5">
                        <div className="auth-field-head">
                          <Label htmlFor="email" className={authLabelClassName}>E-mail corporativo</Label>
                          <span className="auth-field-head-spacer" aria-hidden />
                        </div>
                        <Input
                          id="email"
                          type="email"
                          placeholder="nome@empresa.com.br"
                          required
                          value={loginForm.email}
                          onChange={(event) => setLoginForm((prev) => ({ ...prev, email: event.target.value }))}
                          className={authInputClassName}
                        />
                      </div>

                      <div className="space-y-2.5">
                        <div className="auth-field-head">
                          <Label htmlFor="password" className={authLabelClassName}>Senha</Label>
                          <Button variant="link" type="button" onClick={openResetPasswordEmail} className="auth-field-link h-auto p-0 text-xs font-semibold">
                            Esqueceu a senha?
                          </Button>
                        </div>
                        <Input
                          id="password"
                          type="password"
                          required
                          value={loginForm.password}
                          onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
                          className={authInputClassName}
                        />
                      </div>

                      <Button type="submit" className="h-11 w-full rounded-xl bg-blue-600 font-bold shadow-[0_10px_24px_rgba(37,99,235,0.35)] hover:bg-blue-700 hover:shadow-[0_12px_30px_rgba(37,99,235,0.45)]" disabled={isLoading}>
                        {isLoading ? "Acessando..." : "Entrar na Plataforma"}
                        {!isLoading ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
                      </Button>

                      <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-700/70 bg-slate-950/30 p-3 text-center text-xs text-slate-400">
                        <Shield className="h-3.5 w-3.5 text-cyan-300" />
                        <span>Ambiente seguro com sessão protegida e criptografia de credenciais.</span>
                      </div>
                    </form>

                    <form
                      onSubmit={handleRegister}
                      className={cn(
                        "absolute inset-0 space-y-4 transition-all duration-300 ease-out",
                        activeTab === "register"
                          ? "visible translate-y-0 opacity-100"
                          : "pointer-events-none invisible translate-y-2 opacity-0",
                      )}
                      aria-hidden={activeTab !== "register"}
                    >
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2.5">
                          <Label htmlFor="first-name" className={authLabelClassName}>Nome</Label>
                          <Input
                            id="first-name"
                            placeholder="João"
                            required
                            value={registerForm.first_name}
                            onChange={(event) => setRegisterForm((prev) => ({ ...prev, first_name: event.target.value }))}
                            className={authInputClassName}
                          />
                        </div>
                        <div className="space-y-2.5">
                          <Label htmlFor="last-name" className={authLabelClassName}>Sobrenome</Label>
                          <Input
                            id="last-name"
                            placeholder="Silva"
                            required
                            value={registerForm.last_name}
                            onChange={(event) => setRegisterForm((prev) => ({ ...prev, last_name: event.target.value }))}
                            className={authInputClassName}
                          />
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <Label htmlFor="reg-email" className={authLabelClassName}>E-mail corporativo</Label>
                        <Input
                          id="reg-email"
                          type="email"
                          placeholder="nome@empresa.com.br"
                          required
                          value={registerForm.email}
                          onChange={(event) => setRegisterForm((prev) => ({ ...prev, email: event.target.value }))}
                          className={authInputClassName}
                        />
                      </div>

                      <div className="space-y-2.5">
                        <Label htmlFor="reg-password" className={authLabelClassName}>Crie uma senha</Label>
                        <Input
                          id="reg-password"
                          type="password"
                          required
                          minLength={8}
                          value={registerForm.password}
                          onChange={(event) => setRegisterForm((prev) => ({ ...prev, password: event.target.value }))}
                          className={authInputClassName}
                        />
                      </div>

                      <Button type="submit" className="h-11 w-full rounded-xl bg-blue-600 font-bold shadow-[0_10px_24px_rgba(37,99,235,0.35)] hover:bg-blue-700 hover:shadow-[0_12px_30px_rgba(37,99,235,0.45)]" disabled={isLoading}>
                        {isLoading ? "Criando conta..." : "Criar Minha Conta"}
                        {!isLoading ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
                      </Button>
                    </form>
                  </div>

                  <div className="min-h-[36px]">
                    <p
                      className={cn(
                        "text-center text-[11px] leading-relaxed text-slate-400 transition-opacity duration-300",
                        activeTab === "register" ? "opacity-100" : "opacity-0",
                      )}
                    >
                      Ao se cadastrar, você concorda com nossos{" "}
                      <Link href="/termos" className="cursor-pointer underline">
                        Termos de Uso
                      </Link>{" "}
                      e{" "}
                      <Link href="/privacidade" className="cursor-pointer underline">
                        Política de Privacidade
                      </Link>
                      .
                    </p>
                  </div>
                </Tabs>
              </CardContent>
            </Card>

            <div className="flex items-center justify-center gap-2 text-sm text-slate-300">
              <span>Precisa de ajuda?</span>
              <Button variant="link" type="button" onClick={openSupportEmail} className="h-auto p-0 font-bold text-cyan-300">
                Falar com suporte
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

type FeatureLineProps = {
  icon: React.ReactNode;
  title: string;
  desc: string;
};

type BrandBadgeProps = {
  href: string;
  className?: string;
  compact?: boolean;
};

function BrandBadge({ href, className, compact = false }: BrandBadgeProps) {
  return (
    <Link href={href} className={cn("auth-brand inline-flex items-center gap-2.5 rounded-xl border px-2.5 py-1.5 transition-colors", className)}>
      <div className={cn("auth-brand-icon flex items-center justify-center rounded-xl bg-gradient-to-br from-blue-700 via-blue-600 to-cyan-500 text-white shadow-lg shadow-blue-600/25", compact ? "h-9 w-9" : "h-10 w-10")}>
        <Scale className={cn(compact ? "h-4 w-4" : "h-5 w-5")} />
      </div>
      <div>
        <p className={cn("auth-brand-name font-extrabold tracking-tight", compact ? "text-lg" : "text-xl")}>LexScale</p>
        {!compact ? <p className="auth-brand-subtitle -mt-0.5 text-[11px] font-medium uppercase tracking-[0.18em]">IA Jurídica</p> : null}
      </div>
    </Link>
  );
}

function FeatureLine({ icon, title, desc }: FeatureLineProps) {
  return (
    <div className="auth-feature-line rounded-2xl border border-blue-200/60 bg-slate-100/80 p-5 backdrop-blur-sm dark:border-blue-200/20 dark:bg-white/5">
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-blue-300/50 bg-blue-500/15 dark:border-blue-200/30 dark:bg-blue-500/20">
        {icon}
      </div>
      <h4 className="mb-1 text-lg font-bold">{title}</h4>
      <p className="text-sm text-slate-500 dark:text-blue-100/80">{desc}</p>
    </div>
  );
}
