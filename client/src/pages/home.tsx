import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Database,
  MessageSquare,
  MonitorPlay,
  Plug,
  Scale,
  Search,
  Shield,
  Target,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";

const WHATSAPP_URL =
  "https://wa.me/5534992322275?text=Ol%C3%A1%2C%20quero%20falar%20com%20vendas%20da%20LexScale.";
const DEMO_EMAIL = "contato@lexscale.ai";

const featureCards = [
  {
    icon: <Bot className="h-6 w-6 text-slate-100" />,
    title: "Automação de Tarefas",
    desc: "",
    items: [
      "Leitura de petições e contratos",
      "Resumo automático de documentos",
      "Extração de partes, prazos e valores",
      "Identificação de artigos citados",
    ],
    iconWrap: "bg-slate-800",
  },
  {
    icon: <Database className="h-6 w-6 text-emerald-300" />,
    title: "Conversão para Dados",
    desc: "Transformamos PDFs e DOCXs em:",
    items: ["Tabelas organizadas", "Campos estruturados", "Metadados interpretados", "Insights legais"],
    iconWrap: "bg-emerald-500/15",
  },
  {
    icon: <MessageSquare className="h-6 w-6 text-violet-300" />,
    title: "Chat com IA",
    desc: "Pergunte ao documento:",
    items: [
      '"Quais os riscos deste contrato?"',
      '"Existe conflito entre cláusulas?"',
      '"Qual o prazo final?"',
      "Respostas baseadas no documento real",
    ],
    iconWrap: "bg-violet-500/15",
  },
  {
    icon: <Plug className="h-6 w-6 text-amber-300" />,
    title: "API para Integrações",
    desc: "Integre com seus sistemas:",
    items: ["ERP Jurídico", "Automação de prazos", "Sistemas de contencioso", "Plataformas de auditoria"],
    iconWrap: "bg-amber-500/15",
  },
  {
    icon: <Target className="h-6 w-6 text-cyan-300" />,
    title: "Padronização",
    desc: "Crie padrões internos:",
    items: ["Modelos de análise", "Padrões de extração", "Templates de revisão", "Taxonomia legal"],
    iconWrap: "bg-cyan-500/15",
  },
  {
    icon: <CheckCircle2 className="h-6 w-6 text-slate-100" />,
    title: "O Resultado",
    desc: "Toda a equipe trabalha com o mesmo nível de qualidade, transformando documentos jurídicos em dados acionáveis para decisões mais rápidas e precisas.",
    items: [],
    iconWrap: "bg-slate-800",
  },
];

const steps = [
  {
    step: 1,
    phase: "Entrada",
    title: "Upload de Documentos",
    desc: "Faça upload de contratos, petições, sentenças e outros documentos jurídicos em PDF, Word ou imagens",
    icon: <ArrowRight className="h-7 w-7 text-cyan-300" />,
    panel: "bg-cyan-500/15 text-cyan-200 border border-cyan-500/30",
  },
  {
    step: 2,
    phase: "Processamento",
    title: "IA Processa",
    desc: "Nossa IA avançada extrai dados, identifica cláusulas, partes, valores e riscos automaticamente",
    icon: <Bot className="h-7 w-7 text-violet-300" />,
    panel: "bg-violet-500/15 text-violet-200 border border-violet-500/30",
  },
  {
    step: 3,
    phase: "Entrega",
    title: "Dados Estruturados",
    desc: "Receba dados organizados em dashboards, APIs ou integre diretamente ao seu sistema",
    icon: <Database className="h-7 w-7 text-emerald-300" />,
    panel: "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30",
  },
];

const pricing = [
  {
    title: "Starter",
    desc: "Escritórios pequenos e médios",
    price: "R$ 2.490",
    features: [
      "Até 5.000 documentos/mês",
      "IA + Revisão humana",
      "Dashboard de métricas",
      "Suporte por email",
      "API Privada",
    ],
    highlighted: false,
    cta: "Começar Teste Grátis",
  },
  {
    title: "Business",
    desc: "Escritórios em expansão",
    price: "R$ 6.900",
    features: [
      "Até 20.000 documentos/mês",
      "IA + Revisão supervisionada",
      "API Privada + SLA",
      "Integração CRM Jurídico",
      "Suporte prioritário 24/7",
    ],
    highlighted: true,
    cta: "Começar Teste Grátis",
  },
  {
    title: "Enterprise",
    desc: "Solução corporativa completa",
    price: "Customizado",
    features: ["Volume ilimitado", "Suporte dedicado", "Auditoria LGPD completa", "Personalização total", "Gerente de conta exclusivo"],
    highlighted: false,
    cta: "Falar com Vendas",
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0 },
};

