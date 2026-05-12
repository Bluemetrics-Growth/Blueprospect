import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
dotenv.config()

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'

// Static system context — cached across all mapPain calls (same across all 28 leads)
const SYSTEM_PAIN_MAPPING = `Você é um especialista em vendas B2B de soluções de IA para análise documental.

O produto BlueDocs da BlueMetrics transforma documentos críticos em respostas e automação usando GenAI e RAG (Retrieval-Augmented Generation).

Principais capacidades do BlueDocs:
- Análise automática de contratos comerciais e jurídicos com extração de cláusulas críticas
- Verificação de compliance regulatório (ANVISA, ANS, BACEN, ANEEL, CVM)
- Análise de editais de licitação pública e concursos com checklist automático
- Due diligence documental para fusões, aquisições e crédito
- Gestão e análise de garantias com alertas de vencimento
- Revisão de NFs, contratos de fornecedor e documentos fiscais

Verticais e casos de uso prioritários:
- healthcare: contratos de convênio, compliance ANVISA/ANS, auditoria clínica e de faturamento
- financial: análise de garantias, scoring de crédito, compliance BACEN/CVM, due diligence
- energy: contratos regulatórios ANEEL, editais de concessão, licenças ambientais
- construction: editais públicos, RFPs, licitações, contratos de empreitada
- manufacturing: contratos de fornecedor, NFs, garantias de produto, auditorias de qualidade
- logistics: contratos de frete, ANTT, seguros de carga, compliance aduaneiro
- outros: documentos jurídicos genéricos

Oferta de entrada BlueDocs: Piloto de R$ 50–70k entregue em 4–5 semanas com ROI demonstrável.
ICP primário: empresas com equipes jurídicas, compliance ou financeiras que processam grande volume de documentos.

Sua tarefa: Analisar cada empresa e identificar a dor documental específica e o fit com BlueDocs.
Responda SEMPRE com JSON válido, sem texto adicional, sem markdown, sem backticks.`

export interface PainMapResult {
  vertical_bluedocs: string
  caso_uso_bluedocs: string
  dor_primaria: string
  justificativa_score: string
}

export interface CompanyPainInput {
  nome: string
  setor: string
  faturamento_usd: number
  uf: string
  funcionarios?: number | string
  tecnologias?: string[]
  descricao?: string
  headcount_dept?: Record<string, number>
  eventos_funding?: Array<{ date?: string; type?: string; amount?: string }>
  vagas_detalhadas?: Array<{ title: string; department?: string }>
}

export async function mapPain(company: CompanyPainInput): Promise<PainMapResult> {
  const templatePath = path.join(__dirname, '../prompts/pain-mapping.txt')
  const template = fs.readFileSync(templatePath, 'utf-8')

  const headcountStr = company.headcount_dept && Object.keys(company.headcount_dept).length
    ? Object.entries(company.headcount_dept).map(([d, n]) => `${d}: ${n}`).join(', ')
    : 'não disponível'

  const fundingStr = company.eventos_funding?.length
    ? company.eventos_funding.map(e => [e.type, e.date, e.amount].filter(Boolean).join(' ')).join(' | ')
    : 'nenhum identificado'

  const vagasStr = company.vagas_detalhadas?.length
    ? company.vagas_detalhadas.map(v => v.department ? `${v.title} (${v.department})` : v.title).join(', ')
    : 'não identificadas'

  const prompt = template
    .replace('{nome}', company.nome)
    .replace('{setor}', company.setor)
    .replace('{faturamento_usd}', String(company.faturamento_usd))
    .replace('{uf}', company.uf || 'não informado')
    .replace('{funcionarios}', String(company.funcionarios || 'não informado'))
    .replace('{descricao}', company.descricao || 'não disponível')
    .replace('{headcount_dept}', headcountStr)
    .replace('{tecnologias}', (company.tecnologias || []).join(', ') || 'não identificadas')
    .replace('{vagas_detalhadas}', vagasStr)
    .replace('{eventos_funding}', fundingStr)

  const attempt = async (): Promise<PainMapResult> => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: [
        {
          type: 'text',
          text: SYSTEM_PAIN_MAPPING,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    return JSON.parse(text)
  }

  try {
    return await attempt()
  } catch {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      return await attempt()
    } catch {
      return { vertical_bluedocs: '', caso_uso_bluedocs: '', dor_primaria: '', justificativa_score: '' }
    }
  }
}

export async function generateMessage(
  lead: { nome_contato?: string; vertical_bluedocs?: string; dor_primaria?: string },
  company: { nome: string; uf?: string; cidade?: string }
): Promise<string> {
  const vertical = lead.vertical_bluedocs || 'outros'
  const promptsDir = path.join(__dirname, '../prompts/messages')
  let templatePath = path.join(promptsDir, `${vertical}.txt`)

  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(promptsDir, 'outros.txt')
  }

  let template = fs.readFileSync(templatePath, 'utf-8')
  const estado = company.uf || company.cidade || 'Brasil'

  template = template
    .replace('{nome_contato}', lead.nome_contato || 'time')
    .replace('{nome_empresa}', company.nome)
    .replace('{estado}', estado)
    .replace('{dor_primaria}', lead.dor_primaria || '')

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `Você é um SDR especialista em vendas B2B de IA. Adapte a mensagem abaixo para WhatsApp, mantendo tom informal e direto, máximo 3 parágrafos curtos. Retorne APENAS a mensagem final, sem introdução ou explicação:\n\n${template}`,
      },
    ],
  })

  return response.content[0].type === 'text' ? response.content[0].text.trim() : template
}
