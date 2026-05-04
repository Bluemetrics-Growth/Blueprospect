// Uso: npx ts-node scripts/run-agent.ts <1|2|3> [--limit N]
import { runAgent as runAgent1 } from '../agents/agent-01-enrichment'
import { runAgent as runAgent2 } from '../agents/agent-02-hubspot'
import { runAgent as runAgent3 } from '../agents/agent-03-whatsapp'

const args = process.argv.slice(2)
const agentNum = parseInt(args[0] || '1', 10)

const limitIdx = args.indexOf('--limit')
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined

const options = limit ? { limit } : {}

const AGENTS: Record<number, (opts: { limit?: number }) => Promise<void>> = {
  1: runAgent1,
  2: runAgent2,
  3: runAgent3,
}

const agent = AGENTS[agentNum]
if (!agent) {
  console.error(`Agente inválido: ${agentNum}. Use 1, 2 ou 3.`)
  process.exit(1)
}

console.log(`\n=== BlueDocs Prospecting — Agente ${agentNum} ===`)
if (limit) console.log(`Modo teste: processando apenas ${limit} leads\n`)

agent(options).catch((err) => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
