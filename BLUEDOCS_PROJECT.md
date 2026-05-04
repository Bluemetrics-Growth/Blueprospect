# BlueDocs Prospecting System
### BlueMetrics — Growth Engineering

> Sistema multi-agêntico de prospecção para o produto **BlueDocs** (Análise Inteligente de Documentos com IA).  
> Orquestrado por **Claude Code** · IDE: **Antigravity** · Interface: **Google Stitch**

---

## Status do setup

| Item | Status |
|---|---|
| Claude API | ✅ configurado |
| Apollo.io | ✅ configurado |
| HubSpot | ✅ configurado |
| Supabase | ✅ projeto criado |
| Evolution API (WhatsApp) | ⬜ configurar |
| Google Sheets API | ✅ não necessário — lista já processada |
| Antigravity + Claude Code | ✅ funcionando |

---

## Sobre o produto que estamos prospectando

**BlueDocs** é uma solução da BlueMetrics que transforma documentos em respostas e automação usando GenAI + RAG.

**Casos de uso por vertical:**

| Vertical | Dor principal | Argumento BlueDocs |
|---|---|---|
| Healthcare | Contratos de convênio, compliance ANVISA/ANS, auditoria | Reduz 80% do tempo de análise documental |
| Financial | Análise manual de garantias, crédito, compliance BACEN | Elimina erro humano, 100% de cobertura |
| Energy | Contratos regulatórios ANEEL, concessões, editais | Análise automatizada de regulatório |
| Construction | Editais, RFPs, licitações públicas | Responde 10x mais editais com mesmo time |
| Manufacturing | NFs, contratos fornecedor, garantias | Extração automática de dados críticos |

**Oferta de entrada (Piloto):** R$ 50–70k · 4–5 semanas · 1 tipo de documento · até 500 docs

---

## Dados da lista AWS (já processados)

A lista AWS Partners — Norte, Nordeste e Centro-Oeste foi lida e classificada.

| Métrica | Valor |
|---|---|
| Total de empresas na lista | ~7.661 |
| Score A (alta prioridade BlueDocs) | **28 leads** |
| Score B (média prioridade) | **150 leads** |
| Score C (baixa prioridade) | ~7.483 leads |

**Os arquivos `data/aws-leads-score-a.json` e `data/aws-leads-score-b.json` já estão na pasta do projeto.**  
O Agente 01 começa por eles — não precisa reprocessar a lista completa.

**Critério Score A:** Setor alvo BlueDocs (Healthcare / Financial / Energy / Construction / Manufacturing) + `CEI = Elegível` + Faturamento > USD 100M

**Top leads Score A por setor:**
- **Healthcare:** Hospital São Domingos (MA), UDI Hospital (MA), Hospital Santa Júlia (AM), Camed (CE)
- **Energy:** Federal Petróleo (PE), Dislub Combustíveis (PE), Kroma Energia (PE), Usinas Itamarati (MT)
- **Construction:** Dinamos Tecnologia (MA), Ankara Engenharia (BA)
- **Manufacturing:** Indorama Polímeros (PE), FIABESA Guararapes (PE), Amazon Aço (AM)
- **Logistics:** VIABAHIA (BA), Federal Express (PE), Dnata Brasil (PE)

---

## Arquitetura dos agentes

```
data/aws-leads-score-a.json   ← já classificados
data/aws-leads-score-b.json   ← já classificados
         │
         ▼
  [Agente 01] agent-01-segmentation.ts
  Lê o JSON → enriquece com Apollo → gera vertical e dor via Claude API
  → salva em Supabase (tabela leads, status: 'enriched')
         │
         ▼
  [Agente 02] agent-02-hubspot.ts  
  Lê leads 'enriched' → cria empresa + contato + deal no HubSpot
  → aplica tags → atualiza status: 'in_crm'
         │
         ▼
  [Agente 03] agent-03-whatsapp.ts
  Lê leads 'in_crm' score A → gera mensagem personalizada via Claude
  → envia via Evolution API → status: 'contacted'
         │
         ▼
  [Dashboard Google Stitch]
  Conectado ao Supabase → pipeline visual de leads
```

> **Nota:** Consolidamos para 3 agentes. O Agente 01 original foi fundido com o enriquecimento porque a lista já está pré-classificada — não precisamos de um agente só para ler planilha.

---

## Schema do banco (Supabase)

Execute no **SQL Editor** do Supabase:

