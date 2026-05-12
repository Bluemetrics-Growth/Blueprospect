import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

interface ApolloPhoneNumber {
  raw_number: string
  sanitized_number: string
  type: string
  status: string
  position: number
}

interface ApolloWebhookPayload {
  event_type?: string
  person_id?: string
  id?: string
  phone_numbers?: ApolloPhoneNumber[]
  sanitized_phone?: string
  data?: {
    person_id?: string
    id?: string
    phone_numbers?: ApolloPhoneNumber[]
    sanitized_phone?: string
  }
}

function extractPersonId(payload: ApolloWebhookPayload): string | null {
  return (
    payload?.person_id ||
    payload?.id ||
    payload?.data?.person_id ||
    payload?.data?.id ||
    null
  )
}

function extractBestPhone(payload: ApolloWebhookPayload): string | null {
  const phones = payload?.phone_numbers || payload?.data?.phone_numbers || []

  if (phones.length === 0) {
    return payload?.sanitized_phone || payload?.data?.sanitized_phone || null
  }

  // Prioridade 1: mobile válido
  const mobile = phones.find(
    (p) => p.type === 'mobile' && p.status === 'valid_number'
  )
  if (mobile) return mobile.sanitized_number

  // Prioridade 2: qualquer número válido
  const valid = phones.find((p) => p.status === 'valid_number')
  if (valid) return valid.sanitized_number

  // Prioridade 3: primeiro disponível
  return phones[0]?.sanitized_number || null
}

export async function POST(request: NextRequest) {
  try {
    const payload: ApolloWebhookPayload = await request.json()

    console.log('[Webhook Apollo] Payload recebido:', JSON.stringify(payload, null, 2))

    const personId = extractPersonId(payload)
    const phone = extractBestPhone(payload)

    if (!personId) {
      console.warn('[Webhook Apollo] person_id não encontrado no payload')
      return NextResponse.json({ ok: true, skipped: 'no_person_id' })
    }

    if (!phone) {
      console.warn(`[Webhook Apollo] Nenhum telefone no payload para person_id: ${personId}`)
      return NextResponse.json({ ok: true, skipped: 'no_phone' })
    }

    console.log(`[Webhook Apollo] Atualizando lead — person_id: ${personId} | phone: ${phone}`)

    const { data: leads, error: searchError } = await supabase
      .from('leads')
      .select('id, status, dados_apollo')
      .eq('status', 'needs_phone_reveal')
      .filter('dados_apollo->>person_id', 'eq', personId)

    if (searchError) {
      console.error('[Webhook Apollo] Erro ao buscar lead:', searchError.message)
      return NextResponse.json({ ok: false, error: searchError.message }, { status: 500 })
    }

    if (!leads || leads.length === 0) {
      console.warn(`[Webhook Apollo] Nenhum lead com status needs_phone_reveal para person_id: ${personId}`)
      return NextResponse.json({ ok: true, skipped: 'lead_not_found' })
    }

    const lead = leads[0]

    const { error: updateError } = await supabase
      .from('leads')
      .update({ whatsapp: phone, status: 'enriched' })
      .eq('id', lead.id)

    if (updateError) {
      console.error('[Webhook Apollo] Erro ao atualizar lead:', updateError.message)
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
    }

    console.log(`[Webhook Apollo] ✓ Lead atualizado — id: ${lead.id} | whatsapp: ${phone}`)

    return NextResponse.json({ ok: true, lead_id: lead.id, phone_saved: phone })

  } catch (err: any) {
    console.error('[Webhook Apollo] Erro inesperado:', err?.message || err)
    // Retornar 200 para o Apollo não retentar
    return NextResponse.json({ ok: true, error: 'internal_error' })
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'Blue Prospector — Apollo Webhook online',
    timestamp: new Date().toISOString(),
  })
}
