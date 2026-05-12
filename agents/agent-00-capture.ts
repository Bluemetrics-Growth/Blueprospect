import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
dotenv.config()

import axios from 'axios'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'

// ─── Output interface ─────────────────────────────────────────────────────────

export interface CapturedLead {
  nome: string
  dominio: string
  setor: string
  uf: string
  cidade: string
  faturamento_usd: number
  segmento: string
  cei: string
  status: string
  icp_score: string
  fonte: 'aws_list' | 'apollo_search' | 'csv_upload'
  produto_alvo: 'bluedocs' | 'blueassistant' | 'blueops' | 'bluerisk'
}

// ─── Filter interfaces ────────────────────────────────────────────────────────

export interface AWSFilters {
  scores?: ('A' | 'A+' | 'B')[]
  setores?: string[]
  ufs?: string[]
  produto_alvo?: string
}

export interface ApolloFilters {
  produto_alvo: 'bluedocs' | 'blueassistant' | 'blueops' | 'bluerisk'
  setores?: string[]
  ufs?: string[]
  cargos?: string[]
  faturamento_min?: number
  faturamento_max?: number
  funcionarios_min?: number
  funcionarios_max?: number
  tecnologias_usa?: string[]
  tecnologias_nao_usa?: string[]
  limit?: number
}

