import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const analysisRoot = path.join(root, 'public', 'library', 'dkc', 'Osnovnyye_elementy_korpusa_CQE_N', 'Собранные корпуса CQE N со сплошной дверью')
const input = path.join(analysisRoot, 'cqe-assembly-analysis.json')
const output = path.join(analysisRoot, 'cqe-geometry-analysis.json')
const tolerance = 1.0

const round = (v) => Math.round(v * 1000) / 1000
const dims = (s) => s?.bbox ? [s.bbox.dx, s.bbox.dy, s.bbox.dz].map(round).sort((a, b) => a - b) : null
const near = (a, b, t = tolerance) => Math.abs(a - b) <= t
const finite = (v) => Number.isFinite(v)

function signature(s) {
  const d = dims(s)
  if (!d) return null
  return d.map(v => Math.round(v / tolerance) * tolerance).join('x')
}

function normalizeObject(o, assembly) {
  const b = o.shape?.bbox
  const c = o.shape?.centerOfMass
  if (!b || !c) return null
  return {
    assembly: assembly.file,
    name: o.name,
    label: o.label,
    typeId: o.typeId,
    bbox: b,
    center: c,
    volume: o.shape.volume,
    area: o.shape.area,
    solids: o.shape.solids,
    faces: o.shape.faces,
    signature: signature(o.shape),
  }
}

function classifyByGeometry(o, assemblyBox) {
  if (!o?.bbox || !o?.center) return 'unknown'
  const b = o.bbox
  const c = o.center
  const sx = b.dx, sy = b.dy, sz = b.dz
  const largeX = sx > assemblyBox.dx * 0.65
  const largeY = sy > assemblyBox.dy * 0.65
  const largeZ = sz > assemblyBox.dz * 0.65
  const nearBottom = c.z - b.dz / 2 <= assemblyBox.zmin + 5
  const nearTop = c.z + b.dz / 2 >= assemblyBox.zmax - 5
  const tallVertical = sz > Math.max(sx, sy) * 3
  if (nearBottom && largeX && largeY) return 'candidate-base'
  if (nearTop && largeX && largeY) return 'candidate-roof'
  if (tallVertical && sz > assemblyBox.dz * 0.35) return 'candidate-post'
  return 'other'
}

function aggregate(objects) {
  const groups = new Map()
  for (const o of objects) {
    if (!o.signature) continue
    if (!groups.has(o.signature)) groups.set(o.signature, [])
    groups.get(o.signature).push(o)
  }
  return [...groups.entries()]
    .map(([signature, items]) => ({
      signature,
      count: items.length,
      assemblies: new Set(items.map(x => x.assembly)).size,
      minVolume: Math.min(...items.map(x => x.volume)),
      maxVolume: Math.max(...items.map(x => x.volume)),
      examples: items.slice(0, 10),
    }))
    .sort((a, b) => b.assemblies - a.assemblies || b.count - a.count)
}

async function main() {
  const data = JSON.parse(await fs.readFile(input, 'utf8'))
  const valid = data.assemblies.filter(a => a.assemblyBBox && a.objects?.length)
  const excluded = [...(data.failures ?? [])]
  const objects = valid.flatMap(a => a.objects.map(o => normalizeObject(o, a)).filter(Boolean))

  const assemblySummaries = valid.map(a => {
    const box = a.assemblyBBox
    const items = a.objects.map(o => normalizeObject(o, a)).filter(Boolean)
    const classified = {
      base: items.filter(o => classifyByGeometry(o, box) === 'candidate-base'),
      roof: items.filter(o => classifyByGeometry(o, box) === 'candidate-roof'),
      posts: items.filter(o => classifyByGeometry(o, box) === 'candidate-post'),
    }
    return {
      file: a.file,
      parsedArticleSize: a.parsedArticleSize,
      bbox: box,
      objectCount: items.length,
      classified,
      signatures: aggregate(items).slice(0, 30),
    }
  })

  const result = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    toleranceMm: tolerance,
    source: input,
    sourceAssemblyCount: data.assemblyCount,
    validAssemblyCount: valid.length,
    excludedCount: excluded.length,
    excluded,
    global: {
      objectCount: objects.length,
      recurringGeometry: aggregate(objects).slice(0, 100),
    },
    assemblies: assemblySummaries,
  }

  await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', 'utf8')
  console.log(`[CQE geometry] assemblies=${valid.length} objects=${objects.length}`)
  console.log(`[CQE geometry] excluded=${excluded.length}`)
  console.log(`[CQE geometry] recurring geometry groups=${result.global.recurringGeometry.length}`)
  console.log(`[CQE geometry] wrote ${output} (${(await fs.stat(output)).size} bytes)`)
}

main().catch(error => {
  console.error('[CQE geometry] FAILED:', error)
  process.exitCode = 1
})
