import * as dotenv from 'dotenv'
dotenv.config()

import { generateMessage } from '../lib/claude'
import { sendMessage } from '../lib/evolution'
import { supabase } from '../lib/supabase'
import type { Lead, Company, Message } from '../lib/supabase'
import { getContactPhone } from '../lib/hubspot-client'

const HS_STAGE_ABORDADO = '1358852621'

async function hsMoveToAbordado(dealId: string): Promise<void> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  const resp = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: { dealstage: HS_STAGE_ABORDADO } }),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`HubSpot PATCH deal ${dealId}: ${resp.status} ${text}`)
  }
}

type LeadWithCompany = Lead & { companies: Company }

export async function runAgent(options: { limit?: number } = {}): Promise<void> {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*, companies(*)')
    .eq('status', 'in_crm')
    .eq('icp_score', 'A')

  if (error) {
    console.error('[Supabase] Erro ao buscar leads:', error.message)
    return
  }

  if (!leads || leads.length === 0) {
    console.log('[Agente 03] Nenhum lead com status "in_crm" e icp_score "A" encontrado.')
    return
  }

  const batch = (options.limit ? leads.slice(0, options.limit) : leads) as LeadWithCompany[]
  let sent = 0
  let noPhone = 0

  console.log(`[Agente 03] Gerando e enviando mensagens para ${batch.length} leads...\n`)

  for (const lead of batch) {
    const company = lead.companies
    if (!company) {
      console.warn(`⚠ Lead ${lead.id} sem empresa associada, pulando`)
      continue
    }

    try {
      if (!lead.whatsapp && lead.hubspot_contact_id) {
        const phone = await getContactPhone(lead.hubspot_contact_id)
        if (phone) {
          lead.whatsapp = phone
          await supabase.from('leads').update({ whatsapp: phone }).eq('id', lead.id!)
          console.log(`  → telefone obtido do HubSpot: ${phone}`)
        }
      }

      const mensagem = await generateMessage(
        {
          nome_contato: lead.nome_contato,
          vertical_bluedocs: lead.vertical_bluedocs,
          dor_primaria: lead.dor_primaria,
        },
        {
          nome: company.nome,
          uf: company.uf,
          cidade: company.cidade,
        }
      )

      if (lead.whatsapp) {
        const ok = await sendMessage(lead.whatsapp, mensagem)

        const messagePayload: Message = {
          lead_id: lead.id,
          canal: 'whatsapp',
          conteudo: mensagem,
          status: ok ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
        }

        const { error: msgError } = await supabase.from('messages').insert(messagePayload)
        if (msgError) {
          console.error(`[Supabase] Erro ao salvar mensagem para ${company.nome}:`, msgError.message)
        }

        const { error: updateError } = await supabase
          .from('leads')
          .update({ status: ok ? 'contacted' : 'contact_failed' })
          .eq('id', lead.id!)

        if (updateError) {
          console.error(`[Supabase] Erro ao atualizar status de ${company.nome}:`, updateError.message)
        }

        if (ok) {
          sent++
          console.log(`✓ ${company.nome} | mensagem enviada via WhatsApp`)
          if (lead.hubspot_deal_id) {
            try {
              await hsMoveToAbordado(lead.hubspot_deal_id)
              console.log(`  → HubSpot deal movido para "Abordado"`)
            } catch (hsErr: any) {
              console.warn(`  ⚠ Falha ao atualizar HubSpot deal: ${hsErr.message}`)
            }
          }
        } else {
          console.warn(`⚠ ${company.nome} | falha no envio, registrado como "failed"`)
        }
      } else {
        // Sem WhatsApp — salva mensagem para envio manual
        const messagePayload: Message = {
          lead_id: lead.id,
          canal: 'whatsapp',
          conteudo: mensagem,
          status: 'no_phone',
          sent_at: new Date().toISOString(),
        }

        const { error: msgError } = await supabase.from('messages').insert(messagePayload)
        if (msgError) {
          console.error(`[Supabase] Erro ao salvar mensagem para ${company.nome}:`, msgError.message)
        }

        noPhone++
        console.warn(`⚠ ${company.nome} — sem WhatsApp, mensagem salva para envio manual`)
      }
    } catch (err: any) {
      console.error(`[Agente 03] Erro inesperado em ${company.nome}:`, err?.stack || err.message)
    }
  }

  console.log(`\nAgente 03 concluído: ${sent} enviadas | ${noPhone} sem telefone (salvas para envio manual)`)
}

if (require.main === module) {
  runAgent().catch(console.error)
}
