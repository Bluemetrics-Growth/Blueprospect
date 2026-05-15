import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
dotenv.config()

import { enrichCompany, findContacts, getJobPostings, searchContactByEmail } from '../lib/apollo'
import { mapPain } from '../lib/claude'
import { supabase } from '../lib/supabase'
import type { Company, Lead } from '../lib/supabase'
import type { CapturedLead } from './agent-00-capture'

interface RawLead {
  nome: string
  segmento: string
  cei: string
  status: string
  faturamento_usd: number
  setor: string
  uf: string
  cidade: string
  dominio: string
  icp_score?: string
}

const TITLES_BY_VERTICAL: Record<string, string[]> = {
  healthcare:    ['Analista Jurídico', 'Analista de Contratos', 'Gerente Jurídico', 'Diretor Jurídico', 'Compliance Officer', 'Analista de Compliance', 'CFO'],
  financial:     ['Analista Jurídico', 'Analista de Contratos', 'Analista de Garantias', 'Gerente Jurídico', 'Coordenador Jurídico', 'Diretor Jurídico', 'Compliance Officer', 'Analista de Compliance', 'CFO'],
  energy:        ['Analista Jurídico', 'Analista de Contratos', 'Gerente de Contratos', 'Gerente Jurídico', 'Diretor Jurídico', 'Compliance Officer', 'Analista Regulatório', 'CFO'],
  construction:  ['Analista Jurídico', 'Analista de Contratos', 'Gerente de Contratos', 'Diretor Jurídico', 'Analista de Licitações', 'Diretor de Licitações', 'CFO'],
  manufacturing: ['Analista Jurídico', 'Analista de Contratos', 'Gerente de Contratos', 'Gerente Jurídico', 'Diretor Jurídico', 'Compliance Officer', 'CFO'],
  default:       ['Analista Jurídico', 'Analista de Contratos', 'Gerente Jurídico', 'Diretor Jurídico', 'Compliance Officer', 'CFO'],
}

function mapSectorToVertical(setor: string): string {
  const s = setor.toLowerCase()
  if (s.includes('health') || s.includes('hospital') || s.includes('saude') || s.includes('droga') || s.includes('farma')) return 'healthcare'
  if (s.includes('financial') || s.includes('financ') || s.includes('bank') || s.includes('credit')) return 'financial'
  if (s.includes('energy') || s.includes('energia') || s.includes('oil') || s.includes('gas') || s.includes('utilities') || s.includes('power')) return 'energy'
  if (s.includes('construction') || s.includes('real estate') || s.includes('imob') || s.includes('constru')) return 'construction'
  if (s.includes('manufactur') || s.includes('industri') || s.includes('fabric')) return 'manufacturing'
  return 'default'
}

