import { Button } from "@/components/ui/button";
import { ArrowLeft, Scale, Shield } from "lucide-react";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { Link } from "wouter";

export default function PrivacyPage() {
  const goBack = useBackNavigation("/");

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto max-w-4xl px-6 py-16">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-3">
            <Scale className="h-7 w-7 text-cyan-300" />
            <span className="text-xl font-extrabold">LexScale</span>
          </Link>
          <Button variant="outline" className="border-slate-700 bg-slate-900/50 text-slate-100 hover:bg-slate-800" onClick={goBack}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Voltar
          </Button>
        </div>
        <div className="mb-6 flex items-center gap-3">
          <Shield className="h-7 w-7 text-emerald-300" />
          <h1 className="text-3xl font-extrabold">Política de Privacidade</h1>
        </div>

        <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 leading-relaxed text-slate-200">
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
    </main>
  );
}
