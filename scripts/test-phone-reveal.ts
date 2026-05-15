import * as dotenv from 'dotenv'
dotenv.config()

import axios from 'axios'

const HEADERS = {
  'X-Api-Key': process.env.APOLLO_API_KEY!,
  'Content-Type': 'application/json',
}

async function main() {
  console.log('=== Teste Phone Reveal — Apollo webhook ===\n')
  console.log(`APOLLO_API_KEY:    ${process.env.APOLLO_API_KEY ? '✓' : '✗ NÃO CONFIGURADA'}`)
  console.log(`APOLLO_WEBHOOK_URL: ${process.env.APOLLO_WEBHOOK_URL || '✗ NÃO CONFIGURADA'}`)
  console.log()

  if (!process.env.APOLLO_API_KEY) {
    console.error('Configure APOLLO_API_KEY no .env')
    return
  }

  if (!process.env.APOLLO_WEBHOOK_URL) {
    console.error('Configure APOLLO_WEBHOOK_URL no .env')
    console.error('Para teste local, use: https://webhook.site/SEU-ID')
    return
  }

  // Contato de teste — Ana Monteiro (Claro Brasil), sabemos que tem celular
  const body = {
    email: 'ana.monteiro@claro.com.br',
    reveal_phone_numbers: true,
    reveal_personal_emails: true,
    webhook_url: process.env.APOLLO_WEBHOOK_URL,
  }

  console.log('[1] Chamando /v1/people/match com reveal_phone_numbers: true...')
  console.log(`    webhook_url: ${body.webhook_url}\n`)

  try {
    const response = await axios.post(
      'https://api.apollo.io/v1/people/match',
      body,
      { headers: HEADERS }
    )

    const person = response.data?.person
    console.log(`✓ Resposta recebida`)
    console.log(`  person_id:      ${person?.id || 'não retornado'}`)
    console.log(`  nome:           ${person?.name || '—'}`)
    console.log(`  email:          ${person?.email || '—'}`)
    console.log(`  phone (sync):   ${person?.sanitized_phone || person?.phone_numbers?.[0]?.sanitized_number || 'não retornado (esperado)'}`)
    console.log()

    if (!person?.sanitized_phone && !person?.phone_numbers?.length) {
      console.log('→ Telefone não veio na resposta síncrona (comportamento esperado).')
      console.log('→ Apollo vai processar o reveal e POST no webhook em ~1-5 minutos.')
      console.log()
      console.log('Próximos passos:')
      if (process.env.APOLLO_WEBHOOK_URL?.includes('webhook.site')) {
        console.log(`  1. Abra ${process.env.APOLLO_WEBHOOK_URL.replace('/seu-id', '')} e aguarde o POST do Apollo`)
      } else {
        console.log('  1. Aguarde ~5 minutos')
        console.log('  2. Verifique no Supabase: leads WHERE status = \'enriched\' ORDER BY updated_at DESC')
      }
      console.log('  3. Se o telefone chegar, o webhook está funcionando corretamente')
    } else {
      console.log('→ Telefone já disponível na resposta síncrona (contato previamente revelado).')
      console.log(`  Número: ${person?.sanitized_phone || person?.phone_numbers?.[0]?.sanitized_number}`)
    }

  } catch (err: any) {
    console.error('✗ Falha na chamada Apollo:')
    console.error(err?.response?.data || err.message)
  }
}

main().catch(console.error)
