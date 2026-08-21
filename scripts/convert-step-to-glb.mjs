import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importSTEP, setOC } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const inputRoot = path.join(root, 'public', 'cad', 'Osnovnyye_elementy_korpusa_CQE_N')
const outputRoot = path.join(root, 'public', 'models', 'dkc')

const wasmPath = path.join(root, 'node_modules', 'replicad-opencascadejs', 'src', 'replicad_single.wasm')

async function main() {
  console.log('[STEP→GLB] Initializing OpenCascade...')
  const wasm = await fs.readFile(wasmPath)
  const oc = await initOpenCascade({
    locateFile: () => wasmPath,
    wasmBinary: wasm,
  })
  setOC(oc)
  console.log('[STEP→GLB] OpenCascade ready')

  await fs.mkdir(outputRoot, { recursive: true })
  const files = (await fs.readdir(inputRoot, { recursive: true }))
    .filter((file) => typeof file === 'string' && file.toLowerCase().endsWith('.step'))

  if (!files.length) {
    throw new Error(`No STEP files found under ${inputRoot}`)
  }

  for (const relative of files) {
    const input = path.join(inputRoot, relative)
    const base = path.basename(relative, path.extname(relative))
    const output = path.join(outputRoot, `${base}.json`)

    console.log(`[STEP→mesh] ${relative}`)
    const blob = new Blob([await fs.readFile(input)])
    const shape = await importSTEP(blob)
    const data = shape.mesh({ tolerance: 0.05, angularTolerance: 30 })

    const payload = {
      vertices: Array.from(data.vertices),
      normals: Array.from(data.normals),
      triangles: Array.from(data.triangles),
    }

    await fs.writeFile(output, JSON.stringify(payload))
    console.log(`[STEP→mesh] wrote ${path.relative(root, output)}`)
  }

  console.log(`[STEP→mesh] Converted ${files.length} STEP files.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
