import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config()

export type Company = {
  id?: string
  nome: string
  dominio?: string
  uf?: string
  cidade?: string
  setor?: string
  faturamento_usd?: number
  segmento?: string
  cei_status?: string
  status_aws?: string
  created_at?: string
}

export type Lead = {
  id?: string
  company_id?: string
  nome_contato?: string
  cargo?: string
  email?: string
  whatsapp?: string
  linkedin_url?: string
  vertical_bluedocs?: string
  icp_score?: string
  dor_primaria?: string
  caso_uso_bluedocs?: string
  dados_apollo?: any
  hubspot_company_id?: string
  hubspot_contact_id?: string
  hubspot_deal_id?: string
  status?: string
  created_at?: string
  updated_at?: string
}

export type Message = {
  id?: string
  lead_id?: string
  canal?: string
  conteudo?: string
  status?: string
  reply_content?: string
  sent_at?: string
}

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)
