import * as dotenv from 'dotenv'
dotenv.config()

import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../lib/supabase'
import type { Lead, Company } from '../lib/supabase'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'

type LeadWithCompany = Lead & { companies: Company }

// ─── HubSpot Tool Implementations (via native fetch — sem axios, sem SDK) ────

async function hsRequest(method: string, path: string, body?: object): Promise<any> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  const resp = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await resp.text()
  let data: any = {}
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  if (!resp.ok) throw new Error(`HubSpot ${resp.status}: ${data.message || text}`)
  return data
}

async function hsSearchCompany(domain: string): Promise<{ id: string; name: string } | null> {
  const data = await hsRequest('POST', '/crm/v3/objects/companies/search', {
    filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
    properties: ['name', 'domain'],
    limit: 1,
  })
  if (data.results && data.results.length > 0) {
    return { id: data.results[0].id, name: data.results[0].properties?.name }
  }
  return null
}

async function hsCreateCompany(props: { name: string; domain?: string; industry?: string; city?: string; state?: string }): Promise<string> {
  const data = await hsRequest('POST', '/crm/v3/objects/companies', {
    properties: {
      name: props.name,
      domain: props.domain || '',
      industry: props.industry || '',
      city: props.city || '',
      state: props.state || '',
    },
  })
  return data.id
}

async function hsCreateContact(props: { name: string; jobtitle?: string }, companyId: string): Promise<string> {
  const parts = props.name.trim().split(' ')
  const data = await hsRequest('POST', '/crm/v3/objects/contacts', {
    properties: {
      firstname: parts[0] || '',
      lastname: parts.slice(1).join(' ') || '',
      jobtitle: props.jobtitle || '',
    },
    associations: [
      {
        to: { id: companyId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }],
      },
    ],
  })
  return data.id
}

async function hsCreateDeal(dealname: string, companyId: string, contactId?: string): Promise<string> {
  const associations: any[] = [
    {
      to: { id: companyId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }],
    },
  ]
  if (contactId) {
    associations.push({
      to: { id: contactId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
    })
  }
  const data = await hsRequest('POST', '/crm/v3/objects/deals', {
    properties: {
      dealname,
      pipeline: 'default',      // Pipeline BlueMetrics
      dealstage: '90169196',    // Stage: Lead (primeiro estágio do Pipeline BlueMetrics)
    },
    associations,
  })
  return data.id
}

async function hsAddNote(dealId: string, noteBody: string): Promise<string> {
  const data = await hsRequest('POST', '/crm/v3/objects/notes', {
    properties: {
      hs_note_body: noteBody,
      hs_timestamp: new Date().toISOString(),
    },
    associations: [
      {
        to: { id: dealId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }],
      },
    ],
  })
  return data.id
}

// ─── Agentic Loop ─────────────────────────────────────────────────────────────

const HS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'hubspot_search_company',
    description: 'Busca empresa existente no HubSpot pelo domínio para evitar duplicatas.',
    input_schema: {
      type: 'object' as const,
      properties: { domain: { type: 'string', description: 'Domínio da empresa' } },
      required: ['domain'],
    },
  },
  {
    name: 'hubspot_create_company',
    description: 'Cria empresa no HubSpot CRM.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name:     { type: 'string' },
        domain:   { type: 'string' },
        industry: { type: 'string' },
        city:     { type: 'string' },
        state:    { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'hubspot_create_contact',
    description: 'Cria contato no HubSpot e associa à empresa.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name:       { type: 'string', description: 'Nome completo do contato' },
        jobtitle:   { type: 'string' },
        company_id: { type: 'string', description: 'ID da empresa no HubSpot' },
      },
      required: ['name', 'company_id'],
    },
  },
  {
    name: 'hubspot_create_deal',
    description: 'Cria deal no pipeline padrão do HubSpot.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dealname:   { type: 'string' },
        company_id: { type: 'string' },
        contact_id: { type: 'string', description: 'Opcional — ID do contato para associar' },
      },
      required: ['dealname', 'company_id'],
    },
  },
  {
    name: 'hubspot_add_note',
    description: 'Adiciona nota ao deal no HubSpot.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deal_id:   { type: 'string' },
        note_body: { type: 'string' },
      },
      required: ['deal_id', 'note_body'],
    },
  },
]

