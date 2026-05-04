// Executa os 3 agentes em sequência: Enrichment → HubSpot → WhatsApp
import { runAgent as runAgent1 } from '../agents/agent-01-enrichment'
import { runAgent as runAgent2 } from '../agents/agent-02-hubspot'
import { runAgent as runAgent3 } from '../agents/agent-03-whatsapp'

async function main() {
  const totalStart = Date.now()
  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║  BlueDocs Prospecting System — Full Run  ║')
  console.log('╚══════════════════════════════════════════╝\n')

  const elapsed = (start: number) => `${((Date.now() - start) / 1000).toFixed(1)}s`

  // Agente 01 — Enrichment
  console.log('▶ [1/3] Agente 01: Apollo + Claude Enrichment')
  const t1 = Date.now()
  await runAgent1()
  console.log(`   Concluído em ${elapsed(t1)}\n`)

  // Agente 02 — HubSpot CRM
  console.log('▶ [2/3] Agente 02: HubSpot CRM')
  const t2 = Date.now()
  await runAgent2()
  console.log(`   Concluído em ${elapsed(t2)}\n`)

  // Agente 03 — WhatsApp
  console.log('▶ [3/3] Agente 03: WhatsApp')
  const t3 = Date.now()
  await runAgent3()
  console.log(`   Concluído em ${elapsed(t3)}\n`)

  console.log(`╔══════════════════════════════════════════╗`)
  console.log(`║  Pipeline completo em ${elapsed(totalStart).padEnd(18)} ║`)
  console.log(`╚══════════════════════════════════════════╝\n`)
}

main().catch((err) => {
  console.error('Erro fatal no pipeline:', err)
  process.exit(1)
})
