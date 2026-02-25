import { Button } from "@/components/ui/button";
import { ArrowLeft, Scale } from "lucide-react";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { Link } from "wouter";

export default function TermsPage() {
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
        <h1 className="mb-6 text-3xl font-extrabold">Termos de Uso</h1>

        <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 leading-relaxed text-slate-200">
          <p>
            Estes Termos regulam o uso da plataforma LexScale para análise e processamento de dados jurídicos.
            Ao utilizar a plataforma, você concorda com as regras de uso, confidencialidade e conformidade legal.
          </p>
          <p>
            O usuário é responsável pela legitimidade dos documentos enviados e pelo cumprimento das normas aplicáveis,
            incluindo LGPD e regras de sigilo processual.
          </p>
          <p>
            A LexScale pode atualizar estes Termos periodicamente. Em caso de dúvida jurídica específica sobre o contrato,
            contate: contato@lexscale.ai.
          </p>
        </div>
      </section>
    </main>
  );
}
