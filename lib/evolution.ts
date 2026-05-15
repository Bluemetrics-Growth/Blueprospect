import axios from 'axios'
import * as dotenv from 'dotenv'
dotenv.config()

export async function sendMessage(phone: string, message: string): Promise<boolean> {
  try {
    const url = `${process.env.EVOLUTION_API_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`
    await axios.post(
      url,
      { number: phone, text: message },
      { headers: { apikey: process.env.EVOLUTION_API_KEY } }
    )
    return true
  } catch (err: any) {
    console.error('[Evolution] sendMessage falhou:', err?.response?.data || err.message)
    return false
  }
}

// ── AGENTE 04 — Envio de vídeo ──────────────────────────

export async function sendVideo(
  phone: string,
  videoUrl: string,
  caption?: string
): Promise<boolean> {
  try {
    const url = `${process.env.EVOLUTION_API_URL}/message/sendMedia/${process.env.EVOLUTION_INSTANCE}`
    await axios.post(
      url,
      {
        number: phone,
        mediatype: 'video',
        media: videoUrl,
        caption: caption || '',
      },
      { headers: { apikey: process.env.EVOLUTION_API_KEY } }
    )
    return true
  } catch (err: any) {
    console.error('[Evolution] sendVideo falhou:', err?.response?.data || err.message)
    return false
  }
}
