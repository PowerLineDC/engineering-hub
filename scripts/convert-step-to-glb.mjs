import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { draco } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { importSTEP, setOC } from 'replicad'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
// Source of truth: the DKC library. Generated GLB files live beside their STEP source.
const inputRoot = path.join(root, 'public', 'library', 'dkc')
const dracoSource = path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco')
const dracoPublicRoot = path.join(root, 'public', 'draco')
const wasmPath = path.join(root, 'node_modules', 'replicad-opencascadejs', 'src', 'replicad_single.wasm')

async function createGlb(vertices, normals, triangles, output) {
  const document = new Document()
  const buffer = document.createBuffer('DKC geometry buffer')
  const rootNode = document.createNode('DKC component')
  document.createScene('Scene').addChild(rootNode)
  const mesh = document.createMesh('DKC mesh')
  const primitive = document.createPrimitive()
  primitive.setAttribute('POSITION', document.createAccessor('POSITION').setType('VEC3').setBuffer(buffer).setArray(new Float32Array(vertices)))
  primitive.setAttribute('NORMAL', document.createAccessor('NORMAL').setType('VEC3').setBuffer(buffer).setArray(new Float32Array(normals)))
  primitive.setIndices(document.createAccessor('indices').setType('SCALAR').setBuffer(buffer).setArray(new Uint32Array(triangles)))
  primitive.setMaterial(document.createMaterial('DKC default material').setBaseColorFactor([0.47, 0.47, 0.47, 1]))
  mesh.addPrimitive(primitive)
  rootNode.setMesh(mesh)

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  })
  await document.transform(draco({ encodeSpeed: 5, decodeSpeed: 5 }))
  await fs.writeFile(output, await io.writeBinary(document))
}

async function copyDracoDecoder() {
  await fs.mkdir(dracoPublicRoot, { recursive: true })
  for (const filename of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
    await fs.copyFile(path.join(dracoSource, filename), path.join(dracoPublicRoot, filename))
  }
}

async function main() {
  console.log('[STEP→GLB] Initializing OpenCascade...')
  globalThis.__dirname = path.dirname(wasmPath)
  const { default: initOpenCascade } = await import('replicad-opencascadejs')
  const wasm = await fs.readFile(wasmPath)
  const oc = await initOpenCascade({ locateFile: () => wasmPath, wasmBinary: wasm })
  setOC(oc)
  await copyDracoDecoder()

  const entries = await fs.readdir(inputRoot, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && /\.(step|stp)$/i.test(entry.name))
    .map((entry) => path.relative(inputRoot, path.join(entry.parentPath ?? entry.path, entry.name)))
    .sort((a, b) => a.localeCompare(b, 'en'))
  if (!files.length) throw new Error(`No STEP/STP files found under ${inputRoot}`)

  console.log(`[STEP→GLB] Found ${files.length} STEP/STP model(s) under ${inputRoot}`)
  let converted = 0
  let skipped = 0
  let failed = 0

  for (const relative of files) {
    const input = path.join(inputRoot, relative)
    const output = input.replace(/\.(step|stp)$/i, '.glb')
    try {
      const sourceStat = await fs.stat(input)
      try {
        const outputStat = await fs.stat(output)
        if (outputStat.mtimeMs >= sourceStat.mtimeMs && outputStat.size > 0) {
          console.log(`[STEP→GLB] skip ${relative} (already converted)`)
          skipped += 1
          continue
        }
      } catch {
        // GLB does not exist yet.
      }

      await fs.mkdir(path.dirname(output), { recursive: true })
      console.log(`[STEP→mesh] ${relative}`)
      const blob = new Blob([await fs.readFile(input)])
      const shape = await importSTEP(blob)
      const data = shape.mesh({ tolerance: 0.05, angularTolerance: 30 })
      console.log(`[GLB/Draco] ${relative}`)
      await createGlb(data.vertices, data.normals, data.triangles, output)
      console.log(`[GLB/Draco] wrote ${path.relative(root, output)}`)
      converted += 1
    } catch (error) {
      failed += 1
      console.error(`[STEP→GLB] FAILED ${relative}`)
      console.error(error)
    }
  }

  console.log(`[STEP→GLB] Finished. Converted ${converted}, skipped ${skipped}, failed ${failed}, total ${files.length}.`)
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
