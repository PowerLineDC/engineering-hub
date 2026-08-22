import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const analysisRoot = path.join(root, 'public', 'library', 'dkc', 'Osnovnyye_elementy_korpusa_CQE_N', 'Собранные корпуса CQE N со сплошной дверью')
const input = path.join(analysisRoot, 'cqe-assembly-analysis.json')
const output = path.join(analysisRoot, 'cqe-geometry-analysis.json')
const tolerance = 1.0
const MAX_ABS_COORD = 1e9

const round = (v) => Math.round(v * 1000) / 1000
const finite = (v) => Number.isFinite(v)
const validNumber = (v) => finite(v) && Math.abs(v) < MAX_ABS_COORD

function validBBox(b) {
  if (!b) return false
  const values = [b.xmin, b.ymin, b.zmin, b.xmax, b.ymax, b.zmax, b.dx, b.dy, b.dz]
  if (!values.every(validNumber)) return false
  return b.dx >= 0 && b.dy >= 0 && b.dz >= 0 && b.dx < MAX_ABS_COORD && b.dy < MAX_ABS_COORD && b.dz < MAX_ABS_COORD
}

function validCenter(c) {
  return c && validNumber(c.x) && validNumber(c.y) && validNumber(c.z)
}

function dims(s) {
  if (!s?.bbox || !validBBox(s.bbox)) return null
  return [s.bbox.dx, s.bbox.dy, s.bbox.dz].map(round).sort((a, b) => a - b)
}

function signature(s) {
  const d = dims(s)
  if (!d) return null
  return d.map(v => Math.round(v / tolerance) * tolerance).join('x')
}

function normalizeObject(o, assembly) {
  const b = o.shape?.bbox
  const c = o.shape?.centerOfMass
  if (!validBBox(b) || !validCenter(c)) return null
  return {
    assembly: assembly.file,
    name: o.name,
    label: o.label,
    typeId: o.typeId,
    bbox: b,
    center: c,
    volume: validNumber(o.shape.volume) ? o.shape.volume : null,
    area: validNumber(o.shape.area) ? o.shape.area : null,
    solids: o.shape.solids,
    faces: o.shape.faces,
    signature: signature(o.shape),
  }
}

function validAssembly(a) {
  if (!a?.assemblyBBox || !validBBox(a.assemblyBBox) || !Array.isArray(a.objects) || !a.objects.length) return false
  const finiteObjectCount = a.objects.filter(o => validBBox(o?.shape?.bbox) && validCenter(o?.shape?.centerOfMass)).length
  return finiteObjectCount > 0
}

function classifyByGeometry(o, assemblyBox) {
  if (!o?.bbox || !o?.center || !validBBox(assemblyBox)) return 'unknown'
  const b = o.bbox
  const c = o.center
  const largeX = b.dx > assemblyBox.dx * 0.65
  const largeY = b.dy > assemblyBox.dy * 0.65
  const nearBottom = c.z - b.dz / 2 <= assemblyBox.zmin + 5
  const nearTop = c.z + b.dz / 2 >= assemblyBox.zmax - 5
  const tallVertical = b.dz > Math.max(b.dx, b.dy) * 3
  if (nearBottom && largeX && largeY) return 'candidate-base'
  if (nearTop && largeX && largeY) return 'candidate-roof'
  if (tallVertical && b.dz > assemblyBox.dz * 0.35) return 'candidate-post'
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
      minVolume: Math.min(...items.filter(x => x.volume != null).map(x => x.volume)),
      maxVolume: Math.max(...items.filter(x => x.volume != null).map(x => x.volume)),
      examples: items.slice(0, 10),
    }))
    .sort((a, b) => b.assemblies - a.assemblies || b.count - a.count)
}

async function main() {
  const data = JSON.parse(await fs.readFile(input, 'utf8'))
  const sourceAssemblies = Array.isArray(data.assemblies) ? data.assemblies : []
  const valid = sourceAssemblies.filter(validAssembly)
  const excluded = sourceAssemblies
    .filter(a => !validAssembly(a))
    .map(a => ({
      file: a?.file ?? null,
      reason: 'invalid assembly or invalid/non-finite bounding box/center data',
      assemblyBBox: a?.assemblyBBox ?? null,
    }))

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
      invalidObjectCount: a.objects.length - items.length,
      classified,
      signatures: aggregate(items).slice(0, 30),
    }
  })

  const result = {
    schemaVersion: 2,
    generatedAtUtc: new Date().toISOString(),
    toleranceMm: tolerance,
    source: input,
    sourceAssemblyCount: sourceAssemblies.length,
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
  console.log(`[CQE geometry] source assemblies=${sourceAssemblies.length}`)
  console.log(`[CQE geometry] valid assemblies=${valid.length}`)
  console.log(`[CQE geometry] excluded assemblies=${excluded.length}`)
  for (const item of excluded) console.log(`[CQE geometry] EXCLUDED ${item.file}: ${item.reason}`)
  console.log(`[CQE geometry] valid objects=${objects.length}`)
  console.log(`[CQE geometry] recurring geometry groups=${result.global.recurringGeometry.length}`)
  console.log(`[CQE geometry] wrote ${output} (${(await fs.stat(output)).size} bytes)`)
}

main().catch(error => {
  console.error('[CQE geometry] FAILED:', error)
  process.exitCode = 1
})
