import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const analysisRoot = path.join(root, 'public', 'library', 'dkc', 'Osnovnyye_elementy_korpusa_CQE_N', 'Собранные корпуса CQE N со сплошной дверью')
const input = path.join(analysisRoot, 'cqe-assembly-analysis.json')
const output = path.join(analysisRoot, 'cqe-post-faces-analysis.json')

const POST_NOMINAL = 50
const POST_INNER = 49.7
const TOL = 3
const finite = Number.isFinite
const round = (v, d = 3) => finite(v) ? Math.round(v * 10 ** d) / 10 ** d : null
const usable = v => finite(v) && Math.abs(v) < 1e6

function validBBox(b) {
  return !!b && [b.xmin,b.ymin,b.zmin,b.xmax,b.ymax,b.zmax,b.dx,b.dy,b.dz].every(usable) && b.dx >= 0 && b.dy >= 0 && b.dz >= 0
}
function normalize(o) {
  const b=o?.shape?.bbox ?? o?.bbox ?? null
  const c=o?.shape?.centerOfMass ?? o?.center ?? null
  return validBBox(b) && c && [c.x,c.y,c.z].every(usable) ? { index:o.index ?? null,bbox:b,center:c } : null
}
function dims(a) {
  const p=a.parsedArticleSize
  if (p?.heightMm && p?.widthMm && p?.depthMm) return { H:p.heightMm,W:p.widthMm,D:p.depthMm }
  const b=a.assemblyBBox
  return { H:b?.dz ?? null,W:b?.dx ?? null,D:b?.dy ?? null }
}
function validAssembly(a) {
  const d=dims(a)
  return validBBox(a.assemblyBBox) && Array.isArray(a.objects) && a.objects.length > 0 && [d.H,d.W,d.D].every(usable) && d.H>0 && d.W>0 && d.D>0
}
function candidates(objects, box) {
  return objects.filter(o => {
    const b=o.bbox
    const profile=Math.max(b.dx,b.dy)
    return b.dz > box.dz*0.35 && b.dz < box.dz*1.1 && b.dz > profile*3 && Math.max(b.dx,b.dy) <= 80
  })
}
function choosePosts(objects, box) {
  const cs=candidates(objects,box)
  const corners=[['left-front',box.xmin,box.ymin],['left-back',box.xmin,box.ymax],['right-front',box.xmax,box.ymin],['right-back',box.xmax,box.ymax]]
  const out={}
  for(const [name,x,y] of corners){
    const best=cs.filter(o=>!Object.values(out).some(p=>p.index===o.index)).sort((a,b)=>Math.hypot(a.center.x-x,a.center.y-y)-Math.hypot(b.center.x-x,b.center.y-y))[0]
    if(best) out[name]=best
  }
  return Object.keys(out).length===4?out:null
}
function axisValues(posts, axis) {
  return Object.values(posts).map(o=>o.bbox[axis==='x'?'xmax':'ymax']).sort((a,b)=>a-b)
}
function innerFaceCandidates(posts) {
  const arr=Object.entries(posts)
  const left=arr.filter(([n])=>n.startsWith('left')).map(([,o])=>o)
  const right=arr.filter(([n])=>n.startsWith('right')).map(([,o])=>o)
  const front=arr.filter(([n])=>n.endsWith('front')).map(([,o])=>o)
  const back=arr.filter(([n])=>n.endsWith('back')).map(([,o])=>o)
  if(left.length!==2||right.length!==2||front.length!==2||back.length!==2) return null
  const leftInner=Math.max(...left.map(o=>o.bbox.xmax))
  const rightInner=Math.min(...right.map(o=>o.bbox.xmin))
  const frontInner=Math.max(...front.map(o=>o.bbox.ymax))
  const backInner=Math.min(...back.map(o=>o.bbox.ymin))
  return { leftInner,rightInner,frontInner,backInner,spacingX:rightInner-leftInner,spacingY:backInner-frontInner }
}
function stats(values){
  const v=values.filter(usable)
  if(!v.length)return {count:0}
  return {count:v.length,min:round(Math.min(...v)),max:round(Math.max(...v)),mean:round(v.reduce((s,x)=>s+x,0)/v.length),within3mm:v.filter(x=>Math.abs(x)<=TOL).length}
}
async function main(){
  const data=JSON.parse(await fs.readFile(input,'utf8'))
  const source=Array.isArray(data.assemblies)?data.assemblies:[]
  const valid=source.filter(validAssembly)
  const assemblies=[]
  for(const a of valid){
    const d=dims(a), box=a.assemblyBBox, objects=a.objects.map(normalize).filter(Boolean), posts=choosePosts(objects,box)
    const faces=posts?innerFaceCandidates(posts):null
    const expectedX=usable(d.W)?d.W-2*POST_NOMINAL:null
    const expectedY=usable(d.D)?d.D-2*POST_NOMINAL:null
    assemblies.push({
      file:a.file,dimensions:d,postCount:posts?4:0,
      posts:posts?Object.fromEntries(Object.entries(posts).map(([k,o])=>[k,{index:o.index,center:o.center,bbox:o.bbox,profileMm:[round(o.bbox.dx),round(o.bbox.dy)],lengthMm:round(o.bbox.dz)}])):{},
      innerFaces:faces?{leftInner:round(faces.leftInner),rightInner:round(faces.rightInner),frontInner:round(faces.frontInner),backInner:round(faces.backInner)}:null,
      spacingXmm:faces?round(faces.spacingX):null,expectedSpacingXmm:round(expectedX),spacingXDeltaMm:faces&&usable(expectedX)?round(faces.spacingX-expectedX):null,
      spacingYmm:faces?round(faces.spacingY):null,expectedSpacingYmm:round(expectedY),spacingYDeltaMm:faces&&usable(expectedY)?round(faces.spacingY-expectedY):null,
    })
  }
  const result={schemaVersion:1,generatedAtUtc:new Date().toISOString(),construction:{postNominalMm:POST_NOMINAL,postInnerMm:POST_INNER,spacingX:'W - 100',spacingY:'D - 100',faceMeaning:'inner faces of the four corner posts'},source:{input,sourceAssemblyCount:source.length,validAssemblyCount:valid.length},summary:{assembliesWith4Posts:assemblies.filter(a=>a.postCount===4).length,assembliesWithInnerFaces:assemblies.filter(a=>a.innerFaces).length,spacingXDelta:stats(assemblies.map(a=>a.spacingXDeltaMm)),spacingYDelta:stats(assemblies.map(a=>a.spacingYDeltaMm))},assemblies}
  await fs.writeFile(output,JSON.stringify(result,null,2)+'\n','utf8')
  console.log(`[CQE post-faces] source assemblies=${source.length}`)
  console.log(`[CQE post-faces] valid assemblies=${valid.length}`)
  console.log(`[CQE post-faces] assemblies with 4 posts=${assemblies.filter(a=>a.postCount===4).length}`)
  console.log(`[CQE post-faces] assemblies with inner faces=${assemblies.filter(a=>a.innerFaces).length}`)
  console.log(`[CQE post-faces] spacingX delta=${JSON.stringify(result.summary.spacingXDelta)}`)
  console.log(`[CQE post-faces] spacingY delta=${JSON.stringify(result.summary.spacingYDelta)}`)
  console.log(`[CQE post-faces] wrote ${output} (${(await fs.stat(output)).size} bytes)`)
}
main().catch(e=>{console.error('[CQE post-faces] FAILED:',e);process.exitCode=1})
