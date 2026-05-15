import * as dotenv from 'dotenv'
dotenv.config()

import { createAvatarVideo, waitForVideo } from '../lib/heygen'
import { generateVideoScript } from '../lib/claude'

async function main() {
  console.log('=== Teste Agente 04 — HeyGen + Blue Prospector ===\n')
  console.log(`HEYGEN_API_KEY:   ${process.env.HEYGEN_API_KEY ? '✓ configurada' : '✗ NÃO CONFIGURADA'}`)
  console.log(`HEYGEN_AVATAR_ID: ${process.env.HEYGEN_AVATAR_ID || '✗ NÃO CONFIGURADO'}`)
  console.log(`HEYGEN_VOICE_ID:  ${process.env.HEYGEN_VOICE_ID || '✗ NÃO CONFIGURADO'}`)
  console.log()

  if (!process.env.HEYGEN_API_KEY || !process.env.HEYGEN_AVATAR_ID || !process.env.HEYGEN_VOICE_ID) {
    console.error('✗ Configure as variáveis HeyGen no .env antes de continuar.')
    return
  }

  console.log('[1] Gerando script com Claude API...')
  const script = await generateVideoScript(
    {
      nome_contato: 'Renata',
      vertical_bluedocs: 'healthcare',
      dor_primaria: 'O Hospital São Lucas revisa manualmente centenas de contratos de convênio e fornecedores por mês, consumindo horas do time jurídico e aumentando o risco de erros.',
    },
    {
      nome: 'Hospital São Lucas',
      uf: 'PE',
      setor: 'Healthcare',
    }
  )

  const wordCount = script.split(' ').length
  console.log(`✓ Script gerado (${wordCount} palavras — ~${Math.round(wordCount / 130 * 60)}s):`)
  console.log(`  "${script}"`)
  console.log()

  if (wordCount > 65) {
    console.warn(`⚠ Script com ${wordCount} palavras — pode passar de 30s`)
  }

  console.log('[2] Criando vídeo no HeyGen...')

  const job = await createAvatarVideo({
    script,
    title: 'Blue Prospector — Teste Healthcare',
    aspect_ratio: '9:16',
    resolution: '720p',
  })

  if (!job) {
    console.error('✗ Falha ao criar vídeo. Verifique a HEYGEN_API_KEY.')
    return
  }

  console.log(`✓ Vídeo criado — video_id: ${job.video_id}`)
  console.log('Aguardando geração (2-5 minutos)...\n')

  const result = await waitForVideo(job.video_id)

  if (result?.status === 'completed') {
    console.log('✓ SUCESSO!')
    console.log(`  URL:     ${result.video_url}`)
    console.log(`  Duração: ${result.duration}s`)
    console.log()
    console.log('→ Abra a URL no browser para verificar o vídeo.')
    console.log('→ Se ficou bom, rode: npx ts-node scripts/run-agent.ts 4 --limit 1')
  } else {
    console.log(`✗ Falhou: ${result?.failure_message || 'erro desconhecido'}`)
  }
}

main().catch(console.error)
