import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const analysisRoot = path.join(root, 'public', 'library', 'dkc', 'Osnovnyye_elementy_korpusa_CQE_N', 'Собранные корпуса CQE N со сплошной дверью')
const assemblyInput = path.join(analysisRoot, 'cqe-assembly-analysis.json')
const geometryInput = path.join(analysisRoot, 'cqe-geometry-analysis.json')
const output = path.join(analysisRoot, 'cqe-relationships-analysis.json')

const TOL = {
  coord: 2,
  dimension: 2,
  geometry: 0.01,
  corner: 80,
}

const round = (v, digits = 3) => {
  if (!Number.isFinite(v)) return null
  const p = 10 ** digits
  return Math.round(v * p) / p
}
const finite = Number.isFinite
const clamp01 = v => Math.max(0, Math.min(1, v))
const near = (a, b, tolerance = TOL.dimension) => Math.abs(a - b) <= tolerance
const quantize = (v, tolerance) => Math.round(v / tolerance) * tolerance
const q = (v, tolerance = TOL.dimension) => round(quantize(v, tolerance), 3)

function validBBox(b) {
  if (!b) return false
  const values = [b.xmin, b.ymin, b.zmin, b.xmax, b.ymax, b.zmax, b.dx, b.dy, b.dz]
  return values.every(finite) && b.dx >= 0 && b.dy >= 0 && b.dz >= 0
}

function validCenter(c) {
  return c && finite(c.x) && finite(c.y) && finite(c.z)
}

function centerOf(o) {
  if (validCenter(o?.center)) return o.center
  if (validCenter(o?.shape?.centerOfMass)) return o.shape.centerOfMass
  return null
}

function bboxOf(o) {
  if (validBBox(o?.bbox)) return o.bbox
  if (validBBox(o?.shape?.bbox)) return o.shape.bbox
  return null
}

function normalizeObject(o, assembly) {
  const b = bboxOf(o)
  const c = centerOf(o)
  if (!b || !c) return null
  return {
    assembly: assembly.file,
    index: o.index ?? null,
    name: o.name ?? null,
    label: o.label ?? null,
    bbox: b,
    center: c,
    volume: finite(o.volume) ? o.volume : (finite(o.shape?.volume) ? o.shape.volume : null),
    area: finite(o.area) ? o.area : (finite(o.shape?.area) ? o.shape.area : null),
    solids: o.solids ?? o.shape?.solids ?? null,
    faces: o.faces ?? o.shape?.faces ?? null,
    edges: o.edges ?? o.shape?.edges ?? null,
  }
}

function geometryFingerprint(o) {
  const b = o.bbox
  return [
    q(b.dx, TOL.dimension),
    q(b.dy, TOL.dimension),
    q(b.dz, TOL.dimension),
    finite(o.volume) ? q(o.volume, Math.max(TOL.geometry, Math.abs(o.volume) * 1e-6)) : null,
    finite(o.area) ? q(o.area, Math.max(TOL.geometry, Math.abs(o.area) * 1e-6)) : null,
    o.solids ?? null,
    o.faces ?? null,
    o.edges ?? null,
  ].join('|')
}

function profileFingerprint(o) {
  const b = o.bbox
  const dims = [b.dx, b.dy].sort((a, b) => a - b)
  return [q(dims[0]), q(dims[1])].join('x')
}

function positionFingerprint(o) {
  return [q(o.center.x, TOL.coord), q(o.center.y, TOL.coord), q(o.center.z, TOL.coord)].join('|')
}

function xyFootprint(o) {
  return o.bbox.dx * o.bbox.dy
}

function relativeCorner(o, box) {
  const cx = box.xmin + box.dx / 2
  const cy = box.ymin + box.dy / 2
  return {
    x: o.center.x < cx ? 'left' : 'right',
    y: o.center.y < cy ? 'front' : 'back',
  }
}

