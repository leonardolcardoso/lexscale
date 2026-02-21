import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Bot, CheckCircle2, Scale, Shield } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function AuthPage() {
  const [location, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const queryTab = useMemo<"login" | "register">(() => {
    const url = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const value = url?.get("tab");
    return value === "register" ? "register" : "login";
  }, [location]);
  const [activeTab, setActiveTab] = useState<"login" | "register">(queryTab);

  useEffect(() => {
    setActiveTab(queryTab);
  }, [queryTab]);

  const openSupportEmail = () => {
    window.location.href = "mailto:contato@lexscale.ai?subject=Suporte%20LexScale";
  };

  const openResetPasswordEmail = () => {
    window.location.href =
      "mailto:contato@lexscale.ai?subject=Recupera%C3%A7%C3%A3o%20de%20senha&body=Ol%C3%A1%2C%20preciso%20redefinir%20minha%20senha.";
  };

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      setLocation("/dashboard");
    }, 1000);
  };

  const handleTabChange = (value: "login" | "register") => {
    setActiveTab(value);
    setLocation(`/auth?tab=${value}`);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(59,130,246,0.35),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(20,184,166,0.24),transparent_32%),linear-gradient(180deg,#07102a_0%,#060e21_55%,#050a1a_100%)]" />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden items-center justify-center px-10 py-14 lg:flex xl:px-20">
          <div className="max-w-xl text-white">
            <div className="mb-10 inline-flex items-center gap-3 rounded-2xl border border-blue-300/30 bg-blue-500/10 px-5 py-3 backdrop-blur-sm">
              <Scale className="h-7 w-7 text-cyan-200" />
              <span className="text-2xl font-bold tracking-tight">LexScale</span>
            </div>

            <h2 className="mb-6 text-5xl font-extrabold leading-tight">
              A nova era da <span className="text-gradient">Inteligência Jurídica</span> começa aqui.
            </h2>

            <div className="space-y-6">
              <FeatureLine
                icon={<Bot className="h-5 w-5 text-blue-200" />}
                title="IA de Alta Precisão"
                desc="Análise documental com 98.7% de acurácia comprovada."
              />
              <FeatureLine
                icon={<Shield className="h-5 w-5 text-cyan-200" />}
                title="Segurança Bancária"
                desc="Dados criptografados e conformidade total com a LGPD."
              />
              <FeatureLine
                icon={<CheckCircle2 className="h-5 w-5 text-emerald-200" />}
                title="Resultados Acionáveis"
                desc="Transforme PDFs em decisões estratégicas em minutos."
              />
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 md:p-10">
          <div className="w-full max-w-lg space-y-8">
            <div className="flex items-center justify-center gap-2 text-white lg:hidden">
              <Scale className="h-8 w-8 text-blue-300" />
              <span className="text-3xl font-bold tracking-tight">LexScale</span>
            </div>

            <Card className="border border-slate-700/80 bg-slate-900/85 shadow-[0_24px_60px_rgba(2,6,23,0.55)] backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-center text-3xl font-extrabold text-slate-100">Boas-vindas</CardTitle>
                <CardDescription className="text-center text-slate-300">
                  Acesse sua conta ou crie uma nova para começar
                </CardDescription>
              </CardHeader>

              <CardContent>
                <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as "login" | "register")} className="w-full">
                  <TabsList className="mb-8 grid w-full grid-cols-2 rounded-xl bg-slate-800 p-1">
                    <TabsTrigger value="login" className="rounded-lg font-bold">
                      Login
                    </TabsTrigger>
                    <TabsTrigger value="register" className="rounded-lg font-bold">
                      Cadastro
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="login">
                    <form onSubmit={handleAuth} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-slate-200">E-mail corporativo</Label>
                        <Input id="email" type="email" placeholder="nome@empresa.com.br" required className="h-11 border-slate-700 bg-slate-950/60 text-slate-100 placeholder:text-slate-500" />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="password" className="text-slate-200">Senha</Label>
                          <Button variant="link" type="button" onClick={openResetPasswordEmail} className="h-auto p-0 text-xs font-semibold text-blue-600">
                            Esqueceu a senha?
                          </Button>
                        </div>
                        <Input id="password" type="password" required className="h-11 border-slate-700 bg-slate-950/60 text-slate-100" />
                      </div>

                      <Button type="submit" className="h-11 w-full rounded-xl bg-blue-600 font-bold hover:bg-blue-700" disabled={isLoading}>
                        {isLoading ? "Acessando..." : "Entrar na Plataforma"}
                        {!isLoading ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
                      </Button>
                    </form>
                  </TabsContent>

                  <TabsContent value="register">
                    <form onSubmit={handleAuth} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="first-name" className="text-slate-200">Nome</Label>
                          <Input id="first-name" placeholder="João" required className="h-11 border-slate-700 bg-slate-950/60 text-slate-100 placeholder:text-slate-500" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="last-name" className="text-slate-200">Sobrenome</Label>
                          <Input id="last-name" placeholder="Silva" required className="h-11 border-slate-700 bg-slate-950/60 text-slate-100 placeholder:text-slate-500" />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="reg-email" className="text-slate-200">E-mail corporativo</Label>
                        <Input id="reg-email" type="email" placeholder="nome@empresa.com.br" required className="h-11 border-slate-700 bg-slate-950/60 text-slate-100 placeholder:text-slate-500" />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="reg-password" className="text-slate-200">Crie uma senha</Label>
                        <Input id="reg-password" type="password" required className="h-11 border-slate-700 bg-slate-950/60 text-slate-100" />
                      </div>

                      <Button type="submit" className="h-11 w-full rounded-xl bg-blue-600 font-bold hover:bg-blue-700" disabled={isLoading}>
                        {isLoading ? "Criando conta..." : "Criar Minha Conta"}
                        {!isLoading ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
                      </Button>

                      <p className="mt-4 text-center text-[10px] leading-relaxed text-slate-400">
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
                    </form>
                  </TabsContent>
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

function FeatureLine({ icon, title, desc }: FeatureLineProps) {
  return (
    <div className="rounded-2xl border border-blue-200/20 bg-white/5 p-5 backdrop-blur-sm">
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-blue-200/30 bg-blue-500/20">
        {icon}
      </div>
      <h4 className="mb-1 text-lg font-bold">{title}</h4>
      <p className="text-sm text-blue-100/80">{desc}</p>
    </div>
  );
}
