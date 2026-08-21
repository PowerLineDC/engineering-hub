import { importSTEP, setOC } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url'

type RequestMessage = { id: number; url: string }
type ResponseMessage =
  | { id: number; ok: true; vertices: Float32Array; normals: Float32Array; triangles: Uint32Array }
  | { id: number; ok: false; error: string }

let openCascadeReady: Promise<void> | null = null

async function initializeOpenCascade() {
  if (!openCascadeReady) {
    const init = initOpenCascade as unknown as (options: { locateFile: () => string }) => Promise<any>
    openCascadeReady = init({ locateFile: () => opencascadeWasm }).then((oc) => {
      setOC(oc)
      console.log('[STEP worker] OpenCascade initialized')
    })
  }
  return openCascadeReady
}

function meshCacheUrl(stepUrl: string) {
  const pathname = new URL(stepUrl, self.location.origin).pathname
  const filename = decodeURIComponent(pathname.split('/').pop() ?? '')
  const base = filename.replace(/\.step$/i, '')
  return `/models/dkc/${encodeURIComponent(base)}.json`
}

async function loadPreconvertedMesh(stepUrl: string) {
  const cacheUrl = meshCacheUrl(stepUrl)
  const response = await fetch(cacheUrl, { cache: 'force-cache' })
  if (!response.ok) return null
  const payload = await response.json() as { vertices: number[]; normals: number[]; triangles: number[] }
  if (!Array.isArray(payload.vertices) || !Array.isArray(payload.normals) || !Array.isArray(payload.triangles)) {
    throw new Error(`Invalid mesh cache: ${cacheUrl}`)
  }
  return {
    vertices: new Float32Array(payload.vertices),
    normals: new Float32Array(payload.normals),
    triangles: new Uint32Array(payload.triangles),
    cacheUrl,
  }
}

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const { id, url } = event.data
  try {
    const cached = await loadPreconvertedMesh(url)
    if (cached) {
      console.log('[STEP worker] mesh cache hit', cached.cacheUrl)
      self.postMessage({ id, ok: true, vertices: cached.vertices, normals: cached.normals, triangles: cached.triangles } satisfies ResponseMessage, [cached.vertices.buffer, cached.normals.buffer, cached.triangles.buffer])
      return
    }

    console.log('[STEP worker] mesh cache miss, parsing STEP', url)
    await initializeOpenCascade()
    const response = await fetch(url)
    if (!response.ok) throw new Error(`STEP request failed: ${response.status} ${response.statusText}`)
    const blob = await response.blob()
    const shape = await importSTEP(blob)
    const data = shape.mesh({ tolerance: 0.05, angularTolerance: 30 })
    const vertices = new Float32Array(data.vertices)
    const normals = new Float32Array(data.normals)
    const triangles = new Uint32Array(data.triangles)
    self.postMessage({ id, ok: true, vertices, normals, triangles } satisfies ResponseMessage, [vertices.buffer, normals.buffer, triangles.buffer])
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ResponseMessage)
  }
}
