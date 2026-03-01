import { Scale } from "lucide-react";
import { Link } from "wouter";

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-100 py-12 text-slate-600 dark:border-slate-800 dark:bg-[#0a192f] dark:text-slate-400">
      <div className="container mx-auto grid gap-8 px-4 md:grid-cols-4">
        <div>
          <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-white">
            <Scale className="h-6 w-6 text-blue-500" />
            <span className="text-xl font-bold tracking-tight">LexScale</span>
          </div>
          <p className="text-sm">Transformando documentos jurídicos em dados acionáveis com Inteligência Artificial.</p>
        </div>
        <div>
          <h4 className="mb-4 font-bold text-slate-900 dark:text-white">Soluções</h4>
          <ul className="space-y-2 text-sm">
            <li>Automação de Documentos</li>
            <li>Extração de Dados</li>
            <li>Análise Jurídica</li>
            <li>API de Integração</li>
          </ul>
        </div>
        <div>
          <h4 className="mb-4 font-bold text-slate-900 dark:text-white">Recursos</h4>
          <ul className="space-y-2 text-sm">
            <li>
              <a
                className="transition-colors hover:text-cyan-700 dark:hover:text-cyan-300"
                href="https://platform.openai.com/docs/api-reference"
                target="_blank"
                rel="noreferrer"
              >
                Documentação
              </a>
            </li>
            <li>Casos de Uso</li>
            <li>
              <Link href="/termos" className="transition-colors hover:text-cyan-700 dark:hover:text-cyan-300">
                Termos de Uso
              </Link>
            </li>
            <li>
              <Link href="/privacidade" className="transition-colors hover:text-cyan-700 dark:hover:text-cyan-300">
                Política de Privacidade
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="mb-4 font-bold text-slate-900 dark:text-white">Contato</h4>
          <ul className="space-y-2 text-sm">
            <li>contato@lexscale.ai</li>
            <li>(34) 99232-2275</li>
          </ul>
        </div>
      </div>
      <div className="container mx-auto mt-12 border-t border-slate-200 px-4 pt-8 text-center text-sm dark:border-slate-800">
        © 2026 LexScale. Todos os direitos reservados.
      </div>
    </footer>
  );
}
