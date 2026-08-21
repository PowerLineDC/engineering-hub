import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { draco } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { importSTEP, setOC } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const inputRoot = path.join(root, 'public', 'cad', 'Osnovnyye_elementy_korpusa_CQE_N')
const outputRoot = path.join(root, 'public', 'models', 'dkc')
const wasmPath = path.join(root, 'node_modules', 'replicad-opencascadejs', 'src', 'replicad_single.wasm')

function toFloat32(value) {
  return value instanceof Float32Array ? value : new Float32Array(value)
}

function toUint32(value) {
  return value instanceof Uint32Array ? value : new Uint32Array(value)
}

async function createGlb(vertices, normals, triangles, output) {
  const document = new Document()
  const rootNode = document.createNode('DKC component')
  const scene = document.createScene('Scene').addChild(rootNode)
  const mesh = document.createMesh('DKC mesh')
  const primitive = document.createPrimitive()

  const position = document.createAccessor('POSITION')
    .setType('VEC3')
    .setArray(toFloat32(vertices))
  const normal = document.createAccessor('NORMAL')
    .setType('VEC3')
    .setArray(toFloat32(normals))
  const indices = document.createAccessor('indices')
    .setType('SCALAR')
    .setArray(toUint32(triangles))

  primitive.setAttribute('POSITION', position)
  primitive.setAttribute('NORMAL', normal)
  primitive.setIndices(indices)
  primitive.setMaterial(document.createMaterial('DKC default material').setBaseColorFactor([0.47, 0.47, 0.47, 1]))
  mesh.addPrimitive(primitive)
  rootNode.setMesh(mesh)

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    })

  await document.transform(
    draco({
      encodeSpeed: 5,
      decodeSpeed: 5,
    }),
  )

  await fs.writeFile(output, await io.writeBinary(document))
}

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

  if (!files.length) throw new Error(`No STEP files found under ${inputRoot}`)

  let converted = 0
  for (const relative of files) {
    const input = path.join(inputRoot, relative)
    const base = path.basename(relative, path.extname(relative))
    const output = path.join(outputRoot, `${base}.glb`)

    try {
      const stat = await fs.stat(output)
      const sourceStat = await fs.stat(input)
      if (stat.mtimeMs >= sourceStat.mtimeMs && stat.size > 0) {
        console.log(`[STEP→GLB] skip ${relative} (already converted)`)
        continue
      }
    } catch {
      // Output does not exist yet.
    }

    console.log(`[STEP→mesh] ${relative}`)
    const blob = new Blob([await fs.readFile(input)])
    const shape = await importSTEP(blob)
    const data = shape.mesh({ tolerance: 0.05, angularTolerance: 30 })

    console.log(`[GLB/Draco] ${relative}`)
    await createGlb(data.vertices, data.normals, data.triangles, output)
    console.log(`[GLB/Draco] wrote ${path.relative(root, output)}`)
    converted += 1
  }

  console.log(`[STEP→GLB] Converted ${converted} model(s).`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
