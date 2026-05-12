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

async function revealContact(person: any): Promise<any> {
  try {
    // Step 1: match by id/linkedin to get email + try phone
    const body: Record<string, any> = { reveal_personal_emails: true, reveal_phone_numbers: true }
    if (person.linkedin_url)  body.linkedin_url     = person.linkedin_url
    else if (person.id)       body.id               = person.id
    else {
      const name = person.name || person.first_name || ''
      if (!name) return person
      body.name              = name
      body.organization_name = person.organization?.name || ''
    }
    const r1 = await axios.post('https://api.apollo.io/v1/people/match', body, { headers: HEADERS })
    const p1 = r1.data?.person
    if (!p1) return person

    const email        = p1.email || p1.personal_emails?.[0] || person.email
    let phoneNumbers   = p1.phone_numbers?.length ? p1.phone_numbers : undefined
    let sanitizedPhone = p1.sanitized_phone || undefined

    // Step 2: if we have an email but still no phone, reveal again by email
    if (email && !phoneNumbers) {
      try {
        const r2 = await axios.post(
          'https://api.apollo.io/v1/people/match',
          { email, reveal_phone_numbers: true },
          { headers: HEADERS }
        )
        const p2 = r2.data?.person
        if (p2?.phone_numbers?.length) phoneNumbers   = p2.phone_numbers
        if (p2?.sanitized_phone)       sanitizedPhone = p2.sanitized_phone
      } catch { /* ignore */ }
    }

    return {
      ...person,
      name:            p1.name            || person.name,
      last_name:       p1.last_name       || person.last_name,
      linkedin_url:    p1.linkedin_url    || person.linkedin_url,
      email,
      personal_emails: p1.personal_emails || person.personal_emails,
      phone_numbers:   phoneNumbers       || person.phone_numbers,
      sanitized_phone: sanitizedPhone     || person.sanitized_phone,
    }
  } catch {
    return person
  }
}

export async function findContacts(domain: string, titles: string[]): Promise<any | null> {
  try {
    const body: Record<string, any> = {
      q_organization_domains_list: [domain],
      per_page: 10,
    }
    if (titles.length > 0) body.person_titles = titles
    const response = await axios.post(
      'https://api.apollo.io/v1/mixed_people/api_search',
      body,
      { headers: HEADERS }
    )
    // normalize names (Apollo free/paid may omit top-level `name`)
    let people = (response.data?.people || []).map((p: any) => ({
      ...p,
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.first_name || undefined,
    }))

    // reveal email + phone for up to 5 contacts that Apollo flags as available
    const toReveal = people
      .filter((p: any) => p.has_email || p.has_direct_phone === 'Yes' || p.has_direct_phone === true)
      .slice(0, 5)
    const revealedMap = new Map<string, any>()
    await Promise.all(toReveal.map(async (p: any) => {
      const enriched = await revealContact(p)
      revealedMap.set(p.id, enriched)
    }))
    people = people.map((p: any) => revealedMap.get(p.id) || p)

    return { ...response.data, people }
  } catch (err: any) {
    console.warn(`[Apollo] findContacts falhou para ${domain}:`, err?.response?.data?.message || err.message)
    return null
  }
}

export async function getJobPostings(orgId: string): Promise<any[]> {
  try {
    const response = await axios.get(
      `https://api.apollo.io/v1/organizations/${orgId}/job_postings`,
      { headers: HEADERS }
    )
    return response.data?.job_postings || []
  } catch (err: any) {
    console.warn(`[Apollo] getJobPostings falhou para orgId ${orgId}:`, err?.response?.data?.message || err.message)
    return []
  }
}

// Busca contato salvo no CRM Apollo por email — retorna número se já foi revelado no UI
export async function searchContactByEmail(email: string): Promise<any | null> {
  try {
    const response = await axios.post(
      'https://api.apollo.io/v1/contacts/search',
      { q_keywords: email, page: 1, per_page: 1 },
      { headers: HEADERS }
    )
    return response.data?.contacts?.[0] || null
  } catch (err: any) {
    console.warn(`[Apollo] searchContactByEmail falhou para ${email}:`, err?.response?.data?.message || err.message)
    return null
  }
}

// Solicita reveal assíncrono de telefone — Apollo chama APOLLO_WEBHOOK_URL quando processar
export async function requestPhoneReveal(contactId: string): Promise<boolean> {
  const webhookUrl = process.env.APOLLO_WEBHOOK_URL
  if (!webhookUrl) {
    console.warn('[Apollo] APOLLO_WEBHOOK_URL não configurado — reveal ignorado')
    return false
  }
  try {
    await axios.post(
      `https://api.apollo.io/v1/contacts/${contactId}/request_phone_number`,
      { webhook_url: webhookUrl },
      { headers: HEADERS }
    )
    return true
  } catch (err: any) {
    console.warn(
      `[Apollo] requestPhoneReveal falhou para contact ${contactId}:`,
      err?.response?.data?.message || err.message
    )
    return false
  }
}