```sql
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  dominio TEXT,
  uf TEXT,
  cidade TEXT,
  setor TEXT,
  faturamento_usd BIGINT,
  segmento TEXT,
  cei_status TEXT,
  status_aws TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  nome_contato TEXT,
  cargo TEXT,
  email TEXT,
  whatsapp TEXT,
  linkedin_url TEXT,
  vertical_bluedocs TEXT,
  icp_score TEXT,
  dor_primaria TEXT,
  caso_uso_bluedocs TEXT,
  dados_apollo JSONB,
  hubspot_company_id TEXT,
  hubspot_contact_id TEXT,
  hubspot_deal_id TEXT,
  status TEXT DEFAULT 'imported',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  canal TEXT DEFAULT 'whatsapp',
  conteudo TEXT,
  status TEXT,
  reply_content TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Estrutura de arquivos do projeto

```
bluedocs-prospecting/
├── .env                        ← suas chaves de API
├── .gitignore
├── package.json
├── tsconfig.json
│
├── data/
│   ├── aws-leads-score-a.json  ← 28 leads Score A (já na pasta)
│   └── aws-leads-score-b.json  ← 150 leads Score B (já na pasta)
│
├── agents/
│   ├── agent-01-segmentation.ts   ← Apollo + Claude → enriquece + salva Supabase
│   ├── agent-02-hubspot.ts        ← Cria empresa/contato/deal no HubSpot
│   └── agent-03-whatsapp.ts       ← Gera mensagem + Evolution API
│
├── lib/
│   ├── supabase.ts
│   ├── apollo.ts
│   ├── hubspot.ts
│   ├── evolution.ts
│   └── claude.ts
│
├── prompts/
│   ├── pain-mapping.txt           ← prompt de mapeamento de dor
│   └── messages/
│       ├── healthcare.txt
│       ├── financial.txt
│       ├── energy.txt
│       ├── construction.txt
│       └── manufacturing.txt
│
└── scripts/
    ├── run-all.ts                 ← roda os 3 agentes em sequência
    └── run-agent.ts               ← roda agente específico: ts-node scripts/run-agent.ts 1
```

---

## Arquivo .env (preencha com suas chaves)

```bash
# Claude API
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-20250514

# Supabase
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Apollo.io
APOLLO_API_KEY=

# HubSpot
HUBSPOT_ACCESS_TOKEN=

# Evolution API (WhatsApp) — configurar quando tiver a conta
EVOLUTION_API_URL=https://api.evolution-api.com
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=bluedocs-prospecting
```

---

## Como rodar o projeto

```bash
# 1. Instalar dependências (Claude Code faz isso)
npm install

# 2. Rodar Agente 01 em modo teste (5 leads)
npx ts-node scripts/run-agent.ts 1 --limit 5

# 3. Ver resultado no Supabase → Table Editor → leads
# Verificar: campos vertical_bluedocs, icp_score, dor_primaria preenchidos

# 4. Rodar Agente 01 completo (todos os score A)
npx ts-node scripts/run-agent.ts 1

# 5. Rodar Agente 02 (HubSpot)
npx ts-node scripts/run-agent.ts 2

# 6. Rodar Agente 03 (WhatsApp) — só depois de ter Evolution API
npx ts-node scripts/run-agent.ts 3

# Ou rodar tudo de uma vez
npx ts-node scripts/run-all.ts
```

---

## Google Stitch — configuração da interface

Após ter leads no Supabase:

1. Acesse [stitch.google.com](https://stitch.google.com) ou o Google AppSheet
2. Conecte como fonte de dados: **PostgreSQL** (Supabase expõe endpoint direto)
3. Host: `db.xxxxxxxxxxxx.supabase.co` · Port: `5432` · Database: `postgres`
4. Crie as views:
   - **Pipeline de leads** — tabela `leads` filtrada por status
   - **Score A pendentes** — leads `icp_score = 'A'` e `status = 'in_crm'`
   - **Respostas recebidas** — messages com `reply_content IS NOT NULL`

---

## Próximos passos após o MVP

- [ ] Processar os 150 leads Score B
- [ ] Criar webhook Evolution API para capturar respostas automáticas
- [ ] Adicionar abordagem "mini relatório PDF" para leads Score A que não responderam
- [ ] Expandir para novas verticais com fit alto na lista (Retail com volume documental)
- [ ] Fase ABM: Agente recebe ICP como input e chama Apollo para gerar lista nova

---

*BlueMetrics · BlueDocs GTM System · v1.0*