export default function Home() {
  const [location, setLocation] = useLocation();

  const scrollToSection = (id: string) => {
    const section = document.getElementById(id);
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const openWhatsApp = () => {
    window.open(WHATSAPP_URL, "_blank", "noopener,noreferrer");
  };

  const openDemoEmail = () => {
    window.location.href = `mailto:${DEMO_EMAIL}?subject=${encodeURIComponent("Agendar demonstração LexScale")}`;
  };

  const goToRegister = (plan?: string) => {
    const planQuery = plan ? `&plan=${encodeURIComponent(plan)}` : "";
    setLocation(`/auth?tab=register${planQuery}`);
  };

  useEffect(() => {
    if (location !== "/") return;
    const hash = window.location.hash?.replace("#", "");
    if (!hash) return;
    const timer = window.setTimeout(() => {
      const section = document.getElementById(hash);
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [location]);

  return (
    <div className="home-page relative min-h-screen bg-slate-950">
      <Navbar />

      <section className="bg-hero-gradient relative overflow-hidden pb-24 pt-14 text-white md:pt-16 lg:pt-20">
        <div className="mesh-layer" />

        <div className="container mx-auto grid items-center gap-12 px-4 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div
            initial="hidden"
            animate="show"
            variants={fadeUp}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="relative z-10"
          >
            <span className="pill-label mb-6">
              <Bot className="h-4 w-4" /> Inteligência Artificial
            </span>

            <h1 className="mb-6 text-4xl font-extrabold leading-[1.06] sm:text-5xl lg:text-7xl">
              Transforme Documentos Jurídicos em <span className="text-gradient">Dados Inteligentes</span>
            </h1>

            <p className="mb-9 max-w-2xl text-base leading-relaxed text-blue-100/90 sm:text-xl">
              A LexScale usa IA avançada para converter contratos, petições e documentos jurídicos em dados estruturados e acionáveis,
              economizando tempo e aumentando a precisão.
            </p>

            <div className="flex flex-wrap gap-3">
              <Link href="/dashboard">
                <Button className="group h-12 rounded-full bg-cyan-500 px-7 text-base font-bold text-slate-950 hover:bg-cyan-400">
                  <MonitorPlay className="mr-2 h-5 w-5 transition-transform group-hover:translate-x-0.5" /> Começar Agora
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-blue-300/45 bg-blue-900/25 px-7 text-base font-semibold text-white hover:bg-blue-700/40"
                onClick={() => scrollToSection("servicos")}
              >
                <Search className="mr-2 h-5 w-5" /> Explorar Serviços
              </Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
            className="relative hidden lg:block"
          >
            <div className="glass-card-dark relative overflow-hidden rounded-[2rem] p-8">
              <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl" />
              <div className="absolute -left-14 bottom-0 h-44 w-44 rounded-full bg-blue-500/20 blur-3xl" />
              <div className="relative space-y-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-200">Painel de Eficiência</p>
                  <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-bold text-emerald-200">+23%</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Documentos Processados", value: "1.247" },
                    { label: "Tempo Economizado", value: "3.4h" },
                    { label: "Taxa de Precisão", value: "98.7%" },
                    { label: "Usuários Ativos", value: "89" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-blue-200/20 bg-white/5 p-4 backdrop-blur-sm">
                      <p className="mb-1 text-[11px] font-medium text-blue-100/80">{item.label}</p>
                      <p className="text-2xl font-extrabold">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="highlight-outline relative rounded-2xl bg-slate-950/20 p-5">
                  <div className="flex items-center gap-3 text-cyan-200">
                    <Shield className="h-5 w-5" />
                    <span className="text-sm font-bold uppercase tracking-[0.18em]">Segurança e Compliance</span>
                  </div>
                  <p className="mt-3 text-sm text-blue-100/90">
                    Transformando documentos jurídicos em dados acionáveis com Inteligência Artificial.
                  </p>
                </div>
              </div>
            </div>

            <div className="animate-float absolute -left-9 -top-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500 text-white shadow-xl shadow-blue-900/35">
              <Scale className="h-8 w-8" />
            </div>
            <div className="animate-float-delayed absolute -bottom-8 right-2 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-xl shadow-emerald-900/35">
              <CheckCircle2 className="h-8 w-8" />
            </div>
          </motion.div>
        </div>
      </section>

      <section id="servicos" className="relative py-24">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <h2 className="mb-4 text-3xl font-extrabold text-slate-100 lg:text-4xl">O Que a LexScale Faz</h2>
            <p className="text-lg text-slate-300">
              Automatizamos tarefas jurídicas repetitivas e transformamos documentos em dados acionáveis
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {featureCards.map((card, index) => (
              <motion.article
                key={card.title}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.25 }}
                variants={fadeUp}
                transition={{ delay: index * 0.04, duration: 0.42 }}
                className="soft-panel group relative overflow-hidden p-7"
              >
                <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-blue-500/20 blur-2xl transition-transform duration-500 group-hover:scale-125" />
                <div className={`mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl ${card.iconWrap}`}>{card.icon}</div>
                <h3 className="mb-2 text-xl font-bold text-slate-100">{card.title}</h3>
                {card.desc ? <p className="mb-4 text-sm text-slate-300">{card.desc}</p> : null}
                <ul className="space-y-2.5">
                  {card.items.map((item) => (
                    <li key={item} className="flex items-start text-sm text-slate-300">
                      <Check className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-10">
        <div className="container mx-auto rounded-3xl bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-600 p-8 text-white shadow-2xl shadow-blue-900/20 md:p-10">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div>
              <h3 className="mb-2 text-2xl font-bold">Veja a LexScale em Ação</h3>
              <p className="text-blue-100">Agende uma demonstração personalizada sem compromisso</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={openDemoEmail} className="h-11 rounded-full bg-slate-950 px-6 font-bold text-white border border-slate-700 hover:bg-slate-900">
                Agendar Demo
              </Button>
              <Button onClick={openWhatsApp} variant="outline" className="h-11 rounded-full border-white/70 bg-transparent px-6 font-bold text-white hover:bg-white/10">
                WhatsApp
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="como-funciona" className="py-24">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-cyan-500/15 border border-cyan-500/30 px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.18em] text-cyan-200">
              <Zap className="h-4 w-4" /> PROCESSO SIMPLES
            </div>
            <h2 className="mb-5 text-3xl font-extrabold text-slate-100 lg:text-4xl">Como Funciona</h2>
            <p className="text-lg text-slate-300">Transforme seus documentos jurídicos em dados estruturados em 3 passos simples</p>
          </div>

          <div className="relative grid gap-6 md:grid-cols-3">
            {steps.map((step, index) => (
              <motion.div
                key={step.title}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.35 }}
                variants={fadeUp}
                transition={{ duration: 0.4, delay: index * 0.08 }}
                className="soft-panel relative overflow-hidden p-7"
              >
                <div className="mb-5 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-blue-300/25 bg-slate-900/80 px-3 py-1 text-xs font-bold text-blue-100">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-[11px] font-black text-cyan-200">
                      {step.step}
                    </span>
                    Passo {step.step} de {steps.length}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{step.phase}</span>
                </div>
                <div className={`mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl ${step.panel}`}>{step.icon}</div>
                <h3 className="mb-3 text-xl font-bold text-slate-100">{step.title}</h3>
                <p className="text-sm leading-relaxed text-slate-300">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="dashboards" className="relative overflow-hidden bg-[#061534] py-24 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.16),transparent_45%),radial-gradient(circle_at_90%_10%,rgba(45,212,191,0.18),transparent_32%)]" />
        <div className="container relative z-10 mx-auto px-4">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-yellow-300/30 bg-yellow-500/15 px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.18em] text-yellow-200">
              <Bot className="h-4 w-4" /> DEMONSTRAÇÃO INTERATIVA • DADOS FICTÍCIOS
            </span>
            <h2 className="mb-5 text-3xl font-extrabold lg:text-4xl">Dashboards Inteligentes</h2>
            <p className="mb-8 text-lg text-blue-100/80">Visualize métricas e insights em tempo real sobre seus documentos jurídicos</p>
            <Link href="/dashboard-demo">
              <Button size="lg" className="h-12 rounded-full bg-blue-500 px-8 font-bold text-white hover:bg-blue-600">
                <MonitorPlay className="mr-2 h-5 w-5" /> Entrar no Dashboard Completo
              </Button>
            </Link>
            <p className="mt-4 text-sm text-blue-200/70">Exemplo com dados fictícios para fins de demonstração</p>
          </div>

          <div className="glass-card-dark mx-auto max-w-6xl overflow-hidden rounded-3xl p-6 md:p-8">
            <div className="mb-7 grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                { title: "Documentos Processados", value: "1.247", stat: "+23%", icon: "📄", iconBg: "bg-blue-500/20" },
                { title: "Tempo Economizado", value: "3.4h", stat: "+18%", icon: "⏱", iconBg: "bg-emerald-500/20" },
                { title: "Taxa de Precisão", value: "98.7%", stat: "+5%", icon: "🎯", iconBg: "bg-violet-500/20" },
                { title: "Usuários Ativos", value: "89", stat: "+12%", icon: "👥", iconBg: "bg-amber-500/20" },
              ].map((kpi) => (
                <div key={kpi.title} className="rounded-2xl border border-white/12 bg-white/5 p-4 backdrop-blur-sm">
                  <div className="mb-2 flex items-start justify-between">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-lg ${kpi.iconBg}`}>{kpi.icon}</div>
                    <span className="text-xs font-semibold text-emerald-300">{kpi.stat}</span>
                  </div>
                  <p className="mb-1 text-xs uppercase tracking-wider text-blue-200/75">{kpi.title}</p>
                  <p className="text-2xl font-extrabold">{kpi.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-white/12 bg-slate-950/25 p-6">
              <div className="mb-6 flex items-center gap-2 text-blue-200">
                <Target className="h-5 w-5" />
                <h3 className="text-lg font-bold text-white">Dashboard Jurídico Interativo</h3>
              </div>
              <div className="flex h-52 items-end gap-3 px-2">
                <div className="h-[60%] w-1/4 rounded-t-lg bg-violet-500/80" />
                <div className="h-[80%] w-1/4 rounded-t-lg bg-blue-500/80" />
                <div className="h-[40%] w-1/4 rounded-t-lg bg-emerald-500/80" />
                <div className="h-[25%] w-1/4 rounded-t-lg bg-amber-500/80" />
              </div>
              <div className="mt-4 flex justify-around text-xs text-blue-200/80">
                <span>Tributário</span>
                <span>Trabalhista</span>
                <span>Cível</span>
                <span>Empresarial</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="beneficios" className="py-24">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <h2 className="mb-4 text-3xl font-extrabold text-slate-100 lg:text-4xl">Benefícios</h2>
            <p className="text-lg text-slate-300">
              Toda a equipe trabalha com o mesmo nível de qualidade, transformando documentos jurídicos em dados acionáveis para decisões mais rápidas e precisas.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                title: "IA de Alta Precisão",
                desc: "Análise documental com 98.7% de acurácia comprovada.",
                icon: <Bot className="h-6 w-6 text-blue-300" />,
              },
              {
                title: "Segurança Bancária",
                desc: "Dados criptografados e conformidade total com a LGPD.",
                icon: <Shield className="h-6 w-6 text-cyan-300" />,
              },
              {
                title: "Resultados Acionáveis",
                desc: "Transforme PDFs em decisões estratégicas em minutos.",
                icon: <Clock className="h-6 w-6 text-emerald-300" />,
              },
            ].map((benefit) => (
              <div key={benefit.title} className="soft-panel p-7">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800">{benefit.icon}</div>
                <h3 className="mb-2 text-xl font-bold text-slate-100">{benefit.title}</h3>
                <p className="text-slate-300">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="planos" className="py-24">
        <div className="container mx-auto px-4 text-center">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.18em] text-slate-300">
            <Plug className="h-4 w-4" /> MODELOS FLEXÍVEIS DE COBRANÇA
          </span>
          <h2 className="mb-4 text-3xl font-extrabold text-slate-100 lg:text-4xl">Escolha o Modelo Ideal para seu Negócio</h2>
          <p className="mb-14 text-lg text-slate-300">Pay-per-use, assinatura mensal ou soluções enterprise personalizadas</p>

          <div className="grid gap-6 md:grid-cols-3">
            {pricing.map((plan) => (
              <PricingCard
                key={plan.title}
                {...plan}
                onCtaClick={() => {
                  if (plan.title === "Enterprise") {
                    openWhatsApp();
                    return;
                  }
                  goToRegister(plan.title);
                }}
              />
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 bg-[#0a192f] py-12 text-slate-400">
        <div className="container mx-auto grid gap-8 px-4 md:grid-cols-4">
          <div>
            <div className="mb-4 flex items-center gap-2 text-white">
              <Scale className="h-6 w-6 text-blue-500" />
              <span className="text-xl font-bold tracking-tight">LexScale</span>
            </div>
            <p className="text-sm">Transformando documentos jurídicos em dados acionáveis com Inteligência Artificial.</p>
          </div>
          <div>
            <h4 className="mb-4 font-bold text-white">Soluções</h4>
            <ul className="space-y-2 text-sm">
              <li>Automação de Documentos</li>
              <li>Extração de Dados</li>
              <li>Análise Jurídica</li>
              <li>API de Integração</li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 font-bold text-white">Recursos</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  className="transition-colors hover:text-cyan-300"
                  href="https://platform.openai.com/docs/api-reference"
                  target="_blank"
                  rel="noreferrer"
                >
                  Documentação
                </a>
              </li>
              <li>Casos de Uso</li>
              <li>
                <Link href="/termos" className="transition-colors hover:text-cyan-300">
                  Termos de Uso
                </Link>
              </li>
              <li>
                <Link href="/privacidade" className="transition-colors hover:text-cyan-300">
                  Política de Privacidade
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 font-bold text-white">Contato</h4>
            <ul className="space-y-2 text-sm">
              <li>contato@lexscale.ai</li>
              <li>(34) 99232-2275</li>
            </ul>
          </div>
        </div>
        <div className="container mx-auto mt-12 border-t border-slate-800 px-4 pt-8 text-center text-sm">
          © 2026 LexScale. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}

type PricingCardProps = {
  title: string;
  desc: string;
  price: string;
  features: string[];
  highlighted: boolean;
  cta: string;
  onCtaClick: () => void;
};

function PricingCard({ title, desc, price, features, highlighted, cta, onCtaClick }: PricingCardProps) {
  return (
    <article
      className={`relative rounded-3xl p-7 text-left transition-transform duration-300 hover:-translate-y-1 ${highlighted
          ? "bg-gradient-to-br from-blue-700 to-blue-600 text-white shadow-2xl shadow-blue-900/25"
          : "soft-panel text-slate-100"
        }`}
    >
      {highlighted ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-yellow-400 px-3 py-1 text-xs font-black uppercase tracking-wider text-yellow-900">
          Mais Popular
        </div>
      ) : null}

      <h3 className="mb-2 text-2xl font-bold">{title}</h3>
      <p className={`mb-6 text-sm ${highlighted ? "text-blue-100" : "text-slate-300"}`}>{desc}</p>

      <div className="mb-6">
        <span className="text-4xl font-extrabold">{price}</span>
        {price !== "Customizado" ? <span className={`text-sm ${highlighted ? "text-blue-100" : "text-slate-300"}`}>/mês</span> : null}
      </div>

      <ul className="mb-8 space-y-4">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-sm">
            <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${highlighted ? "text-blue-200" : "text-emerald-400"}`} />
            {feature}
          </li>
        ))}
      </ul>

      <Button
        onClick={onCtaClick}
        className={`h-12 w-full rounded-full text-sm font-extrabold ${highlighted ? "bg-slate-100 text-blue-700 hover:bg-white" : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
          }`}
      >
        {cta}
      </Button>
    </article>
  );
}
