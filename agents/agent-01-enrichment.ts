import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
dotenv.config()

import { enrichCompany, findContacts } from '../lib/apollo'
import { mapPain } from '../lib/claude'
import { supabase } from '../lib/supabase'
import type { Company, Lead } from '../lib/supabase'

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
}

const TITLES_BY_VERTICAL: Record<string, string[]> = {
  healthcare:    ['Diretor Jurídico', 'Compliance Officer', 'CFO', 'Diretor Administrativo'],
  financial:     ['Analista de Crédito', 'Diretor Jurídico', 'Risk Officer', 'CFO'],
  energy:        ['Compliance', 'Regulatório', 'Diretor Jurídico', 'Gerente de Contratos'],
  construction:  ['Diretor de Licitações', 'Controller', 'Jurídico', 'CFO'],
  manufacturing: ['Diretor Jurídico', 'Controller', 'Gerente de Contratos', 'CFO'],
  default:       ['CFO', 'Diretor Jurídico', 'COO', 'Diretor Administrativo'],
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

export async function runAgent(options: { limit?: number } = {}): Promise<void> {
  const dataPath = path.join(__dirname, '../data/aws-leads-score-a.json')
  const rawLeads: RawLead[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))

  const leads = options.limit ? rawLeads.slice(0, options.limit) : rawLeads
  let enriched = 0

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

      const technologies: string[] = apolloOrg?.technology_names || apolloOrg?.technologies?.map((t: any) => t.name || t) || []
      const openJobs: string[] = apolloContacts?.people?.map((p: any) => p.title).filter(Boolean) || []
      const employeeCount = apolloOrg?.estimated_num_employees || apolloOrg?.employee_count

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
        tecnologias: technologies,
        vagas: openJobs,
      })

      // Pick best contact from Apollo
      const firstContact = apolloContacts?.people?.[0]

      const leadPayload: Lead = {
        company_id: savedCompany.id,
        nome_contato: firstContact?.name || firstContact?.first_name || undefined,
        cargo: firstContact?.title || undefined,
        email: firstContact?.email || undefined,
        linkedin_url: firstContact?.linkedin_url || undefined,
        vertical_bluedocs: painResult.vertical_bluedocs || vertical,
        icp_score: 'A',
        dor_primaria: painResult.dor_primaria,
        caso_uso_bluedocs: painResult.caso_uso_bluedocs,
        dados_apollo: {
          employee_count: employeeCount,
          technologies,
          open_contacts: apolloContacts?.people || [],
          org_raw: apolloOrg,
        },
        status: 'enriched',
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
      } else {
        const { error: leadError } = await supabase
          .from('leads')
          .insert(leadPayload)
        if (leadError) { console.error(`[Supabase] Erro ao inserir lead ${raw.nome}:`, leadError.message); continue }
      }

      enriched++
      console.log(`✓ ${raw.nome} | ${painResult.vertical_bluedocs} | icp_score: A`)
    } catch (err: any) {
      console.error(`[Agente 01] Erro inesperado em ${raw.nome}:`, err?.stack || err.message)
    }
  }

  console.log(`\nAgente 01 concluído: ${enriched} leads enriquecidos`)
}

if (require.main === module) {
  runAgent().catch(console.error)
}