function sanitizeDomain(raw: string): string {
  return raw
    .replace(/["']/g, '')
    .replace(/^www\./, '')
    .split(',')[0]
    .trim()
}

function isValidDomain(domain: string): boolean {
  return domain.includes('.') && !domain.includes(' ') && domain.length > 3
}

export async function runAgent(options: { limit?: number; file?: string; leads?: CapturedLead[] } = {}): Promise<string[]> {
  let rawLeads: RawLead[]

  if (options.leads && options.leads.length > 0) {
    rawLeads = options.leads as unknown as RawLead[]
    console.log(`[Agente 01] Recebendo ${rawLeads.length} leads do Agente 00...\n`)
  } else {
    const dataPath = options.file
      ? path.resolve(options.file)
      : path.join(__dirname, '../data/aws-leads-score-a.json')
    rawLeads = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
  }

  const leads = options.limit ? rawLeads.slice(0, options.limit) : rawLeads
  let enriched = 0
  const enrichedLeadIds: string[] = []

  console.log(`[Agente 01] Iniciando enriquecimento de ${leads.length} leads...\n`)

  for (const raw of leads) {
    const domain = sanitizeDomain(raw.dominio || '')

    if (!isValidDomain(domain)) {
      console.warn(`⚠ ${raw.nome} — domínio inválido "${raw.dominio}", pulando`)
      continue
    }

    try {
      // Apollo enrichment
      const apolloOrg = await enrichCompany(domain)
      const vertical = apolloOrg ? mapSectorToVertical(apolloOrg.industry || raw.setor) : mapSectorToVertical(raw.setor)
      const titles = TITLES_BY_VERTICAL[vertical] || TITLES_BY_VERTICAL.default
      const apolloContacts = await findContacts(domain, titles)

      const apolloOrgId: string | undefined = apolloOrg?.id
      const technologies: string[] = apolloOrg?.technology_names || apolloOrg?.technologies?.map((t: any) => t.name || t) || []
      const employeeCount = apolloOrg?.estimated_num_employees || apolloOrg?.employee_count
      const headcountByDept: Record<string, number> = apolloOrg?.departments || apolloOrg?.headcount_by_department || {}
      const companyDescription: string = apolloOrg?.short_description || ''
      const fundingEvents: Array<{ date?: string; type?: string; amount?: string }> =
        (apolloOrg?.funding_events || []).slice(0, 3).map((e: any) => ({
          date: e.date,
          type: e.type || e.round_type,
          amount: typeof e.amount === 'number' && e.amount > 0 ? `USD ${(e.amount / 1_000_000).toFixed(1)}M` : undefined,
        }))

      const jobPostingsRaw = apolloOrgId ? await getJobPostings(apolloOrgId) : []
      const jobPostings: Array<{ title: string; department?: string }> =
        jobPostingsRaw.slice(0, 8).map((j: any) => ({
          title: j.title || j.job_title || '',
          department: j.department,
        })).filter((j: { title: string }) => j.title)

      // Save company
      const companyPayload: Company = {
        nome: raw.nome,
        dominio: domain,
        uf: raw.uf || '',
        cidade: raw.cidade || '',
        setor: raw.setor,
        faturamento_usd: raw.faturamento_usd,
        segmento: raw.segmento,
        cei_status: raw.cei,
        status_aws: raw.status || '',
      }

      // Select-then-insert/update — não requer constraint UNIQUE no dominio
      const { data: existing } = await supabase
        .from('companies')
        .select('id')
        .eq('dominio', domain)
        .maybeSingle()

      let savedCompany: any
      if (existing) {
        const { data, error } = await supabase
          .from('companies')
          .update(companyPayload)
          .eq('id', existing.id)
          .select()
          .single()
        if (error) { console.error(`[Supabase] Erro ao atualizar empresa ${raw.nome}:`, error.message); continue }
        savedCompany = data
      } else {
        const { data, error } = await supabase
          .from('companies')
          .insert(companyPayload)
          .select()
          .single()
        if (error) { console.error(`[Supabase] Erro ao inserir empresa ${raw.nome}:`, error.message); continue }
        savedCompany = data
      }

      // Claude pain mapping
      const painResult = await mapPain({
        nome: raw.nome,
        setor: raw.setor,
        faturamento_usd: raw.faturamento_usd,
        uf: raw.uf || '',
        funcionarios: employeeCount,
        descricao: companyDescription,
        headcount_dept: headcountByDept,
        tecnologias: technologies,
        vagas_detalhadas: jobPostings,
        eventos_funding: fundingEvents,
      })

      // Pick best contact — prefer decision-maker titles over list order
      const PRIORITY_TERMS = ['diretor jurídico', 'diretor juridico', 'general counsel', 'compliance officer', 'gerente jurídico', 'gerente juridico', 'coordenador jurídico', 'analista jurídico', 'analista de contratos', 'analista de garantias', 'gerente de contratos', 'analista de compliance', 'diretor', 'cfo', 'coo', 'ceo']
      const allContacts = apolloContacts?.people || []
      const rankContact = (p: any): number => {
        const t = (p.title || '').toLowerCase()
        const idx = PRIORITY_TERMS.findIndex(term => t.includes(term))
        return idx === -1 ? 99 : idx
      }
      const sortedContacts = [...allContacts].sort((a, b) => rankContact(a) - rankContact(b))
      const primaryContact = sortedContacts[0]

      // Tentar obter telefone: 1) CRM Apollo (contatos já revelados) 2) solicitar reveal via webhook
      let whatsappNumber: string | undefined = undefined

      if (primaryContact?.email) {
        const savedContact = await searchContactByEmail(primaryContact.email)
        if (savedContact?.sanitized_phone) {
          whatsappNumber = savedContact.sanitized_phone
          console.log(`   📱 telefone encontrado em /contacts/search`)
        }
      }

      if (!whatsappNumber) {
        if (process.env.APOLLO_WEBHOOK_URL) {
          console.log(`   ⏳ telefone pendente — reveal solicitado ao Apollo via webhook`)
        } else {
          console.log(`   ⚠ telefone pendente — configure APOLLO_WEBHOOK_URL para reveal assíncrono`)
        }
      }

      const leadStatus = whatsappNumber ? 'enriched' : 'needs_phone_reveal'

      const leadPayload: Lead = {
        company_id: savedCompany.id,
        nome_contato: primaryContact?.name || primaryContact?.first_name || undefined,
        cargo: primaryContact?.title || undefined,
        email: primaryContact?.email || undefined,
        linkedin_url: primaryContact?.linkedin_url || undefined,
        whatsapp: whatsappNumber,
        vertical_bluedocs: painResult.vertical_bluedocs || vertical,
        icp_score: raw.icp_score || 'A',
        dor_primaria: painResult.dor_primaria,
        caso_uso_bluedocs: painResult.caso_uso_bluedocs,
        dados_apollo: {
          employee_count: employeeCount,
          technologies,
          headcount_by_dept: headcountByDept,
          funding_events: fundingEvents,
          job_postings: jobPostings,
          company_description: companyDescription,
          contacts: allContacts,
          org_raw: apolloOrg,
          person_id: primaryContact?.id || null,
        },
        status: leadStatus,
      }

      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('company_id', savedCompany.id)
        .maybeSingle()

      if (existingLead) {
        const { error: leadError } = await supabase
          .from('leads')
          .update(leadPayload)
          .eq('id', existingLead.id)
        if (leadError) { console.error(`[Supabase] Erro ao atualizar lead ${raw.nome}:`, leadError.message); continue }
        enrichedLeadIds.push(existingLead.id)
      } else {
        const { data: insertedLead, error: leadError } = await supabase
          .from('leads')
          .insert(leadPayload)
          .select('id')
          .single()
        if (leadError) { console.error(`[Supabase] Erro ao inserir lead ${raw.nome}:`, leadError.message); continue }
        if (insertedLead?.id) enrichedLeadIds.push(insertedLead.id)
      }

      enriched++
      const phoneLog = whatsappNumber ? `telefone: ${whatsappNumber}` : `telefone pendente — reveal solicitado`
      console.log(`✓ ${raw.nome} | ${painResult.vertical_bluedocs} | ${phoneLog}`)
      console.log(`   contatos: ${allContacts.length} | vagas: ${jobPostings.length} | funding: ${fundingEvents.length} | headcount_depts: ${Object.keys(headcountByDept).length}`)
      if (jobPostings.length > 0) console.log(`   vagas: ${jobPostings.map(j => j.title).join(', ')}`)
      if (fundingEvents.length > 0) console.log(`   funding: ${fundingEvents.map(e => [e.type, e.amount].filter(Boolean).join(' ')).join(' | ')}`)
      if (primaryContact) console.log(`   contato principal: ${primaryContact.name} — ${primaryContact.title}`)
      console.log(`   dor: ${painResult.dor_primaria}`)
      console.log()
    } catch (err: any) {
      console.error(`[Agente 01] Erro inesperado em ${raw.nome}:`, err?.stack || err.message)
    }
  }

  console.log(`\nAgente 01 concluído: ${enriched} leads enriquecidos`)
  return enrichedLeadIds
}

if (require.main === module) {
  runAgent().catch(console.error)
}
