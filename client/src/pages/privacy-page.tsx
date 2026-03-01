import { Button } from "@/components/ui/button";
import { ArrowLeft, Scale, Shield } from "lucide-react";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { Link } from "wouter";
import { SiteFooter } from "@/components/site-footer";

export default function PrivacyPage() {
  const goBack = useBackNavigation("/");

  return (
    <main className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <section className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-3">
            <Scale className="h-7 w-7 text-cyan-600 dark:text-cyan-300" />
            <span className="text-xl font-extrabold">LexScale</span>
          </Link>
          <Button
            variant="outline"
            className="border-slate-300 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100 dark:hover:bg-slate-800"
            onClick={goBack}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Voltar
          </Button>
        </div>
        <div className="mb-6 flex items-center gap-3">
          <Shield className="h-7 w-7 text-emerald-600 dark:text-emerald-300" />
          <h1 className="text-3xl font-extrabold">Política de Privacidade</h1>
        </div>

        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200">
          <p>
            A LexScale trata dados pessoais e dados processuais conforme a LGPD, adotando medidas técnicas e
            administrativas para proteção contra acesso indevido, alteração ou vazamento.
          </p>
          <p>
            Dados enviados para processamento são utilizados para operação da plataforma, geração de análises e melhoria
            dos modelos, sempre respeitando controles de acesso e políticas internas de segurança.
          </p>
          <p>
            Para solicitações sobre acesso, correção ou exclusão de dados, entre em contato em contato@lexscale.ai.
          </p>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