function cornerDistance(o, box) {
  const corners = [
    { name: 'left-front', x: box.xmin, y: box.ymin },
    { name: 'left-back', x: box.xmin, y: box.ymax },
    { name: 'right-front', x: box.xmax, y: box.ymin },
    { name: 'right-back', x: box.xmax, y: box.ymax },
  ]
  return corners
    .map(c => ({ ...c, distance: Math.hypot(o.center.x - c.x, o.center.y - c.y) }))
    .sort((a, b) => a.distance - b.distance)[0]
}

function verticalScore(o, box) {
  const b = o.bbox
  const heightRatio = b.dz / Math.max(box.dz, 1)
  const slenderness = b.dz / Math.max(Math.max(b.dx, b.dy), 1)
  const footprintRatio = (b.dx * b.dy) / Math.max(box.dx * box.dy, 1)
  const zCoverage = b.dz / Math.max(box.dz, 1)
  return clamp01(
    0.45 * clamp01((heightRatio - 0.35) / 0.45) +
    0.30 * clamp01((slenderness - 3) / 8) +
    0.25 * clamp01((0.02 - footprintRatio) / 0.018),
  ) * clamp01((zCoverage - 0.25) / 0.55)
}

function postCandidates(items, box) {
  const candidates = items
    .map(o => {
      const corner = cornerDistance(o, box)
      const b = o.bbox
      const heightRatio = b.dz / Math.max(box.dz, 1)
      const profile = Math.max(b.dx, b.dy)
      const cornerFit = clamp01(1 - corner.distance / Math.max(TOL.corner, Math.min(box.dx, box.dy) * 0.18))
      const score = 0.55 * verticalScore(o, box) + 0.35 * cornerFit + 0.10 * clamp01(heightRatio)
      return {
        object: o,
        corner: corner.name,
        cornerDistance: round(corner.distance),
        profileMm: [round(b.dx), round(b.dy)],
        lengthMm: round(b.dz),
        score: round(score, 4),
        heightRatio: round(heightRatio, 4),
        profileFingerprint: profileFingerprint(o),
      }
    })
    .filter(x => x.score >= 0.35)
    .sort((a, b) => b.score - a.score)

  const byCorner = new Map()
  for (const candidate of candidates) {
    if (!byCorner.has(candidate.corner)) byCorner.set(candidate.corner, candidate)
  }

  return ['left-front', 'left-back', 'right-front', 'right-back']
    .map(corner => byCorner.get(corner) ?? null)
}

function plateCandidates(items, box, side) {
  const zEdge = side === 'base' ? box.zmin : box.zmax
  return items
    .map(o => {
      const b = o.bbox
      const edge = side === 'base' ? b.zmin : b.zmax
      const edgeDistance = Math.abs(edge - zEdge)
      const xCoverage = b.dx / Math.max(box.dx, 1)
      const yCoverage = b.dy / Math.max(box.dy, 1)
      const footprint = xyFootprint(o) / Math.max(box.dx * box.dy, 1)
      const horizontal = Math.max(b.dx, b.dy) / Math.max(b.dz, 1)
      const score =
        0.30 * clamp01(xCoverage / 0.8) +
        0.30 * clamp01(yCoverage / 0.8) +
        0.20 * clamp01(footprint / 0.65) +
        0.15 * clamp01((horizontal - 2) / 6) +
        0.05 * clamp01(1 - edgeDistance / 20)
      return {
        object: o,
        edgeDistance: round(edgeDistance),
        score: round(score, 4),
        footprintRatio: round(footprint, 4),
        xCoverage: round(xCoverage, 4),
        yCoverage: round(yCoverage, 4),
      }
    })
    .filter(x => x.edgeDistance <= 20 && x.score >= 0.45)
    .sort((a, b) => b.score - a.score)
}

function selectPlate(items, box, side) {
  return plateCandidates(items, box, side)[0] ?? null
}

function dimensions(a) {
  const p = a.parsedArticleSize
  if (p?.heightMm && p?.widthMm && p?.depthMm) return { heightMm: p.heightMm, widthMm: p.widthMm, depthMm: p.depthMm }
  const b = a.assemblyBBox
  return { heightMm: b?.dz ?? null, widthMm: b?.dx ?? null, depthMm: b?.dy ?? null }
}

