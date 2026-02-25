# LexScale - Fluxo de Upload e Inteligência do Dashboard

Documento institucional para investidores

Data de referência: fevereiro de 2026

## Sumário
- [Resumo Executivo](#resumo-executivo)
- [Objetivo e Escopo](#objetivo-e-escopo)
- [Arquitetura Funcional dos Dados](#arquitetura-funcional-dos-dados)
- [Fluxo de Upload e Processamento](#fluxo-de-upload-e-processamento)
- [Leitura Completa do Dashboard](#leitura-completa-do-dashboard)
- [Botões, Controles e Filtros](#botoes-controles-e-filtros)
- [Como os Indicadores São Formulados](#como-os-indicadores-sao-formulados)
- [Critérios de Qualidade e Confiabilidade](#criterios-de-qualidade-e-confiabilidade)
- [Limitações Atuais](#limitacoes-atuais)
- [Tese de Valor para Investimento](#tese-de-valor-para-investimento)

## Resumo Executivo
A LexScale transforma documentos jurídicos em inteligência acionável por meio de um fluxo integrado de:

1. ingestão documental;
2. extração estruturada;
3. análise por IA com monitoramento de status;
4. consolidação analítica em dashboard com benchmark, simulações e alertas;
5. trilha de auditoria por upload.

Em termos de negócio, o produto entrega simultaneamente eficiência operacional e suporte à decisão estratégica, com rastreabilidade explícita da origem de cada indicador apresentado.

## Objetivo e Escopo
Este documento descreve, em linguagem executiva e precisa:

- o funcionamento do fluxo de upload;
- a geração e atualização dos dados;
- o papel de cada aba, card, botão e filtro do dashboard;
- a forma de leitura dos indicadores por um usuário final;
- os critérios de avaliação de confiabilidade dos resultados.

## Arquitetura Funcional dos Dados
A aplicação opera sobre três camadas complementares.

### 1) Camada Interna (dados proprietários)
- uploads do usuário;
- campos extraídos do documento;
- resultados de análise da IA por caso;
- histórico de status, progresso e tentativas.

### 2) Camada Externa (dados públicos)
- fontes públicas sincronizadas (incluindo conectores já habilitados e fontes adicionais cadastráveis);
- registros usados para comparação de mercado, identificação de similares e enriquecimento de contexto.

### 3) Camada Analítica
- cálculo de probabilidades e scores;
- benchmark interno vs. mercado;
- simulações de cenários;
- alertas estratégicos;
- narrativa executiva orientada à decisão.

Resultado funcional: o usuário visualiza uma leitura unificada entre o seu acervo, sinais de mercado e projeções estratégicas.

## Fluxo de Upload e Processamento

### Visão geral do fluxo
| Etapa | Ação do usuário | Processo do sistema | Resultado visível |
|---|---|---|---|
| Seleção de arquivo | Escolhe um documento no bloco de upload | Leitura inicial do arquivo | Arquivo anexado no formulário |
| Extração prévia | Aguarda extração automática | Parser extrai campos básicos | Campos pré-preenchidos (quando disponíveis) |
| Validação humana | Ajusta campos manualmente | Formulário consolida entrada final | Dados prontos para envio |
| Envio | Clica em `Enviar para Analise` | Documento e caso são persistidos | Novo caso aparece em monitoramento |
| Processamento IA | Acompanha progresso | Pipeline assíncrono executa análise | Status e progresso atualizados em tela |
| Publicação | Nenhuma ação adicional | Indicadores são gravados no banco | Dashboard e histórico refletindo resultados |

### Extração de dados no upload
Campos tipicamente extraídos:
- número do processo;
- tribunal;
- juiz;
- tipo de ação;
- valor da causa;
- fatos-chave e prazos (quando identificáveis).

Observação relevante: documentos de imagem podem ter extração limitada na ausência de OCR dedicado, dependendo da qualidade e do formato do arquivo.

### Estados de processamento da IA
| Estado | Significado operacional | Implicação para o usuário |
|---|---|---|
| `queued` | Caso enfileirado | Aguardando processamento |
| `processing` | Análise em execução | Indicadores ainda em formação |
| `completed` | Processamento concluído | Indicadores prontos para uso |
| `failed_retryable` | Falha com retentativa automática | Sistema tentará novo processamento |
| `failed` | Falha final | Requer ação de reprocessamento |
| `manual_review` | Caso exige revisão manual | Uso cauteloso até correção |

### Reprocessamento
Quando o caso está em estado de falha, o botão `Reprocessar AI` reenvia o item para a fila analítica. Esse mecanismo reduz perda operacional e aumenta taxa de conclusão sem reupload do documento.

## Leitura Completa do Dashboard
O dashboard está estruturado em cinco abas funcionais.

### 1) Visão Geral
Objetivo: apresentar a leitura executiva do recorte atual.

**Cards principais**
- Probabilidade de Êxito
- Probabilidade de Acordo
- Tempo Estimado de Decisão

**Blocos complementares**
- Scores do Processo (Risco, Chance de Êxito, Chance de Acordo, Complexidade)
- Radar do Processo (comparação processo atual vs. cluster)
- Insights Narrativos por IA
- Atividade Semanal
- Prazos Críticos

**Interpretação**
- visão rápida de performance, risco e prazo;
- base para priorização imediata.

### 2) Inteligência Estratégica
Objetivo: comparar comportamento interno com sinais de mercado.

**Blocos**
- Processos Similares
- Heatmap de comportamento judicial
- Benchmark vs. Mercado

**Interpretação**
- identifica padrões de desfecho;
- contextualiza o desempenho do usuário frente ao mercado;
- apoia decisões táticas por tipo de ação, tribunal e perfil de caso.

### 3) Simulações Avançadas
Objetivo: suportar decisão por cenário.

**Blocos**
- Gêmeo Digital (contexto analítico consolidado)
- Cenários A, B e C
- Comparativo de Impacto (melhor valor, menor risco, maior velocidade)

**Interpretação**
- torna explícito o trade-off entre retorno potencial, risco e tempo;
- orienta escolha de estratégia com critério objetivo.

### 4) Alertas Estratégicos
Objetivo: transformar sinais analíticos em fila de ação.

**Blocos**
- contadores por severidade/categoria;
- lista detalhada de alertas com ações de gestão.

**Interpretação**
- priorização operacional contínua;
- redução de risco de inação em eventos críticos.

### 5) Histórico de Uploads
Objetivo: fornecer trilha de auditoria ponta a ponta.

**Por item de histórico, o usuário visualiza**
- dados do arquivo e do processo;
- status e progresso de IA;
- dados efetivamente usados na análise;
- resultado da extração automática;
- resultado da análise IA (probabilidades, scores e tempo);
- conclusão textual da IA para aquele documento.

**Interpretação**
- camada central de transparência e governança;
- facilita validação, revisão e confiança institucional.

## Botões, Controles e Filtros

### Botões de maior impacto
| Botão | Função | Valor para o usuário |
|---|---|---|
| `Enviar para Analise` | Dispara ingestão e análise do caso | Converte documento em indicadores |
| `Sincronizar APIs Públicas` | Atualiza bases externas | Melhora benchmark e similaridade |
| `Salvar Fonte` | Cadastra/atualiza fonte pública | Expande cobertura de dados |
| `Reprocessar AI` | Reenfileira caso com falha | Recupera processamento sem novo upload |
| `Aplicar Filtros` | Recalcula o dashboard no recorte escolhido | Controle explícito da análise |
| `Limpar filtros` (histórico/alertas) | Remove filtros locais | Retorno rápido à visão completa |

### Filtros globais do dashboard
- Tribunal
- Juiz
- Tipo de Ação
- Faixa de Valor
- Período

Funcionamento:
- os filtros são ajustados no painel de controle;
- o recálculo do dashboard ocorre ao confirmar em `Aplicar Filtros`.

Efeito prático:
- todos os módulos passam a refletir o mesmo recorte analítico;
- o usuário evita interpretações fora de contexto.

## Como os Indicadores São Formulados

### Probabilidade de êxito
Derivada da combinação entre:
- probabilidades dos casos internos;
- sinais de sucesso identificados em registros públicos.

### Probabilidade de acordo
Derivada da combinação entre:
- probabilidade de acordo dos casos internos;
- eventos de acordo observados no conjunto público.

### Tempo estimado de decisão
Baseado em:
- estimativas internas de tramitação;
- durações observadas em dados públicos (normalizadas para meses).

### Scores de risco e complexidade
Prioridade de cálculo:
1. usa scores já produzidos na análise dos casos;
2. quando necessário, aplica fallback estatístico com base no próprio recorte.

### Benchmark vs mercado
Compara o recorte do usuário com:
- base global interna;
- registros públicos pertinentes ao mesmo filtro aplicado.

### Simulações
Projetam cenários sobre uma linha de base do recorte atual para estimar:
- probabilidade de sucesso;
- valor esperado;
- tempo provável;
- exposição a risco.

### Alertas
Alertas são gerados por regras analíticas e priorizados por categoria, permitindo:
- identificar urgências;
- sinalizar oportunidades;
- registrar eventos informativos para acompanhamento.

## Critérios de Qualidade e Confiabilidade
Para leitura responsável dos dados, recomenda-se avaliar:

1. **Qualidade da entrada**
- consistência dos campos extraídos;
- aderência dos dados ao documento original.

2. **Consistência interna dos indicadores**
- coerência entre probabilidade, risco, complexidade e tempo.

3. **Coerência de contexto**
- validação do filtro aplicado antes de interpretar benchmark e cenário.

4. **Maturidade amostral**
- atenção a recortes com baixa observação ou indicadores `N/D`.

5. **Estado de processamento**
- uso preferencial de casos com status `completed` para decisão final.

## Limitações Atuais
- extração de imagem pode variar sem OCR dedicado;
- documentos com estrutura textual precária reduzem precisão de extração;
- benchmark depende da profundidade e atualização das fontes públicas;
- casos em falha/revisão não devem ser tratados como evidência definitiva;
- alertas do dashboard e alertas persistidos têm finalidades complementares e devem ser lidos em conjunto.

## Tese de Valor para Investimento
Sob ótica de investimento, a plataforma demonstra três vetores de valor.

### 1) Eficiência operacional mensurável
- reduz tempo de triagem e consolidação manual;
- transforma fluxo jurídico em pipeline monitorável.

### 2) Capacidade analítica de decisão
- não se limita à extração documental;
- entrega camada de inteligência com benchmark, risco e simulação.

### 3) Base de escala e retenção
- cada novo upload fortalece histórico e qualidade analítica;
- cada sincronização pública amplia cobertura comparativa;
- a trilha de auditoria reforça governança e confiança de uso recorrente.

## Conclusão
A LexScale combina automação documental, modelagem analítica e governança de dados em uma experiência única de decisão jurídica. O desenho atual já evidencia potencial de escala, com ganhos claros em eficiência, previsibilidade e confiança operacional.
