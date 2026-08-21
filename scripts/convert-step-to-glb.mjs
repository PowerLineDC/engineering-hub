import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { draco } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const inputRoot = path.join(root, 'public', 'library', 'dkc')
const dracoSource = path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco')
const dracoPublicRoot = path.join(root, 'public', 'draco')
const freecadScript = path.join(root, 'scripts', 'freecad-step-to-glb.py')

function findFreeCad() {
  if (process.env.FREECAD_CMD) return process.env.FREECAD_CMD

  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 0.21\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 0.20\\bin\\FreeCADCmd.exe',
      ]
    : ['/usr/bin/FreeCADCmd', '/usr/local/bin/FreeCADCmd', '/usr/bin/freecadcmd']

  for (const candidate of candidates) {
    try { return requirePath(candidate) } catch {}
  }

  const command = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(command, ['FreeCADCmd'], { encoding: 'utf8', windowsHide: true })
  if (result.status === 0) {
    const found = result.stdout.trim().split(/\r?\n/).find(Boolean)
    if (found) return found
  }
  return null
}

function requirePath(candidate) {
  const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'test', process.platform === 'win32'
    ? ['/c', 'if', 'exist', candidate, 'exit', '0', 'else', 'exit', '1']
    : ['-x', candidate], { windowsHide: true })
  if (result.status !== 0) throw new Error('not found')
  return candidate
}

async function copyDracoDecoder() {
  await fs.mkdir(dracoPublicRoot, { recursive: true })
  for (const filename of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
    await fs.copyFile(path.join(dracoSource, filename), path.join(dracoPublicRoot, filename))
  }
}

let ioPromise
async function compressDraco(input, output) {
  ioPromise ??= (async () => new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    }))()
  const io = await ioPromise
  const document = await io.read(input)
  await document.transform(draco({ encodeSpeed: 5, decodeSpeed: 5 }))
  await fs.writeFile(output, await io.writeBinary(document))
}

function runFreeCad(freecad, input, output) {
  const scriptPath = freecadScript.replace(/\\/g, '/').replace(/'/g, "\\'")
  const command = `exec(open('${scriptPath}', encoding='utf-8').read())`
  const env = {
    ...process.env,
    ENGINEERINGHUB_STEP_INPUT: input,
    ENGINEERINGHUB_MESH_OUTPUT: output,
  }

  const result = spawnSync(freecad, ['-c', command], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    throw new Error(`FreeCAD exited with code ${result.status ?? 'unknown'}`)
  }
}

async function main() {
  console.log('[STEP→GLB] Using native FreeCAD for STEP import/tessellation.')
  const freecad = findFreeCad()
  if (!freecad) {
    throw new Error('FreeCADCmd was not found. Install FreeCAD and rerun, or set FREECAD_CMD to the full path of FreeCADCmd.exe.')
  }
  console.log(`[STEP→GLB] FreeCADCmd: ${freecad}`)
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
    const rawOutput = input.replace(/\.(step|stp)$/i, '.freecad.raw.glb')

    try {
      const sourceStat = await fs.stat(input)
      try {
        const outputStat = await fs.stat(output)
        if (outputStat.mtimeMs >= sourceStat.mtimeMs && outputStat.size > 0) {
          console.log(`[STEP→GLB] skip ${relative} (already converted)`)
          skipped += 1
          continue
        }
      } catch {}

      await fs.mkdir(path.dirname(output), { recursive: true })
      console.log(`[STEP→FreeCAD] ${relative}`)
      await fs.rm(rawOutput, { force: true })
      runFreeCad(freecad, input, rawOutput)

      console.log(`[FreeCAD GLB→Draco] ${relative}`)
      await compressDraco(rawOutput, output)
      await fs.rm(rawOutput, { force: true })
      console.log(`[GLB/Draco] wrote ${path.relative(root, output)}`)
      converted += 1
    } catch (error) {
      failed += 1
      await fs.rm(rawOutput, { force: true }).catch(() => {})
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
