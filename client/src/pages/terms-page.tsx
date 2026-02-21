import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Scale } from "lucide-react";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto max-w-4xl px-6 py-16">
        <div className="mb-8 flex items-center gap-3">
          <Scale className="h-7 w-7 text-cyan-300" />
          <h1 className="text-3xl font-extrabold">Termos de Uso</h1>
        </div>

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

        <div className="mt-8">
          <Link href="/">
            <Button className="bg-cyan-500 text-slate-950 hover:bg-cyan-400">Voltar para Home</Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
