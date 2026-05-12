import * as dotenv from 'dotenv'
dotenv.config()

import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../lib/supabase'
import type { Lead, Company } from '../lib/supabase'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'

type LeadWithCompany = Lead & { companies: Company }

// ─── Industry mapper (setor → HubSpot enum) ──────────────────────────────────

const INDUSTRY_MAP: Record<string, string> = {
  retail:                 'RETAIL',
  'consumer goods':       'CONSUMER_GOODS',
  agriculture:            'FARMING',
  manufacturing:          'MECHANICAL_OR_INDUSTRIAL_ENGINEERING',
  'software & internet':  'INTERNET',
  'professional services':'MANAGEMENT_CONSULTING',
  telecommunications:     'TELECOMMUNICATIONS',
  education:              'EDUCATION_MANAGEMENT',
  healthcare:             'HOSPITAL_HEALTH_CARE',
  financial:              'FINANCIAL_SERVICES',
  energy:                 'OIL_ENERGY',
  construction:           'CONSTRUCTION',
  logistics:              'LOGISTICS_AND_SUPPLY_CHAIN',
}

function mapIndustry(setor: string): string {
  return INDUSTRY_MAP[setor.toLowerCase()] || ''
}

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

async function hsCreateCompany(props: {
  name: string
  domain?: string
  industry?: string
  city?: string
  state?: string
  annualrevenue?: number
  numberofemployees?: number
}): Promise<string> {
  const properties: Record<string, any> = {
    name:     props.name,
    domain:   props.domain    || '',
    industry: props.industry  || '',
    city:     props.city      || '',
    state:    props.state     || '',
  }
  if (props.annualrevenue)     properties.annualrevenue    = props.annualrevenue
  if (props.numberofemployees) properties.numberofemployees = props.numberofemployees
  const data = await hsRequest('POST', '/crm/v3/objects/companies', { properties })
  return data.id
}

async function hsSearchContact(email: string): Promise<{ id: string } | null> {
  const data = await hsRequest('POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    properties: ['email', 'firstname', 'lastname'],
    limit: 1,
  })
  if (data.results && data.results.length > 0) return { id: data.results[0].id }
  return null
}

async function hsCreateContact(props: { name: string; jobtitle?: string; email?: string; phone?: string }, companyId: string): Promise<string> {
  const parts = props.name.trim().split(' ')
  const properties: Record<string, any> = {
    firstname: parts[0] || '',
    lastname:  parts.slice(1).join(' ') || '',
    jobtitle:  props.jobtitle || '',
  }
  if (props.email) properties.email = props.email
  if (props.phone) properties.phone = props.phone
  const data = await hsRequest('POST', '/crm/v3/objects/contacts', {
    properties,
    associations: [
      {
        to: { id: companyId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }],
      },
    ],
  })
  return data.id
}

async function hsAssociateContactToDeal(contactId: string, dealId: string): Promise<void> {
  await hsRequest(
    'PUT',
    `/crm/v4/objects/contacts/${contactId}/associations/deals/${dealId}`,
    [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 4 }],
  )
}

async function hsCreateDeal(
  dealname: string,
  companyId: string,
  contactId?: string,
  amount?: number,
  custom?: { faturamento?: string; receita_anual?: string; n_de_funcionarios?: string; segmento_da_empresa?: string }
): Promise<string> {
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
  const dealProps: Record<string, any> = {
    dealname,
    pipeline:  '898314414',   // Blue Prospector
    dealstage: '1358852620',  // Lead
  }
  if (amount)                         dealProps.amount              = amount
  if (custom?.faturamento)            dealProps.faturamento          = custom.faturamento
  if (custom?.receita_anual)          dealProps.receita_anual        = custom.receita_anual
  if (custom?.n_de_funcionarios)      dealProps.n_de_funcionarios    = custom.n_de_funcionarios
  if (custom?.segmento_da_empresa)    dealProps.segmento_da_empresa  = custom.segmento_da_empresa
  const data = await hsRequest('POST', '/crm/v3/objects/deals', {
    properties: dealProps,
    associations,
  })
  return data.id
}

