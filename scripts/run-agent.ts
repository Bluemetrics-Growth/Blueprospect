// Uso:
//   npx ts-node scripts/run-agent.ts 1 [--limit N] [--file path.json]
//   npx ts-node scripts/run-agent.ts 2 [--limit N]
//   npx ts-node scripts/run-agent.ts 3 [--limit N]
//   npx ts-node scripts/run-agent.ts 0 --mode aws_list   [--scores A+,A] [--setores Healthcare,Financial] [--ufs CE,BA] [--produto bluedocs] [--limit N]
//   npx ts-node scripts/run-agent.ts 0 --mode apollo_search --setores Healthcare --ufs SP,RJ --produto bluedocs [--limit 25]
//   npx ts-node scripts/run-agent.ts 0 --mode csv_upload --file data/leads.csv --produto bluedocs
//   npx ts-node scripts/run-agent.ts 0 --mode aws_list --scores A+ --pipeline   (00 → 01)
//   npx ts-node scripts/run-agent.ts 0 --mode aws_list --scores A+ --pipeline --full  (00 → 01 → 02)

import { captureLeads, type AWSFilters, type ApolloFilters, type CSVUploadOptions, type CapturedLead } from '../agents/agent-00-capture'
import { runAgent as runAgent1 } from '../agents/agent-01-enrichment'
import { runAgent as runAgent2 } from '../agents/agent-02-hubspot'
import { runAgent as runAgent3 } from '../agents/agent-03-whatsapp'

// ─── CLI arg helpers ──────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const agentNum = parseInt(args[0] || '1', 10)

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : undefined
}

function hasFlag(name: string): boolean {
  return args.includes(name)
}

function getList(name: string): string[] | undefined {
  const val = getFlag(name)
  return val ? val.split(',').map(s => s.trim()) : undefined
}

const limit   = getFlag('--limit')  ? parseInt(getFlag('--limit')!, 10) : undefined
const file    = getFlag('--file')
const mode    = getFlag('--mode')    as 'aws_list' | 'apollo_search' | 'csv_upload' | undefined
const scores  = getList('--scores') as ('A+' | 'A' | 'B')[] | undefined
const setores = getList('--setores')
const ufs     = getList('--ufs')
const produto = (getFlag('--produto') || 'bluedocs') as 'bluedocs' | 'blueassistant' | 'blueops' | 'bluerisk'
const pipeline = hasFlag('--pipeline')
const full     = hasFlag('--full')

// ─── Agent runners ────────────────────────────────────────────────────────────

async function runAgent0(): Promise<CapturedLead[]> {
  if (!mode) {
    console.error('Agente 0 requer --mode (aws_list | apollo_search | csv_upload)')
    process.exit(1)
  }

  if (mode === 'aws_list') {
    const filters: AWSFilters = {
      scores:       scores ?? ['A+', 'A', 'B'],
      setores,
      ufs,
      produto_alvo: produto,
    }
    return captureLeads('aws_list', filters)
  }

  if (mode === 'apollo_search') {
    const filters: ApolloFilters = {
      produto_alvo: produto,
      setores,
      ufs,
      limit,
    }
    return captureLeads('apollo_search', filters)
  }

  if (mode === 'csv_upload') {
    if (!file) {
      console.error('csv_upload requer --file')
      process.exit(1)
    }
    const opts: CSVUploadOptions = { filePath: file, produto_alvo: produto }
    return captureLeads('csv_upload', opts)
  }

  console.error(`Modo inválido: ${mode}`)
  process.exit(1)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n=== Blue Prospector — Agente ${agentNum} ===`)
if (limit)    console.log(`Limite: ${limit} leads`)
if (file)     console.log(`Arquivo: ${file}`)
if (pipeline) console.log('Modo: pipeline 00 → 01' + (full ? ' → 02' : ''))
console.log()

;(async () => {
  if (agentNum === 0) {
    const captured = await runAgent0()

    if (pipeline && captured.length > 0) {
      console.log(`\n=== Blue Prospector — Agente 1 (pipeline) ===\n`)
      const enrichedIds = await runAgent1({ leads: captured, limit })

      if (full && enrichedIds.length > 0) {
        console.log(`\n=== Blue Prospector — Agente 2 (pipeline) ===\n`)
        await runAgent2({ leadIds: enrichedIds })
      }
    }
    return
  }

  const opts1 = { ...(limit && { limit }), ...(file && { file }) }

  if (agentNum === 1) return runAgent1(opts1)
  if (agentNum === 2) return runAgent2({ limit })
  if (agentNum === 3) return runAgent3({ limit })

  console.error(`Agente inválido: ${agentNum}. Use 0, 1, 2 ou 3.`)
  process.exit(1)
})().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
