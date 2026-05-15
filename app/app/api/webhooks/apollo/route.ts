import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy init — evita falha de build quando env vars não estão disponíveis
let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
  }
  return _supabase
}

interface ApolloPhoneNumber {
  raw_number?: string
  sanitized_number?: string
  // Apollo webhook usa type_cd / status_cd; people/match usa type / status
  type?: string
  type_cd?: string
  status?: string
  status_cd?: string
  position?: number
}

// Format A: { person_id, phone_numbers[] } ou { data: { ... } }
interface ApolloWebhookFormatA {
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

// Format B: { people: [{ id, phone_numbers[] }] }
interface ApolloWebhookFormatB {
  status?: string
  people?: Array<{
    id?: string
    person_id?: string
    status?: string
    phone_numbers?: ApolloPhoneNumber[]
    sanitized_phone?: string
    sanitized_number?: string
  }>
}

type ApolloWebhookPayload = ApolloWebhookFormatA & ApolloWebhookFormatB

function bestPhone(phones: ApolloPhoneNumber[], fallback?: string): string | null {
  if (!phones.length) return fallback || null

  // Prioridade 1: mobile válido (suporta type_cd e type)
  const mobile = phones.find(
    (p) => (p.type_cd === 'mobile' || p.type === 'mobile') &&
           (p.status_cd === 'valid_number' || p.status === 'valid_number')
  )
  if (mobile?.sanitized_number) return mobile.sanitized_number

  // Prioridade 2: qualquer número válido
  const valid = phones.find(
    (p) => p.status_cd === 'valid_number' || p.status === 'valid_number'
  )
  if (valid?.sanitized_number) return valid.sanitized_number

  // Prioridade 3: primeiro disponível
  return phones[0]?.sanitized_number || fallback || null
}

async function updateLeadPhone(personId: string, phone: string): Promise<string | null> {
  const supabase = getSupabase()
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id')
    .eq('status', 'needs_phone_reveal')
    .filter('dados_apollo->>person_id', 'eq', personId)

  if (error) {
    console.error('[Webhook Apollo] Erro ao buscar lead:', error.message)
    return null
  }

  if (!leads || leads.length === 0) {
    console.warn(`[Webhook Apollo] Nenhum lead needs_phone_reveal para person_id: ${personId}`)
    return null
  }

  const lead = leads[0]
  const { error: updateError } = await supabase
    .from('leads')
    .update({ whatsapp: phone, status: 'enriched' })
    .eq('id', lead.id)

  if (updateError) {
    console.error('[Webhook Apollo] Erro ao atualizar lead:', updateError.message)
    return null
  }

  console.log(`[Webhook Apollo] ✓ lead ${lead.id} | person_id: ${personId} | whatsapp: ${phone}`)
  return lead.id
}

export async function POST(request: NextRequest) {
  try {
    const payload: ApolloWebhookPayload = await request.json()
    console.log('[Webhook Apollo] Payload:', JSON.stringify(payload, null, 2))

    const updated: string[] = []

    // Format B: { people: [...] }
    if (Array.isArray(payload.people) && payload.people.length > 0) {
      for (const person of payload.people) {
        const personId = person.id || person.person_id
        const phone = bestPhone(
          person.phone_numbers || [],
          person.sanitized_phone || person.sanitized_number
        )
        if (personId && phone) {
          const leadId = await updateLeadPhone(personId, phone)
          if (leadId) updated.push(leadId)
        }
      }
      return NextResponse.json({ ok: true, updated })
    }

    // Format A: person_id direto ou dentro de data
    const personId =
      payload.person_id || payload.id ||
      payload.data?.person_id || payload.data?.id || null

    const phone = bestPhone(
      payload.phone_numbers || payload.data?.phone_numbers || [],
      payload.sanitized_phone || payload.data?.sanitized_phone
    )

    if (!personId) {
      console.warn('[Webhook Apollo] person_id não encontrado no payload')
      return NextResponse.json({ ok: true, skipped: 'no_person_id' })
    }

    if (!phone) {
      console.warn(`[Webhook Apollo] Nenhum telefone no payload para person_id: ${personId}`)
      return NextResponse.json({ ok: true, skipped: 'no_phone' })
    }

    const leadId = await updateLeadPhone(personId, phone)
    return NextResponse.json({ ok: true, updated: leadId ? [leadId] : [] })

  } catch (err: any) {
    console.error('[Webhook Apollo] Erro inesperado:', err?.message || err)
    // Sempre 200 — Apollo não deve retentar
    return NextResponse.json({ ok: true, error: 'internal_error' })
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'Blue Prospector — Apollo Webhook online',
    timestamp: new Date().toISOString(),
  })
}
