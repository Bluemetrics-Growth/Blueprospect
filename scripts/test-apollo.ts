import * as dotenv from 'dotenv'
dotenv.config()
import axios from 'axios'

const HEADERS = {
  'X-Api-Key': process.env.APOLLO_API_KEY!,
  'Content-Type': 'application/json',
}

async function test() {
  const domain = 'federalpetroleo.com.br'
  console.log(`\n=== Testando Apollo com domínio: ${domain} ===\n`)

  console.log('[1] enrichCompany...')
  try {
    const r1 = await axios.post('https://api.apollo.io/v1/organizations/enrich', { domain }, { headers: HEADERS })
    const org = r1.data?.organization
    if (org) {
      console.log(`✓ Empresa: ${org.name}`)
      console.log(`  Setor: ${org.industry}`)
      console.log(`  Funcionários: ${org.estimated_num_employees}`)
      console.log(`  Tecnologias: ${org.technology_names?.slice(0, 5).join(', ') || 'nenhuma'}`)
    } else {
      console.log('⚠ Retornou vazio')
    }
  } catch (e: any) {
    console.error('✗ Erro:', e?.response?.data?.message || e.message)
  }

  console.log('\n[2] findContacts (CFO, Diretor Jurídico, Compliance)...')
  try {
    const r2 = await axios.post('https://api.apollo.io/v1/mixed_people/api_search', {
      q_organization_domains: [domain],
      person_titles: ['CFO', 'Diretor Jurídico', 'Compliance'],
      per_page: 3,
    }, { headers: HEADERS })
    const people = r2.data?.people || []
    console.log(`✓ ${people.length} contatos encontrados`)
    people.forEach((p: any) => {
      console.log(`  - ${p.name} | ${p.title} | ${p.email || 'sem email'}`)
    })
  } catch (e: any) {
    console.error('✗ Erro:', e?.response?.data?.message || e.message)
  }
}

test().catch(console.error)