async function hsUpdateCompany(companyId: string, props: {
  industry?: string
  annualrevenue?: number
  numberofemployees?: number
}): Promise<void> {
  const properties: Record<string, any> = {}
  if (props.industry)          properties.industry          = props.industry
  if (props.annualrevenue)     properties.annualrevenue     = props.annualrevenue
  if (props.numberofemployees) properties.numberofemployees = props.numberofemployees
  if (Object.keys(properties).length === 0) return
  await hsRequest('PATCH', `/crm/v3/objects/companies/${companyId}`, { properties })
}

async function hsUpdateDeal(dealId: string, props: {
  amount?: number
  faturamento?: string
  receita_anual?: string
  n_de_funcionarios?: string
  segmento_da_empresa?: string
}): Promise<void> {
  const properties: Record<string, any> = {}
  if (props.amount)              properties.amount              = props.amount
  if (props.faturamento)         properties.faturamento         = props.faturamento
  if (props.receita_anual)       properties.receita_anual       = props.receita_anual
  if (props.n_de_funcionarios)   properties.n_de_funcionarios   = props.n_de_funcionarios
  if (props.segmento_da_empresa) properties.segmento_da_empresa = props.segmento_da_empresa
  if (Object.keys(properties).length === 0) return
  await hsRequest('PATCH', `/crm/v3/objects/deals/${dealId}`, { properties })
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
        name:                { type: 'string' },
        domain:              { type: 'string' },
        industry:            { type: 'string', description: 'Valor enum HubSpot (ex: RETAIL, CONSUMER_GOODS, FARMING)' },
        city:                { type: 'string' },
        state:               { type: 'string' },
        annualrevenue:       { type: 'number', description: 'Receita anual em USD' },
        numberofemployees:   { type: 'number', description: 'Número de funcionários' },
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
        email:      { type: 'string', description: 'Email do contato (se disponível)' },
        phone:      { type: 'string', description: 'Telefone do contato (se disponível)' },
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
        dealname:             { type: 'string' },
        company_id:           { type: 'string' },
        contact_id:           { type: 'string', description: 'Opcional — ID do contato para associar' },
        amount:               { type: 'number', description: 'Faturamento anual da empresa em USD (numérico)' },
        faturamento:          { type: 'string', description: 'Faturamento formatado, ex: "USD 423.752.992"' },
        receita_anual:        { type: 'string', description: 'Receita anual formatada, ex: "USD 423.752.992"' },
        n_de_funcionarios:    { type: 'string', description: 'Número de funcionários, ex: "450"' },
        segmento_da_empresa:  { type: 'string', description: 'Setor da empresa, ex: "Consumer Goods"' },
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
  {
    name: 'hubspot_search_contact',
    description: 'Busca contato existente no HubSpot pelo email para evitar duplicatas.',
    input_schema: {
      type: 'object' as const,
      properties: { email: { type: 'string', description: 'Email do contato' } },
      required: ['email'],
    },
  },
  {
    name: 'hubspot_associate_contact_to_deal',
    description: 'Associa um contato (existente ou recém-criado) a um deal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact_id: { type: 'string', description: 'ID do contato no HubSpot' },
        deal_id:    { type: 'string', description: 'ID do deal no HubSpot' },
      },
      required: ['contact_id', 'deal_id'],
    },
  },
]