async function processCRMForLead(lead: LeadWithCompany): Promise<{
  companyId?: string
  contactId?: string
  dealId?: string
}> {
  const company = lead.companies
  const ids: { companyId?: string; contactId?: string; dealId?: string } = {}

  const executeTool = async (name: string, input: any): Promise<any> => {
    switch (name) {
      case 'hubspot_search_company': {
        const result = await hsSearchCompany(input.domain)
        if (result) ids.companyId = result.id
        return result || { found: false }
      }
      case 'hubspot_create_company': {
        const id = await hsCreateCompany(input)
        ids.companyId = id
        return { id, created: true }
      }
      case 'hubspot_create_contact': {
        const id = await hsCreateContact({ name: input.name, jobtitle: input.jobtitle }, input.company_id)
        ids.contactId = id
        return { id, created: true }
      }
      case 'hubspot_create_deal': {
        const id = await hsCreateDeal(input.dealname, input.company_id, input.contact_id)
        ids.dealId = id
        return { id, created: true }
      }
      case 'hubspot_add_note': {
        const id = await hsAddNote(input.deal_id, input.note_body)
        return { id, created: true }
      }
      default:
        return { error: `Ferramenta desconhecida: ${name}` }
    }
  }

  const systemPrompt = `Você é um assistente de automação de CRM. Seu trabalho é criar registros no HubSpot para leads de vendas.
Para cada lead, execute EXATAMENTE esta sequência:
1. Buscar empresa pelo domínio (para evitar duplicatas)
2. Se não encontrar, criar a empresa; se encontrar, usar o ID existente
3. Se houver contato disponível (nome_contato), criar o contato associado à empresa
4. Criar o deal com o nome especificado, associado à empresa (e ao contato se criado)
5. Adicionar nota ao deal com o campo dor_primaria
Confirme quando todas as etapas estiverem concluídas.`

  const userPrompt = `Crie os registros CRM para este lead:

Empresa: ${company.nome}
Domínio: ${company.dominio || 'desconhecido'}
Setor: ${company.setor || ''}
Cidade: ${company.cidade || ''}
Estado: ${company.uf || ''}
Contato: ${lead.nome_contato || 'não disponível'}
Cargo: ${lead.cargo || 'não disponível'}
Nome do Deal: "${company.nome} — BlueDocs Piloto"
Dor primária: ${lead.dor_primaria || ''}

Execute todos os passos na ordem correta.`

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }]
  let maxIterations = 8

  while (maxIterations-- > 0) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      tools: HS_TOOLS,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') break

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          try {
            const result = await executeTool(block.name, block.input)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
          } catch (err: any) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Erro: ${err.message}`, is_error: true })
          }
        }
      }

      messages.push({ role: 'user', content: toolResults })
    }
  }

  return ids
}

// ─── Main Agent ───────────────────────────────────────────────────────────────

export async function runAgent(options: { limit?: number } = {}): Promise<void> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token || token === 'COLOQUE_SEU_TOKEN_AQUI') {
    console.error('[Agente 02] HUBSPOT_ACCESS_TOKEN não configurado. Defina o token no .env antes de executar.')
    process.exit(1)
  }

  const query = supabase
    .from('leads')
    .select('*, companies(*)')
    .eq('status', 'enriched')

  const { data: leads, error } = await query

  if (error) {
    console.error('[Supabase] Erro ao buscar leads:', error.message)
    return
  }

  if (!leads || leads.length === 0) {
    console.log('[Agente 02] Nenhum lead com status "enriched" encontrado.')
    return
  }

  const batch = (options.limit ? leads.slice(0, options.limit) : leads) as LeadWithCompany[]
  let created = 0

  console.log(`[Agente 02] Processando ${batch.length} leads no HubSpot...\n`)

  for (const lead of batch) {
    if (!lead.companies) {
      console.warn(`⚠ Lead ${lead.id} sem empresa associada, pulando`)
      continue
    }

    try {
      const { companyId, contactId, dealId } = await processCRMForLead(lead)

      const { error: updateError } = await supabase
        .from('leads')
        .update({
          hubspot_company_id: companyId || null,
          hubspot_contact_id: contactId || null,
          hubspot_deal_id:    dealId    || null,
          status: 'in_crm',
        })
        .eq('id', lead.id!)

      if (updateError) {
        console.error(`[Supabase] Erro ao atualizar lead ${lead.companies.nome}:`, updateError.message)
        continue
      }

      created++
      console.log(`✓ ${lead.companies.nome} → HubSpot criado (company: ${companyId}, deal: ${dealId})`)
    } catch (err: any) {
      console.error(`[Agente 02] Erro em ${lead.companies?.nome}:`, err?.stack || err.message)
    }
  }

  console.log(`\nAgente 02 concluído: ${created} leads no CRM`)
}

if (require.main === module) {
  runAgent().catch(console.error)
}
