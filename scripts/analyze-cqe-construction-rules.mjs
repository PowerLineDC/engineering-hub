import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const analysisRoot = path.join(root, 'public', 'library', 'dkc', 'Osnovnyye_elementy_korpusa_CQE_N', 'Собранные корпуса CQE N со сплошной дверью')
const input = path.join(analysisRoot, 'cqe-assembly-analysis.json')
const output = path.join(analysisRoot, 'cqe-construction-rules-analysis.json')

const POST = 50
const BASE = 53.5
const ROOF = 53.5
const FIXED_Z = BASE + ROOF
const TOL = 5
const finite = Number.isFinite
const round = (v, d = 3) => finite(v) ? Math.round(v * 10 ** d) / 10 ** d : null

function validBBox(b) {
  if (!b) return false
  return [b.xmin,b.ymin,b.zmin,b.xmax,b.ymax,b.zmax,b.dx,b.dy,b.dz].every(finite) && b.dx >= 0 && b.dy >= 0 && b.dz >= 0
}
function center(o) { return o?.shape?.centerOfMass ?? o?.center ?? null }
function bbox(o) { return o?.shape?.bbox ?? o?.bbox ?? null }
function normalize(o) {
  const b=bbox(o), c=center(o)
  return validBBox(b) && c && finite(c.x) && finite(c.y) && finite(c.z) ? { index:o.index ?? null, bbox:b, center:c } : null
}
function dims(a) {
  const p=a.parsedArticleSize
  if (p?.heightMm && p?.widthMm && p?.depthMm) return { H:p.heightMm, W:p.widthMm, D:p.depthMm, source:'article' }
  const b=a.assemblyBBox
  return { H:b?.dz ?? null, W:b?.dx ?? null, D:b?.dy ?? null, source:'assembly-bbox' }
}
function isFiniteNumber(v) { return finite(v) && Math.abs(v) < 1e6 }
function isUsableAssembly(a) {
  if (!validBBox(a.assemblyBBox) || !Array.isArray(a.objects) || !a.objects.length) return false
  const d=dims(a)
  return [d.H,d.W,d.D].every(isFiniteNumber) && d.H > 0 && d.W > 0 && d.D > 0
}
function postCandidates(objects, box) {
  const corners=[
    ['left-front',box.xmin,box.ymin],['left-back',box.xmin,box.ymax],
    ['right-front',box.xmax,box.ymin],['right-back',box.xmax,box.ymax],
  ]
  const candidates=objects.filter(o=>{
    const b=o.bbox
    return b.dz > box.dz*0.35 && b.dz > Math.max(b.dx,b.dy)*3 && b.dz < box.dz*1.1
  })
  const result={}
  for(const [name,x,y] of corners){
    const best=candidates
      .filter(o=>!Object.values(result).some(r=>r.index===o.index))
      .sort((a,b)=>Math.hypot(a.center.x-x,a.center.y-y)-Math.hypot(b.center.x-x,b.center.y-y))[0]
    if(best) result[name]=best
  }
  return Object.keys(result).length===4 ? result : null
}
function stats(values) {
  const v=values.filter(isFiniteNumber)
  if(!v.length) return {count:0}
  return {count:v.length,min:round(Math.min(...v)),max:round(Math.max(...v)),mean:round(v.reduce((s,x)=>s+x,0)/v.length),within5mm:v.filter(x=>Math.abs(x)<=TOL).length}
}
async function main() {
  const data=JSON.parse(await fs.readFile(input,'utf8'))
  const source=Array.isArray(data.assemblies)?data.assemblies:[]
  const valid=source.filter(isUsableAssembly)
  const assemblies=[]
  for(const a of valid){
    const d=dims(a), box=a.assemblyBBox, objects=a.objects.map(normalize).filter(Boolean), posts=postCandidates(objects,box)
    const postList=posts?Object.values(posts):[]
    const xs=postList.map(o=>o.center.x), ys=postList.map(o=>o.center.y)
    const uniqueX=[...new Set(xs.map(round))].sort((a,b)=>a-b), uniqueY=[...new Set(ys.map(round))].sort((a,b)=>a-b)
    const spacingX=uniqueX.length===2?uniqueX[1]-uniqueX[0]:null
    const spacingY=uniqueY.length===2?uniqueY[1]-uniqueY[0]:null
    const postLength=postList.length===4?postList.reduce((s,o)=>s+o.bbox.dz,0)/4:null
    const expectedPost=isFiniteNumber(d.H)?d.H-FIXED_Z:null
    const expectedX=isFiniteNumber(d.W)?d.W-2*POST:null
    const expectedY=isFiniteNumber(d.D)?d.D-2*POST:null
    const postDelta=finite(postLength)&&finite(expectedPost)?postLength-expectedPost:null
    const xDelta=finite(spacingX)&&finite(expectedX)?spacingX-expectedX:null
    const yDelta=finite(spacingY)&&finite(expectedY)?spacingY-expectedY:null
    assemblies.push({
      file:a.file,dimensions:d,postCount:postList.length,
      posts:Object.fromEntries(posts?Object.entries(posts).map(([k,o])=>[k,{index:o.index,center:o.center,bbox:o.bbox,lengthMm:round(o.bbox.dz),profileMm:[round(o.bbox.dx),round(o.bbox.dy)]}]):[]),
      postLengthMm:round(postLength),expectedPostLengthMm:round(expectedPost),postLengthDeltaMm:round(postDelta),
      spacingXmm:round(spacingX),expectedSpacingXmm:round(expectedX),spacingXDeltaMm:round(xDelta),
      spacingYmm:round(spacingY),expectedSpacingYmm:round(expectedY),spacingYDeltaMm:round(yDelta),
      positioningRule:{X1:uniqueX[0]??null,X2:uniqueX[1]??null,Y1:uniqueY[0]??null,Y2:uniqueY[1]??null},
    })
  }
  const result={
    schemaVersion:2,generatedAtUtc:new Date().toISOString(),
    rules:{postNominalMm:POST,baseHeightMm:BASE,roofHeightMm:ROOF,fixedVerticalMm:FIXED_Z,postLength:'H - 107',spacingX:'W - 100',spacingY:'D - 100',baseAndRoofFixed:true},
    source:{input,sourceAssemblyCount:source.length,validAssemblyCount:valid.length},
    summary:{assembliesWith4Posts:assemblies.filter(a=>a.postCount===4).length,postLengthDelta:stats(assemblies.map(a=>a.postLengthDeltaMm)),spacingXDelta:stats(assemblies.map(a=>a.spacingXDeltaMm)),spacingYDelta:stats(assemblies.map(a=>a.spacingYDeltaMm))},
    assemblies,
  }
  await fs.writeFile(output,JSON.stringify(result,null,2)+'\n','utf8')
  console.log(`[CQE construction] source assemblies=${source.length}`)
  console.log(`[CQE construction] valid assemblies=${valid.length}`)
  console.log(`[CQE construction] assemblies with 4 posts=${assemblies.filter(a=>a.postCount===4).length}`)
  console.log(`[CQE construction] rule postLength=H-107`)
  console.log(`[CQE construction] rule spacingX=W-100`)
  console.log(`[CQE construction] rule spacingY=D-100`)
  console.log(`[CQE construction] post delta=${JSON.stringify(result.summary.postLengthDelta)}`)
  console.log(`[CQE construction] spacingX delta=${JSON.stringify(result.summary.spacingXDelta)}`)
  console.log(`[CQE construction] spacingY delta=${JSON.stringify(result.summary.spacingYDelta)}`)
  console.log(`[CQE construction] wrote ${output} (${(await fs.stat(output)).size} bytes)`)
}
main().catch(error=>{console.error('[CQE construction] FAILED:',error);process.exitCode=1})