export interface CSVUploadOptions {
  filePath: string
  produto_alvo: 'bluedocs' | 'blueassistant' | 'blueops' | 'bluerisk'
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UF_TO_APOLLO: Record<string, string> = {
  AM: 'amazonas, brazil',    PA: 'pará, brazil',          RO: 'rondônia, brazil',
  RR: 'roraima, brazil',     AC: 'acre, brazil',           AP: 'amapá, brazil',
  TO: 'tocantins, brazil',   BA: 'bahia, brazil',          CE: 'ceará, brazil',
  PE: 'pernambuco, brazil',  MA: 'maranhão, brazil',       RN: 'rio grande do norte, brazil',
  AL: 'alagoas, brazil',     PI: 'piauí, brazil',          PB: 'paraíba, brazil',
  SE: 'sergipe, brazil',     MT: 'mato grosso, brazil',    MS: 'mato grosso do sul, brazil',
  GO: 'goiás, brazil',       DF: 'distrito federal, brazil', SP: 'são paulo, brazil',
  RJ: 'rio de janeiro, brazil', MG: 'minas gerais, brazil', ES: 'espírito santo, brazil',
  RS: 'rio grande do sul, brazil', PR: 'paraná, brazil',   SC: 'santa catarina, brazil',
}

const DEFAULT_TITLES: Record<string, string[]> = {
  bluedocs:     ['Diretor Jurídico', 'CFO', 'Compliance Officer', 'Controller', 'Gerente de Contratos'],
  blueassistant:['Head de Atendimento', 'Diretor de Operações', 'CMO', 'Head de CX'],
  blueops:      ['Diretor de Operações', 'COO', 'Diretor de Supply Chain', 'Gerente de Logística'],
  bluerisk:     ['Diretor de Crédito', 'Risk Officer', 'CFO', 'Gerente de Análise de Crédito'],
}

const COLUMN_MAP: Record<string, string[]> = {
  nome:         ['nome', 'name', 'company', 'empresa', 'razão social', 'razao social'],
  dominio:      ['dominio', 'domain', 'website', 'site', 'url'],
  setor:        ['setor', 'sector', 'industry', 'industria', 'segmento'],
  uf:           ['uf', 'estado', 'state', 'sigla'],
  cidade:       ['cidade', 'city', 'municipio', 'município'],
  faturamento:  ['faturamento', 'revenue', 'receita', 'fat'],
  nome_contato: ['nome_contato', 'contato', 'contact', 'nome do contato', 'pessoa'],
  cargo:        ['cargo', 'title', 'titulo', 'função', 'funcao', 'position'],
  email:        ['email', 'e-mail', 'email corporativo'],
  whatsapp:     ['whatsapp', 'celular', 'telefone', 'fone', 'phone', 'mobile'],
  linkedin:     ['linkedin', 'linkedin_url', 'perfil linkedin'],
}

const AWS_FILES: Record<string, string> = {
  'A+': 'aws-leads-score-a-plus.json',
  'A':  'aws-leads-score-a.json',
  'B':  'aws-leads-score-b.json',
}

const APOLLO_HEADERS = {
  'X-Api-Key': process.env.APOLLO_API_KEY!,
  'Content-Type': 'application/json',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeStr(s: string): string {
  return s.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function sanitizeDomain(raw: string): string {
  return raw.replace(/["']/g, '').replace(/^www\./, '').split(',')[0].trim()
}

// Apollo returns "State of Sao Paulo", "São Paulo", "sao paulo" — normaliza para "sao paulo"
function normalizeApolloState(s: string): string {
  return normalizeStr(s)
    .replace(/^state of\s+/i, '')
    .replace(/^province of\s+/i, '')
    .trim()
}

// Apollo industry strings ("hospital & health care") vs filtros do usuário ("Healthcare")
// Verifica se o setor da Apollo contém palavras-chave do setor solicitado
const SETOR_KEYWORDS_MATCH: Record<string, string[]> = {
  healthcare:             ['health', 'hospital', 'medical', 'pharma', 'clinic', 'saude'],
  'healthcare services':  ['health', 'hospital', 'medical', 'clinic'],
  'financial services':   ['financial', 'bank', 'banking', 'insurance', 'credit', 'invest'],
  'legal services':       ['legal', 'law', 'juridico', 'advocac'],
  construction:           ['construct', 'real estate', 'imob', 'building'],
  'real estate':          ['real estate', 'imob', 'property'],
  'energy & utilities':   ['energy', 'electric', 'utilities', 'oil', 'gas', 'power'],
  manufacturing:          ['manufactur', 'industri', 'fabricat'],
  agriculture:            ['agric', 'agro', 'farm', 'food'],
  education:              ['educat', 'school', 'universit', 'coleg'],
  'professional services':['professional', 'consulting', 'staffing'],
  'logistics & transportation': ['logist', 'transport', 'freight', 'shipping'],
  retail:                 ['retail', 'varejo', 'wholesale', 'ecommerc'],
}

function matchesSetor(apolloIndustry: string, filterSetor: string): boolean {
  const industry = normalizeStr(apolloIndustry)
  const filterNorm = normalizeStr(filterSetor)
  // exact or partial substring match
  if (industry.includes(filterNorm) || filterNorm.includes(industry)) return true
  // keyword-based match
  const keywords = SETOR_KEYWORDS_MATCH[filterSetor.toLowerCase()] || []
  return keywords.some(kw => industry.includes(kw))
}

function buildEmployeeRange(min?: number, max?: number): string[] {
  if (!min && !max) return []
  const lo = min ?? 0
  const hi = max ?? 99999
  const ranges = ['1,10','11,20','21,50','51,100','101,200','201,500','501,1000','1001,2000','2001,5000','5001,10000','10001,20000','20001,50000']
  return ranges.filter(r => {
    const [a, b] = r.split(',').map(Number)
    return b >= lo && a <= hi
  })
}

// ─── Supabase persistence ─────────────────────────────────────────────────────

async function persistToSupabase(leads: CapturedLead[]): Promise<void> {
  for (const lead of leads) {
    const domain = sanitizeDomain(lead.dominio)
    if (!domain || !domain.includes('.')) continue

    const companyPayload = {
      nome:          lead.nome,
      dominio:       domain,
      uf:            lead.uf,
      cidade:        lead.cidade,
      setor:         lead.setor,
      faturamento_usd: lead.faturamento_usd || null,
      segmento:      lead.segmento,
      cei_status:    lead.cei,
      status_aws:    `captured:${lead.fonte}`,
    }

    const { data: existing } = await supabase
      .from('companies')
      .select('id')
      .eq('dominio', domain)
      .maybeSingle()

    let companyId: string | undefined
    if (existing) {
      await supabase.from('companies').update(companyPayload).eq('id', existing.id)
      companyId = existing.id
    } else {
      const { data } = await supabase.from('companies').insert(companyPayload).select('id').single()
      companyId = data?.id
    }

    if (!companyId) continue

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('company_id', companyId)
      .maybeSingle()

    if (!existingLead) {
      await supabase.from('leads').insert({
        company_id: companyId,
        icp_score:  lead.icp_score,
        status:     'captured',
      })
    }
  }
}

// ─── Mode 1: AWS List ─────────────────────────────────────────────────────────

async function captureFromAWS(filters: AWSFilters): Promise<CapturedLead[]> {
  const scores = filters.scores ?? ['A+', 'A', 'B']
  const dataDir = path.join(__dirname, '../data')
  const results: CapturedLead[] = []

  for (const score of scores) {
    const file = path.join(dataDir, AWS_FILES[score])
    if (!fs.existsSync(file)) {
      console.warn(`[Agente 00] Arquivo não encontrado: ${AWS_FILES[score]}`)
      continue
    }
    const raw: any[] = JSON.parse(fs.readFileSync(file, 'utf-8'))

    for (const item of raw) {
      if (filters.setores?.length) {
        const setor = normalizeStr(item.setor || '')
        const match = filters.setores.some(s => setor.includes(normalizeStr(s)))
        if (!match) continue
      }
      if (filters.ufs?.length) {
        if (!filters.ufs.includes((item.uf || '').toUpperCase())) continue
      }

      results.push({
        nome:          item.nome || '',
        dominio:       sanitizeDomain(item.dominio || ''),
        setor:         item.setor || '',
        uf:            item.uf || '',
        cidade:        item.cidade || '',
        faturamento_usd: item.faturamento_usd || 0,
        segmento:      item.segmento || '',
        cei:           item.cei || '',
        status:        item.status || '',
        icp_score:     item.icp_score || score,
        fonte:         'aws_list',
        produto_alvo:  (filters.produto_alvo as any) || 'bluedocs',
      })
    }
  }

  return results
}

// ─── Mode 2: Apollo Search ────────────────────────────────────────────────────
// Estratégia: mixed_companies/search via keyword de setor → enrich por domínio
// → filtro local por UF / faturamento / funcionários.
// Nota: filtros de industry e location em array não funcionam na tier atual da Apollo.

const SETOR_KEYWORDS: Record<string, string> = {
  healthcare:           'hospital saude clinica',
  'healthcare services':'hospital saude clinica',
  'financial services': 'banco financeira credito seguradora',
  'legal services':     'advocacia juridico law',
  construction:         'construtora incorporadora obras',
  'real estate':        'imobiliaria imoveis',
  'energy & utilities': 'energia eletrica distribuidora gas',
  manufacturing:        'industria fabricacao manufactura',
  agriculture:          'agro agroindustria fazenda',
  education:            'educação escola universidade faculdade',
  'professional services': 'consultoria servicos profissionais',
  'logistics & transportation': 'logistica transporte frete',
  retail:               'varejo supermercado atacado',
}

async function captureFromApollo(filters: ApolloFilters): Promise<CapturedLead[]> {
  const limit = filters.limit || 25
  const normalizedSetores = (filters.setores || []).map(normalizeStr)

  // Uma busca por keyword para cada setor solicitado — combina e deduplica por domínio
  const setoresParaBuscar = filters.setores?.length ? filters.setores : ['empresa']
  const seenDomains = new Set<string>()
  const allOrgs: any[] = []

  for (const setor of setoresParaBuscar) {
    const keyword = (SETOR_KEYWORDS[setor.toLowerCase()] || setor).split(' ')[0]
    try {
      const resp = await axios.post(
        'https://api.apollo.io/v1/mixed_companies/search',
        { q_organization_name: keyword, per_page: Math.min(limit * 2, 50) },
        { headers: APOLLO_HEADERS }
      )
      for (const org of resp.data?.organizations || []) {
        const d = sanitizeDomain(org.primary_domain || org.website_url || '')
        if (d && !seenDomains.has(d)) {
          seenDomains.add(d)
          allOrgs.push(org)
        }
      }
    } catch (err: any) {
      console.warn(`[Agente 00] Apollo search falhou para setor "${setor}":`, err?.response?.data?.message || err.message)
    }
  }

  const orgs = allOrgs
  if (orgs.length === 0) {
    console.warn('[Agente 00] Apollo search retornou 0 empresas')
    return []
  }

  const results: CapturedLead[] = []
  const allowedUFs = (filters.ufs || []).map(u => u.toUpperCase())

  for (const org of orgs) {
    if (results.length >= limit) break

    const domain = sanitizeDomain(org.primary_domain || org.website_url || '')
    if (!domain) continue

    // Enrich para obter industry, location, revenue, employees
    let enriched: any = {}
    try {
      const enrichResp = await axios.post(
        'https://api.apollo.io/v1/organizations/enrich',
        { domain },
        { headers: APOLLO_HEADERS }
      )
      enriched = enrichResp.data?.organization || {}
    } catch {
      // sem enrich — usa dados parciais do search
    }

    const setor:      string = enriched.industry || ''
    const faturamento: number = enriched.estimated_annual_revenue || org.organization_revenue || 0
    const employees:  number = enriched.estimated_num_employees || enriched.employee_count || 0
    const city:       string = enriched.city || ''
    const state:      string = enriched.state || ''
    const country:    string = (enriched.country || '').toLowerCase()

    const stateNorm = normalizeApolloState(state)
    const uf = Object.entries(UF_TO_APOLLO).find(([, v]) =>
      normalizeStr(v.split(',')[0]) === stateNorm
    )?.[0] || ''

    // Exclui empresas não-brasileiras quando qualquer filtro geográfico está ativo
    if (allowedUFs.length > 0 && country && !country.includes('brazil') && !country.includes('brasil')) continue

    // Filtros locais
    if (allowedUFs.length > 0 && !allowedUFs.includes(uf)) continue
    if (filters.setores?.length && setor) {
      const match = filters.setores.some(s => matchesSetor(setor, s))
      if (!match) continue
    }
    if (filters.faturamento_min && faturamento && faturamento < filters.faturamento_min) continue
    if (filters.faturamento_max && faturamento && faturamento > filters.faturamento_max) continue
    if (filters.funcionarios_min && employees && employees < filters.funcionarios_min) continue
    if (filters.funcionarios_max && employees && employees > filters.funcionarios_max) continue

    results.push({
      nome:           enriched.name || org.name || '',
      dominio:        domain,
      setor,
      uf,
      cidade:         city,
      faturamento_usd: faturamento,
      segmento:       '',
      cei:            '',
      status:         '',
      icp_score:      'B',
      fonte:          'apollo_search',
      produto_alvo:   filters.produto_alvo,
    })
  }

  return results
}

// ─── Mode 3: CSV / XLSX Upload ────────────────────────────────────────────────

async function captureFromCSV(options: CSVUploadOptions): Promise<CapturedLead[]> {
  if (!fs.existsSync(options.filePath)) {
    console.warn(`[Agente 00] Arquivo não encontrado: ${options.filePath}`)
    return []
  }

  const ext = path.extname(options.filePath).toLowerCase()
  let workbook: XLSX.WorkBook
  if (ext === '.csv') {
    const content = fs.readFileSync(options.filePath, { encoding: 'utf8' })
    workbook = XLSX.read(content, { type: 'string' })
  } else {
    workbook = XLSX.readFile(options.filePath)
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  if (rows.length < 2) {
    console.warn('[Agente 00] CSV vazio ou sem dados')
    return []
  }

  const headers: string[] = (rows[0] as any[]).map(h => normalizeStr(String(h ?? '')))

  // Mapeia índice de coluna para campo interno
  const colIndex: Record<string, number> = {}
  for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
    const idx = headers.findIndex(h => aliases.some(a => normalizeStr(a) === h))
    if (idx !== -1) colIndex[field] = idx
  }

  const recognized = Object.keys(colIndex)
  console.log(`CSV mapeado: ${rows.length - 1} leads, colunas reconhecidas: [${recognized.join(', ')}]`)

  const results: CapturedLead[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as any[]
    const get = (field: string): string => String(row[colIndex[field]] ?? '').trim()

    const nome = get('nome')
    if (!nome) continue

    const rawFat = get('faturamento').replace(/[^0-9.]/g, '')
    const faturamento = rawFat ? parseFloat(rawFat) : 0

    results.push({
      nome,
      dominio:       sanitizeDomain(get('dominio')),
      setor:         get('setor'),
      uf:            get('uf').toUpperCase(),
      cidade:        get('cidade'),
      faturamento_usd: faturamento,
      segmento:      '',
      cei:           '',
      status:        '',
      icp_score:     'B',
      fonte:         'csv_upload',
      produto_alvo:  options.produto_alvo,
    })
  }

  return results
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function captureLeads(
  mode: 'aws_list' | 'apollo_search' | 'csv_upload',
  options: AWSFilters | ApolloFilters | CSVUploadOptions
): Promise<CapturedLead[]> {
  let leads: CapturedLead[] = []

  if (mode === 'aws_list') {
    leads = await captureFromAWS(options as AWSFilters)
  } else if (mode === 'apollo_search') {
    leads = await captureFromApollo(options as ApolloFilters)
  } else if (mode === 'csv_upload') {
    leads = await captureFromCSV(options as CSVUploadOptions)
  }

  if (leads.length > 0) {
    await persistToSupabase(leads)
  }

  console.log(`Agente 00 — ${mode}: ${leads.length} leads capturados`)
  return leads
}

if (require.main === module) {
  captureLeads('aws_list', { scores: ['A+'], produto_alvo: 'bluedocs' })
    .then(leads => console.log('Leads:', leads.map(l => l.nome)))
    .catch(console.error)
}