function objectMapByAssembly(assemblies) {
  return new Map(assemblies.map(a => [a.file, a.objects]))
}

function matchStableComponents(assemblies) {
  const occurrences = new Map()
  for (const a of assemblies) {
    for (const o of a.objects) {
      const geometry = geometryFingerprint(o)
      const position = positionFingerprint(o)
      const key = `${geometry}@@${position}`
      if (!occurrences.has(key)) occurrences.set(key, [])
      occurrences.get(key).push({ assembly: a.file, object: o })
    }
  }

  return [...occurrences.entries()]
    .map(([key, items]) => ({
      key,
      assemblyCount: new Set(items.map(x => x.assembly)).size,
      occurrenceCount: items.length,
      geometryFingerprint: geometryFingerprint(items[0].object),
      positionFingerprint: positionFingerprint(items[0].object),
      examples: items.slice(0, 20).map(x => ({
        assembly: x.assembly,
        index: x.object.index,
        bbox: x.object.bbox,
        center: x.object.center,
      })),
    }))
    .filter(x => x.assemblyCount >= 2)
    .sort((a, b) => b.assemblyCount - a.assemblyCount || b.occurrenceCount - a.occurrenceCount)
}

function buildAssemblyRecord(a) {
  const box = a.assemblyBBox
  const dimsData = dimensions(a)
  const posts = postCandidates(a.objects, box)
  const base = selectPlate(a.objects, box, 'base')
  const roof = selectPlate(a.objects, box, 'roof')
  const validPosts = posts.filter(Boolean)

  const postCorners = Object.fromEntries(validPosts.map(p => [p.corner, {
    index: p.object.index,
    center: p.object.center,
    bbox: p.object.bbox,
    lengthMm: p.lengthMm,
    profileMm: p.profileMm,
    profileFingerprint: p.profileFingerprint,
    cornerDistanceMm: p.cornerDistance,
    score: p.score,
  }]))

  const corners = Object.values(postCorners)
  const xPositions = corners.map(p => p.center.x)
  const yPositions = corners.map(p => p.center.y)
  const uniqueX = [...new Set(xPositions.map(x => q(x, TOL.coord)))].sort((x, y) => x - y)
  const uniqueY = [...new Set(yPositions.map(y => q(y, TOL.coord)))].sort((x, y) => x - y)
  const spacingX = uniqueX.length >= 2 ? uniqueX[uniqueX.length - 1] - uniqueX[0] : null
  const spacingY = uniqueY.length >= 2 ? uniqueY[uniqueY.length - 1] - uniqueY[0] : null
  const postLengths = corners.map(p => p.lengthMm).filter(finite)

  return {
    file: a.file,
    dimensions: dimsData,
    bbox: box,
    objectCount: a.objects.length,
    posts: postCorners,
    postCount: corners.length,
    postProfileFingerprints: [...new Set(corners.map(p => p.profileFingerprint))],
    postLengthMm: postLengths.length ? {
      min: Math.min(...postLengths),
      max: Math.max(...postLengths),
      mean: round(postLengths.reduce((s, v) => s + v, 0) / postLengths.length),
    } : null,
    postCenters: corners.map(p => ({ x: p.center.x, y: p.center.y, z: p.center.z })),
    spacingXmm: finite(spacingX) ? round(spacingX) : null,
    spacingYmm: finite(spacingY) ? round(spacingY) : null,
    base: base ? {
      index: base.object.index,
      bbox: base.object.bbox,
      center: base.object.center,
      score: base.score,
      edgeDistanceMm: base.edgeDistance,
      footprintRatio: base.footprintRatio,
      xCoverage: base.xCoverage,
      yCoverage: base.yCoverage,
    } : null,
    roof: roof ? {
      index: roof.object.index,
      bbox: roof.object.bbox,
      center: roof.object.center,
      score: roof.score,
      edgeDistanceMm: roof.edgeDistance,
      footprintRatio: roof.footprintRatio,
      xCoverage: roof.xCoverage,
      yCoverage: roof.yCoverage,
    } : null,
  }
}

