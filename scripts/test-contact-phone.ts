import * as dotenv from 'dotenv'
dotenv.config()
import axios from 'axios'

const HEADERS = {
  'X-Api-Key': process.env.APOLLO_API_KEY!,
  'Content-Type': 'application/json',
}

// Contatos que foram revelados manualmente no Apollo UI
// (adicione os nomes que você clicou em "Ver mobile" no UI)
const REVEALED_CONTACTS = [
  'Ana Monteiro',
]

const PHONE_FIELDS = [
  'phone', 'mobile_phone', 'sanitized_phone',
  'phone_numbers', 'personal_phone_numbers',
  'direct_phone_number', 'work_direct_phone',
  'home_phone', 'other_phone',
]

function extractPhoneFields(obj: any): Record<string, any> {
  const result: Record<string, any> = {}
  for (const field of PHONE_FIELDS) {
    if (obj[field] !== undefined && obj[field] !== null && obj[field] !== '') {
      result[field] = obj[field]
    }
  }
  return result
}

async function searchContact(name: string) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Buscando: "${name}"`)
  console.log('═'.repeat(60))

  // [1] POST /v1/contacts/search — contatos salvos no seu CRM Apollo
  console.log('\n[1] /v1/contacts/search (CRM Apollo):')
  try {
    const r = await axios.post(
      'https://api.apollo.io/v1/contacts/search',
      { q_keywords: name, page: 1, per_page: 5 },
      { headers: HEADERS }
    )
    const contacts = r.data?.contacts || []
    console.log(`    ${contacts.length} contato(s) encontrado(s)`)
    for (const c of contacts) {
      console.log(`\n  → ${c.name} | ${c.title || 'sem cargo'} | ${c.organization_name || 'sem empresa'}`)
      const phones = extractPhoneFields(c)
      if (Object.keys(phones).length > 0) {
        console.log('  ✓ TELEFONES:', JSON.stringify(phones, null, 4))
      } else {
        console.log('  ✗ Nenhum campo de telefone preenchido')
      }
      console.log('  Email:', c.email || 'null')
      console.log('  Campos completos:')
      console.log(JSON.stringify(c, null, 4))
    }
    if (contacts.length === 0) {
      console.log('  ℹ Contato não está salvo no CRM Apollo (nunca adicionado ou revelado)')
    }
  } catch (e: any) {
    console.error('  ✗ Erro:', e?.response?.data?.message || e.message)
    if (e?.response?.data) console.error('  Detalhes:', JSON.stringify(e.response.data))
  }

  // [2] POST /v1/people/match — tenta buscar por nome direto
  console.log('\n[2] /v1/people/match (por nome):')
  try {
    const nameParts = name.trim().split(' ')
    const r = await axios.post(
      'https://api.apollo.io/v1/people/match',
      {
        first_name: nameParts[0],
        last_name: nameParts.slice(1).join(' ') || undefined,
        reveal_personal_emails: true,
        reveal_phone_numbers: true,
      },
      { headers: HEADERS }
    )
    const p = r.data?.person
    if (p) {
      console.log(`  → ${p.name} | ${p.title || 'sem cargo'} | ${p.organization?.name || 'sem empresa'}`)
      const phones = extractPhoneFields(p)
      if (Object.keys(phones).length > 0) {
        console.log('  ✓ TELEFONES:', JSON.stringify(phones, null, 4))
      } else {
        console.log('  ✗ Nenhum campo de telefone preenchido')
      }
      console.log('  Email:', p.email || p.personal_emails?.[0] || 'null')
    } else {
      console.log('  ✗ Nenhuma pessoa retornada')
    }
  } catch (e: any) {
    console.error('  ✗ Erro:', e?.response?.data?.message || e.message)
  }
}

async function main() {
  console.log('\n=== Teste: Telefones em contatos revelados manualmente no Apollo ===')
  console.log('Objetivo: verificar se /contacts/search retorna phone após reveal no UI\n')

  for (const name of REVEALED_CONTACTS) {
    await searchContact(name)
  }

  console.log('\n\n=== CONCLUSÃO ===')
  console.log('Se /v1/contacts/search retornou telefone → webhook approach funciona')
  console.log('Se não retornou nada → Apollo não persiste o número na conta, webhook não resolve')
}

main().catch(console.error)
