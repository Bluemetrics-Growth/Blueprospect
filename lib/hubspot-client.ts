import * as dotenv from 'dotenv'
dotenv.config()

async function hsGet(path: string): Promise<any> {
  const resp = await fetch(`https://api.hubapi.com${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  })
  const text = await resp.text()
  let data: any = {}
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  if (!resp.ok) throw new Error(`HubSpot ${resp.status}: ${data.message || text}`)
  return data
}

export async function getContactPhone(contactId: string): Promise<string | null> {
  const data = await hsGet(
    `/crm/v3/objects/contacts/${contactId}?properties=hs_whatsapp_phone_number,mobilephone,phone`
  )
  const p = data?.properties
  return p?.hs_whatsapp_phone_number || p?.mobilephone || p?.phone || null
}