function pairwise(assemblyRecords) {
  const pairs = []
  for (let i = 0; i < assemblyRecords.length; i += 1) {
    for (let j = i + 1; j < assemblyRecords.length; j += 1) {
      const a = assemblyRecords[i]
      const b = assemblyRecords[j]
      const heightDelta = b.dimensions.heightMm - a.dimensions.heightMm
      const sameWD = near(a.dimensions.widthMm, b.dimensions.widthMm, TOL.dimension) && near(a.dimensions.depthMm, b.dimensions.depthMm, TOL.dimension)
      const postLengthA = a.postLengthMm?.mean ?? null
      const postLengthB = b.postLengthMm?.mean ?? null
      const spacingDeltaX = finite(a.spacingXmm) && finite(b.spacingXmm) ? round(b.spacingXmm - a.spacingXmm) : null
      const spacingDeltaY = finite(a.spacingYmm) && finite(b.spacingYmm) ? round(b.spacingYmm - a.spacingYmm) : null
      pairs.push({
        a: a.file,
        b: b.file,
        sameWD,
        widthMm: a.dimensions.widthMm,
        depthMm: a.dimensions.depthMm,
        heightAmm: a.dimensions.heightMm,
        heightBmm: b.dimensions.heightMm,
        heightDeltaMm: heightDelta,
        postLengthAmm: postLengthA,
        postLengthBmm: postLengthB,
        postLengthDeltaMm: finite(postLengthA) && finite(postLengthB) ? round(postLengthB - postLengthA) : null,
        spacingXAmm: a.spacingXmm,
        spacingXBmm: b.spacingXmm,
        spacingDeltaXmm: spacingDeltaX,
        spacingYAmm: a.spacingYmm,
        spacingYBmm: b.spacingYmm,
        spacingDeltaYmm: spacingDeltaY,
        postLengthMinusHeightAmm: finite(postLengthA) ? round(postLengthA - a.dimensions.heightMm) : null,
        postLengthMinusHeightBmm: finite(postLengthB) ? round(postLengthB - b.dimensions.heightMm) : null,
      })
    }
  }
  return pairs
}

function summarizeRelations(records) {
  const withPosts = records.filter(r => r.postCount >= 4)
  const postLengthVsHeight = withPosts.map(r => ({
    file: r.file,
    heightMm: r.dimensions.heightMm,
    postLengthMm: r.postLengthMm?.mean ?? null,
    differenceMm: finite(r.postLengthMm?.mean) ? round(r.postLengthMm.mean - r.dimensions.heightMm) : null,
  }))
  const spacingVsBody = withPosts.map(r => ({
    file: r.file,
    widthMm: r.dimensions.widthMm,
    depthMm: r.dimensions.depthMm,
    spacingXmm: r.spacingXmm,
    spacingYmm: r.spacingYmm,
    widthMinusSpacingXmm: finite(r.spacingXmm) ? round(r.dimensions.widthMm - r.spacingXmm) : null,
    depthMinusSpacingYmm: finite(r.spacingYmm) ? round(r.dimensions.depthMm - r.spacingYmm) : null,
  }))

  const plateRelations = records.map(r => ({
    file: r.file,
    widthMm: r.dimensions.widthMm,
    depthMm: r.dimensions.depthMm,
    baseSizeMm: r.base ? [round(r.base.bbox.dx), round(r.base.bbox.dy), round(r.base.bbox.dz)] : null,
    roofSizeMm: r.roof ? [round(r.roof.bbox.dx), round(r.roof.bbox.dy), round(r.roof.bbox.dz)] : null,
    baseMinusBodyMm: r.base ? {
      x: round(r.base.bbox.dx - r.dimensions.widthMm),
      y: round(r.base.bbox.dy - r.dimensions.depthMm),
    } : null,
    roofMinusBodyMm: r.roof ? {
      x: round(r.roof.bbox.dx - r.dimensions.widthMm),
      y: round(r.roof.bbox.dy - r.dimensions.depthMm),
    } : null,
  }))

  function stats(values) {
    const clean = values.filter(finite)
    if (!clean.length) return null
    return {
      count: clean.length,
      min: round(Math.min(...clean)),
      max: round(Math.max(...clean)),
      mean: round(clean.reduce((s, v) => s + v, 0) / clean.length),
    }
  }

  return {
    assembliesWithFourPosts: withPosts.length,
    postLengthMinusHeightMm: stats(postLengthVsHeight.map(x => x.differenceMm)),
    widthMinusSpacingXmm: stats(spacingVsBody.map(x => x.widthMinusSpacingXmm)),
    depthMinusSpacingYmm: stats(spacingVsBody.map(x => x.depthMinusSpacingYmm)),
    postLengthVsHeight,
    spacingVsBody,
    plateRelations,
  }
}