async function processCRMForLead(lead: LeadWithCompany): Promise<{
  companyId?: string
  contactId?: string
  allContactIds?: string[]
  dealId?: string
  updated?: boolean
}> {
  const company = lead.companies
  const ids: { companyId?: string; contactId?: string; allContactIds: string[]; dealId?: string; updated?: boolean } = { allContactIds: [] }

  // ── Fast-path: update existing HubSpot records ──────────────────────────────
  if (lead.hubspot_deal_id) {
    const employeeCount = (lead.dados_apollo as any)?.employee_count
    const hsIndustry = mapIndustry(company.setor || '')
    const faturamentoFormatted = company.faturamento_usd
      ? `USD ${Number(company.faturamento_usd).toLocaleString('en-US')}`
      : undefined

    if (lead.hubspot_company_id) {
      await hsUpdateCompany(lead.hubspot_company_id, {
        industry:          hsIndustry || undefined,
        annualrevenue:     company.faturamento_usd || undefined,
        numberofemployees: employeeCount || undefined,
      })
    }

    await hsUpdateDeal(lead.hubspot_deal_id, {
      amount:              company.faturamento_usd || undefined,
      faturamento:         faturamentoFormatted,
      receita_anual:       faturamentoFormatted,
      n_de_funcionarios:   employeeCount ? String(employeeCount) : undefined,
      segmento_da_empresa: company.setor || undefined,
    })

    if (lead.dor_primaria) {
      await hsAddNote(lead.hubspot_deal_id, `[Atualização] ${lead.dor_primaria}`)
    }

    return {
      companyId: lead.hubspot_company_id || undefined,
      contactId: lead.hubspot_contact_id || undefined,
      dealId:    lead.hubspot_deal_id,
      updated:   true,
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const executeTool = async (name: string, input: any): Promise<any> => {
    switch (name) {
      case 'hubspot_search_company': {
        const result = await hsSearchCompany(input.domain)
        if (result) ids.companyId = result.id
        return result || { found: false }
      }
      case 'hubspot_create_company': {
        const id = await hsCreateCompany({
          ...input,
          industry: input.industry ? input.industry : undefined,
        })
        ids.companyId = id
        return { id, created: true }
      }
      case 'hubspot_search_contact': {
        const result = input.email ? await hsSearchContact(input.email) : null
        if (result) {
          if (!ids.contactId) ids.contactId = result.id
          if (!ids.allContactIds.includes(result.id)) ids.allContactIds.push(result.id)
        }
        return result || { found: false }
      }
      case 'hubspot_create_contact': {
        const id = await hsCreateContact(
          { name: input.name, jobtitle: input.jobtitle, email: input.email, phone: input.phone },
          input.company_id,
        )
        if (!ids.contactId) ids.contactId = id
        if (!ids.allContactIds.includes(id)) ids.allContactIds.push(id)
        return { id, created: true }
      }
      case 'hubspot_associate_contact_to_deal': {
        await hsAssociateContactToDeal(input.contact_id, input.deal_id)
        return { success: true }
      }
      case 'hubspot_create_deal': {
        const id = await hsCreateDeal(input.dealname, input.company_id, input.contact_id, input.amount, {
          faturamento:         input.faturamento,
          receita_anual:       input.receita_anual,
          n_de_funcionarios:   input.n_de_funcionarios,
          segmento_da_empresa: input.segmento_da_empresa,
        })
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
3. Para CADA decisor/influenciador na lista de contatos:
   a. Se tiver email: usar hubspot_search_contact para verificar se já existe
   b. Se não existir (ou sem email): criar com hubspot_create_contact associado à empresa (inclua email e phone se disponíveis)
   c. Guarde o ID de cada contato criado/encontrado
4. Criar o deal associado à empresa e ao PRIMEIRO contato da lista
5. Para cada contato ADICIONAL (2º, 3º...): usar hubspot_associate_contact_to_deal para vincular ao deal
6. Adicionar nota ao deal com a dor primária
Confirme quando todas as etapas estiverem concluídas.`

  const employeeCount = (lead.dados_apollo as any)?.employee_count
  const hsIndustry = mapIndustry(company.setor || '')

  const rawContacts: any[] = (lead.dados_apollo as any)?.contacts || []
  const PRIO = ['diretor jurídico', 'diretor juridico', 'general counsel', 'compliance officer', 'gerente jurídico', 'gerente juridico', 'coordenador jurídico', 'analista jurídico', 'analista de contratos', 'analista de garantias', 'gerente de contratos', 'analista de compliance', 'diretor', 'cfo', 'coo', 'ceo']
  const rankC = (p: any) => { const t = (p.title || '').toLowerCase(); const i = PRIO.findIndex(x => t.includes(x)); return i === -1 ? 99 : i }
  const topContacts = [...rawContacts].sort((a, b) => rankC(a) - rankC(b)).slice(0, 5)
  const contactsFormatted = topContacts.length > 0
    ? topContacts.map((c, i) => {
        const name  = c.name || [c.first_name, c.last_name || c.last_name_obfuscated].filter(Boolean).join(' ') || 'N/A'
        const phone = c.phone_numbers?.[0]?.raw_number || ''
        return `  ${i + 1}. ${name} — ${c.title || 'N/A'}${c.email ? ` | email: ${c.email}` : ''}${phone ? ` | tel: ${phone}` : ''}`
      }).join('\n')
    : '  (nenhum contato disponível)'

  const userPrompt = `Crie os registros CRM para este lead:

Empresa: ${company.nome}
Domínio: ${company.dominio || 'desconhecido'}
Setor (industry enum HubSpot): ${hsIndustry || 'não mapeado — omitir campo'}
Cidade: ${company.cidade || ''}
Estado: ${company.uf || ''}
Receita anual (USD): ${company.faturamento_usd || 'não disponível'}
Funcionários: ${employeeCount || 'não disponível'}
Nome do Deal: "${company.nome} — BlueDocs Piloto"
Dor primária: ${lead.dor_primaria || ''}

Decisores / Influenciadores (criar TODOS no HubSpot):
${contactsFormatted}

Ao criar a empresa: preencha annualrevenue (número) e numberofemployees (número) se disponíveis.
Ao criar o deal: preencha amount (número), faturamento (ex: "USD 423.752.992"), receita_anual (mesmo valor formatado), n_de_funcionarios (ex: "6.800") e segmento_da_empresa com o setor da empresa.
Execute todos os passos na ordem correta, criando TODOS os contatos listados e associando-os ao deal.`

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }]
  let maxIterations = 25

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

export async function runAgent(options: { limit?: number; leadIds?: string[] } = {}): Promise<void> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token || token === 'COLOQUE_SEU_TOKEN_AQUI') {
    console.error('[Agente 02] HUBSPOT_ACCESS_TOKEN não configurado. Defina o token no .env antes de executar.')
    process.exit(1)
  }

  let query = supabase
    .from('leads')
    .select('*, companies(*)')
    .eq('status', 'enriched')

  if (options.leadIds && options.leadIds.length > 0) {
    query = query.in('id', options.leadIds)
  }

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
      const { companyId, contactId, allContactIds, dealId, updated } = await processCRMForLead(lead)

      const updatedDados = {
        ...(lead.dados_apollo as any || {}),
        hubspot_contact_ids: allContactIds || [],
      }

      const { error: updateError } = await supabase
        .from('leads')
        .update({
          hubspot_company_id: companyId || lead.hubspot_company_id || null,
          hubspot_contact_id: contactId || lead.hubspot_contact_id || null,
          hubspot_deal_id:    dealId    || lead.hubspot_deal_id    || null,
          dados_apollo:       updatedDados,
          status: 'in_crm',
        })
        .eq('id', lead.id!)

      if (updateError) {
        console.error(`[Supabase] Erro ao atualizar lead ${lead.companies.nome}:`, updateError.message)
        continue
      }

      created++
      const contactCount = allContactIds?.length || 0
      if (updated) {
        console.log(`↻ ${lead.companies.nome} → HubSpot atualizado (deal: ${dealId}, contacts: ${contactCount})`)
      } else {
        console.log(`✓ ${lead.companies.nome} → HubSpot criado (company: ${companyId}, deal: ${dealId}, contacts: ${contactCount})`)
      }
    } catch (err: any) {
      console.error(`[Agente 02] Erro em ${lead.companies?.nome}:`, err?.stack || err.message)
    }
  }

  console.log(`\nAgente 02 concluído: ${created} leads no CRM`)
}

if (require.main === module) {
  runAgent().catch(console.error)
}
