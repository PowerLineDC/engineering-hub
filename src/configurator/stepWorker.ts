import { importSTEP, setOC } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url'

type RequestMessage = {
  id: number
  url: string
}

type ResponseMessage =
  | {
      id: number
      ok: true
      vertices: Float32Array
      normals: Float32Array
      triangles: Uint32Array | Uint16Array
    }
  | {
      id: number
      ok: false
      error: string
    }

let openCascadeReady: Promise<void> | null = null

async function initializeOpenCascade() {
  if (!openCascadeReady) {
    const init = initOpenCascade as unknown as (options: {
      locateFile: () => string
    }) => Promise<any>

    openCascadeReady = init({
      locateFile: () => opencascadeWasm,
    }).then((oc) => {
      setOC(oc)
      console.log('[STEP worker] OpenCascade initialized')
    })
  }
  return openCascadeReady
}

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const { id, url } = event.data

  try {
    await initializeOpenCascade()

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`STEP request failed: ${response.status} ${response.statusText}`)
    }

    const blob = await response.blob()
    const shape = await importSTEP(blob)
    const data = shape.mesh({ tolerance: 0.05, angularTolerance: 30 })

    const vertices = new Float32Array(data.vertices)
    const normals = new Float32Array(data.normals)
    const triangles = data.triangles instanceof Uint32Array
      ? data.triangles
      : new Uint32Array(data.triangles)

    const message: ResponseMessage = {
      id,
      ok: true,
      vertices,
      normals,
      triangles,
    }

    self.postMessage(message, [vertices.buffer, normals.buffer, triangles.buffer])
  } catch (error) {
    const message: ResponseMessage = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(message)
  }
}
