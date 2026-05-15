import axios from 'axios'
import * as dotenv from 'dotenv'
dotenv.config()

const BASE_URL = 'https://api.heygen.com'

function headers() {
  return {
    'x-api-key': process.env.HEYGEN_API_KEY!,
    'Content-Type': 'application/json',
  }
}

export interface HeyGenVideoJob {
  video_id: string
  status: string
}

export interface HeyGenVideoResult {
  video_id: string
  status: string
  video_url?: string
  thumbnail_url?: string
  duration?: number
  failure_message?: string
}

export async function createAvatarVideo(params: {
  script: string
  title?: string
  aspect_ratio?: '16:9' | '9:16'
  resolution?: '720p' | '1080p'
  callback_url?: string
}): Promise<HeyGenVideoJob | null> {
  try {
    const body: any = {
      type: 'avatar',
      avatar_id: process.env.HEYGEN_AVATAR_ID!,
      script: params.script,
      voice_id: process.env.HEYGEN_VOICE_ID!,
      title: params.title || 'Blue Prospector',
      aspect_ratio: params.aspect_ratio || '9:16',
      resolution: params.resolution || '720p',
    }

    if (params.callback_url) body.callback_url = params.callback_url

    const response = await axios.post(
      `${BASE_URL}/v3/videos`,
      body,
      { headers: headers() }
    )

    return response.data?.data || null
  } catch (err: any) {
    console.error('[HeyGen] createAvatarVideo falhou:', err?.response?.data || err.message)
    return null
  }
}

export async function getVideoStatus(video_id: string): Promise<HeyGenVideoResult | null> {
  try {
    const response = await axios.get(
      `${BASE_URL}/v3/videos/${video_id}`,
      { headers: headers() }
    )
    return response.data?.data || null
  } catch (err: any) {
    console.error(`[HeyGen] getVideoStatus falhou:`, err?.response?.data || err.message)
    return null
  }
}

export async function waitForVideo(
  video_id: string,
  maxAttempts = 60,
  intervalMs = 10000
): Promise<HeyGenVideoResult | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await getVideoStatus(video_id)
    if (!result) return null

    console.log(`  [HeyGen] status: ${result.status} (${i + 1}/${maxAttempts})`)

    if (result.status === 'completed') return result
    if (result.status === 'failed') {
      console.error(`  [HeyGen] Falhou: ${result.failure_message}`)
      return result
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  console.error(`[HeyGen] Timeout — vídeo ${video_id}`)
  return null
}
