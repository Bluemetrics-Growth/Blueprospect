import axios from 'axios'
import * as dotenv from 'dotenv'
dotenv.config()

const HEADERS = {
  'X-Api-Key': process.env.APOLLO_API_KEY!,
  'Content-Type': 'application/json',
}

export async function enrichCompany(domain: string): Promise<any | null> {
  try {
    const response = await axios.post(
      'https://api.apollo.io/v1/organizations/enrich',
      { domain },
      { headers: HEADERS }
    )
    return response.data?.organization || null
  } catch (err: any) {
    console.warn(`[Apollo] enrichCompany falhou para ${domain}:`, err?.response?.data?.message || err.message)
    return null
  }
}

export async function findContacts(domain: string, titles: string[]): Promise<any | null> {
  try {
    const response = await axios.post(
      'https://api.apollo.io/v1/mixed_people/api_search',
      {
        q_organization_domains: [domain],
        person_titles: titles,
        per_page: 3,
      },
      { headers: HEADERS }
    )
    return response.data || null
  } catch (err: any) {
    console.warn(`[Apollo] findContacts falhou para ${domain}:`, err?.response?.data?.message || err.message)
    return null
  }
}
