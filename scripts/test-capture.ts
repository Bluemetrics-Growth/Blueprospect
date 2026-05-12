import * as dotenv from 'dotenv'
dotenv.config()

import { captureLeads } from '../agents/agent-00-capture'

async function main() {
  console.log('\n=== BlueSignal — Agente 00 Testes ===\n')

  // ── Modo 1: AWS list com filtros ──────────────────────────────────────────
  console.log('--- Modo 1: AWS List ---')
  const awsLeads = await captureLeads('aws_list', {
    scores: ['A'],
    setores: ['Healthcare', 'Financial'],
    ufs: ['CE', 'BA', 'PE'],
    produto_alvo: 'bluedocs',
  })
  console.log(`AWS: ${awsLeads.length} leads`)
  if (awsLeads.length > 0) {
    awsLeads.slice(0, 3).forEach(l =>
      console.log(`  • ${l.nome} | ${l.setor} | ${l.uf} | icp: ${l.icp_score}`)
    )
  }

  console.log()

  // ── Modo 2: Apollo search ─────────────────────────────────────────────────
  console.log('--- Modo 2: Apollo Search ---')
  const apolloLeads = await captureLeads('apollo_search', {
    produto_alvo: 'bluedocs',
    setores: ['Healthcare', 'Financial Services'],
    ufs: ['SP', 'RJ', 'MG'],
    limit: 5,
  })
  console.log(`Apollo: ${apolloLeads.length} leads`)
  if (apolloLeads.length > 0) {
    apolloLeads.forEach(l =>
      console.log(`  • ${l.nome} | ${l.setor} | ${l.uf} | fat: ${l.faturamento_usd?.toLocaleString('pt-BR')}`)
    )
  }

  console.log()

  // ── Modo 3: CSV upload ────────────────────────────────────────────────────
  console.log('--- Modo 3: CSV Upload ---')
  const csvLeads = await captureLeads('csv_upload', {
    filePath: './data/test-upload.csv',
    produto_alvo: 'bluedocs',
  })
  console.log(`CSV: ${csvLeads.length} leads`)
  if (csvLeads.length > 0) {
    csvLeads.forEach(l =>
      console.log(`  • ${l.nome} | ${l.setor} | ${l.uf} | fat: ${l.faturamento_usd?.toLocaleString('pt-BR')} | icp: ${l.icp_score}`)
    )
  }

  console.log('\n=== Testes concluídos ===')
}

main().catch(console.error)