async function main() {
  const [assemblyData, geometryData] = await Promise.all([
    JSON.parse(await fs.readFile(assemblyInput, 'utf8')),
    JSON.parse(await fs.readFile(geometryInput, 'utf8')),
  ])

  const sourceAssemblies = Array.isArray(assemblyData.assemblies) ? assemblyData.assemblies : []
  const geometryAssemblies = new Map((geometryData.assemblies ?? []).map(a => [a.file, a]))
  const assemblies = sourceAssemblies
    .map(a => {
      const geometry = geometryAssemblies.get(a.file)
      const rawObjects = geometry?.classified
        ? a.objects
        : a.objects
      const objects = rawObjects.map(o => normalizeObject(o, a)).filter(Boolean)
      return { ...a, objects }
    })
    .filter(a => a.objects.length && validBBox(a.assemblyBBox))

  const records = assemblies.map(buildAssemblyRecord)
  const pairs = pairwise(records)
  const stableComponents = matchStableComponents(assemblies)
  const relationSummary = summarizeRelations(records)

  const result = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    units: 'mm',
    source: {
      assemblyAnalysis: assemblyInput,
      geometryAnalysis: geometryInput,
      assemblyCount: sourceAssemblies.length,
      validAssemblyCount: assemblies.length,
    },
    tolerancesMm: TOL,
    method: {
      stableComponent: 'same geometry fingerprint (bbox + volume + area + topology counts) and same center position across assemblies',
      post: 'vertical/slender solid near one of four XY corners; four best corner candidates are retained',
      roofBase: 'horizontal large-footprint solid touching assembly top/bottom Z edge',
      positioning: 'post center coordinates define X1/X2/Y1/Y2; no use of nominal 2000 mm spacing',
    },
    stableComponents,
    assemblies: records,
    pairwise: pairs,
    relations: relationSummary,
  }

  await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', 'utf8')

  console.log(`[CQE relationships] source assemblies=${sourceAssemblies.length}`)
  console.log(`[CQE relationships] valid assemblies=${assemblies.length}`)
  console.log(`[CQE relationships] assemblies with 4 posts=${relationSummary.assembliesWithFourPosts}`)
  console.log(`[CQE relationships] stable component groups=${stableComponents.length}`)
  console.log(`[CQE relationships] pairwise comparisons=${pairs.length}`)
  console.log(`[CQE relationships] post length-height delta=${JSON.stringify(relationSummary.postLengthMinusHeightMm)}`)
  console.log(`[CQE relationships] width-spacingX delta=${JSON.stringify(relationSummary.widthMinusSpacingXmm)}`)
  console.log(`[CQE relationships] depth-spacingY delta=${JSON.stringify(relationSummary.depthMinusSpacingYmm)}`)
  console.log(`[CQE relationships] wrote ${output} (${(await fs.stat(output)).size} bytes)`)
}

main().catch(error => {
  console.error('[CQE relationships] FAILED:', error)
  process.exitCode = 1
})
