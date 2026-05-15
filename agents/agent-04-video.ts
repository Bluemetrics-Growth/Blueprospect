import * as dotenv from 'dotenv'
dotenv.config()

import { supabase } from '../lib/supabase'
import type { Lead, Company } from '../lib/supabase'
import { generateVideoScript } from '../lib/claude'
import { createAvatarVideo, waitForVideo } from '../lib/heygen'
import { sendVideo } from '../lib/evolution'

type LeadWithCompany = Lead & { companies: Company }

export async function runAgent(options: { limit?: number } = {}): Promise<void> {
  if (!process.env.HEYGEN_API_KEY || !process.env.HEYGEN_AVATAR_ID || !process.env.HEYGEN_VOICE_ID) {
    console.error('[Agente 04] HeyGen não configurado. Verifique HEYGEN_API_KEY, HEYGEN_AVATAR_ID e HEYGEN_VOICE_ID no .env')
    process.exit(1)
  }

  const { data: leads, error } = await supabase
    .from('leads')
    .select('*, companies(*)')
    .eq('status', 'in_crm')
    .eq('icp_score', 'A')

  if (error) {
    console.error('[Supabase] Erro ao buscar leads:', error.message)
    return
  }

  if (!leads || leads.length === 0) {
    console.log('[Agente 04] Nenhum lead com status "in_crm" e icp_score "A" encontrado.')
    return
  }

  const { data: sentVideos } = await supabase
    .from('messages')
    .select('lead_id')
    .eq('canal', 'whatsapp_video')
    .in('status', ['sent', 'video_pending'])

  const alreadySentIds = new Set((sentVideos || []).map((m: any) => m.lead_id))

  const pending = (leads as LeadWithCompany[]).filter(l => !alreadySentIds.has(l.id))
  const batch = options.limit ? pending.slice(0, options.limit) : pending

  if (batch.length === 0) {
    console.log('[Agente 04] Todos os leads Score A já receberam vídeo.')
    return
  }

  console.log(`\n[Agente 04] Gerando vídeos para ${batch.length} leads...\n`)
  console.log(`  Avatar: ${process.env.HEYGEN_AVATAR_ID}`)
  console.log(`  Voz: ${process.env.HEYGEN_VOICE_ID}\n`)

  let sent = 0
  let noPhone = 0
  let failed = 0

  for (const lead of batch) {
    const company = lead.companies
    if (!company) {
      console.warn(`⚠ Lead ${lead.id} sem empresa associada — pulando`)
      continue
    }

    console.log(`\n── ${company.nome} (${lead.vertical_bluedocs || 'sem vertical'}) ──`)

    try {
      const script = await generateVideoScript(
        {
          nome_contato: lead.nome_contato,
          vertical_bluedocs: lead.vertical_bluedocs,
          dor_primaria: lead.dor_primaria,
        },
        {
          nome: company.nome,
          uf: company.uf,
          setor: company.setor,
        }
      )

      const wordCount = script.split(' ').length
      console.log(`  Script (${wordCount} palavras): "${script}"`)

      const job = await createAvatarVideo({
        script,
        title: `${company.nome} — BlueDocs`,
        aspect_ratio: '9:16',
        resolution: '720p',
      })

      if (!job) {
        console.error(`  ✗ HeyGen não aceitou o vídeo`)
        await supabase.from('messages').insert({
          lead_id: lead.id,
          canal: 'whatsapp_video',
          conteudo: script,
          status: 'video_failed',
          sent_at: new Date().toISOString(),
        })
        failed++
        continue
      }

      console.log(`  Gerando vídeo — id: ${job.video_id}`)

      const result = await waitForVideo(job.video_id)

      if (!result || result.status !== 'completed' || !result.video_url) {
        console.error(`  ✗ Vídeo não ficou pronto`)
        await supabase.from('messages').insert({
          lead_id: lead.id,
          canal: 'whatsapp_video',
          conteudo: script,
          status: 'video_failed',
          sent_at: new Date().toISOString(),
        })
        failed++
        continue
      }

      console.log(`  ✓ Vídeo pronto — ${result.duration?.toFixed(1)}s | ${result.video_url}`)

      if (lead.whatsapp) {
        const ok = await sendVideo(lead.whatsapp, result.video_url)

        await supabase.from('messages').insert({
          lead_id: lead.id,
          canal: 'whatsapp_video',
          conteudo: JSON.stringify({
            script,
            video_url: result.video_url,
            duration: result.duration,
          }),
          status: ok ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
        })

        await supabase
          .from('leads')
          .update({ status: ok ? 'contacted' : 'contact_failed' })
          .eq('id', lead.id!)

        if (ok) {
          console.log(`  ✓ Vídeo enviado via WhatsApp`)
          sent++
        } else {
          console.warn(`  ✗ Falha no envio WhatsApp`)
          failed++
        }
      } else {
        await supabase.from('messages').insert({
          lead_id: lead.id,
          canal: 'whatsapp_video',
          conteudo: JSON.stringify({
            script,
            video_url: result.video_url,
            duration: result.duration,
          }),
          status: 'no_phone',
          sent_at: new Date().toISOString(),
        })
        console.warn(`  ⚠ Sem WhatsApp — vídeo salvo para envio manual`)
        noPhone++
      }

    } catch (err: any) {
      console.error(`  ✗ Erro inesperado em ${company.nome}:`, err?.message || err)
      failed++
    }
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`Agente 04 concluído:`)
  console.log(`  ✓ Enviados:     ${sent}`)
  console.log(`  ⚠ Sem telefone: ${noPhone} (vídeos salvos para envio manual)`)
  console.log(`  ✗ Falhas:       ${failed}`)
  console.log(`${'─'.repeat(50)}\n`)
}

if (require.main === module) {
  runAgent().catch(console.error)
}
