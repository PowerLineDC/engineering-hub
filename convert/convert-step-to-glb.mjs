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
const inputRoot = path.join(root, 'native', 'occt-reader', 'dkc', 'Osnovnyye_elementy_korpusa_CQE_N', 'R5NKMN')
const freecadScript = path.join(__dirname, 'freecad-step-to-glb-json.py')
const dracoSource = path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco')
const dracoPublicRoot = path.join(root, 'public', 'draco')

function findFreeCad() {
  if (process.env.FREECAD_CMD) return process.env.FREECAD_CMD

  const candidates = process.platform === 'win32'
    ? [
        'D:\\программы\\FreeCAD\\FreeCAD_1.1.3-Windows-x86_64-py311\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCADCmd.exe',
      ]
    : ['/usr/bin/FreeCADCmd', '/usr/local/bin/FreeCADCmd', '/usr/bin/freecadcmd']

  for (const candidate of candidates) {
    const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'test', process.platform === 'win32'
      ? ['/c', 'if', 'exist', candidate, 'exit', '0', 'else', 'exit', '1']
      : ['-x', candidate], { windowsHide: true })
    if (result.status === 0) return candidate
  }

  const command = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(command, ['FreeCADCmd'], { encoding: 'utf8', windowsHide: true })
  if (result.status === 0) {
    const found = result.stdout.trim().split(/\r?\n/).find(Boolean)
    if (found) return found
  }
  return null
}

function runFreeCad(freecad, input, rawOutput, jsonOutput) {
  const scriptPath = freecadScript.replace(/\\/g, '/').replace(/'/g, "\\'")
  const command = `exec(open('${scriptPath}', encoding='utf-8').read())`
  const env = {
    ...process.env,
    ENGINEERINGHUB_STEP_INPUT: input,
    ENGINEERINGHUB_GLB_OUTPUT: rawOutput,
    ENGINEERINGHUB_JSON_OUTPUT: jsonOutput,
  }

  const result = spawnSync(freecad, ['-c', command], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`FreeCAD exited with code ${result.status ?? 'unknown'}`)
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

async function copyDracoDecoder() {
  await fs.mkdir(dracoPublicRoot, { recursive: true })
  for (const filename of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
    await fs.copyFile(path.join(dracoSource, filename), path.join(dracoPublicRoot, filename))
  }
}

async function main() {
  const freecad = findFreeCad()
  if (!freecad) throw new Error('FreeCADCmd was not found. Set FREECAD_CMD or install FreeCAD.')

  console.log(`[STEP→GLB+JSON] FreeCADCmd: ${freecad}`)
  console.log(`[STEP→GLB+JSON] Input: ${inputRoot}`)
  await copyDracoDecoder()

  const entries = await fs.readdir(inputRoot, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && /\.(step|stp)$/i.test(entry.name))
    .map((entry) => path.relative(inputRoot, path.join(entry.parentPath ?? entry.path, entry.name)))
    .sort((a, b) => a.localeCompare(b, 'en'))

  if (!files.length) throw new Error(`No STEP/STP files found under ${inputRoot}`)

  let converted = 0
  let skipped = 0
  let failed = 0

  for (const relative of files) {
    const input = path.join(inputRoot, relative)
    const glb = input.replace(/\.(step|stp)$/i, '.glb')
    const json = input.replace(/\.(step|stp)$/i, '.json')
    const rawGlb = input.replace(/\.(step|stp)$/i, '.freecad.raw.glb')

    try {
      const sourceStat = await fs.stat(input)
      let glbStat
      let jsonStat
      try { glbStat = await fs.stat(glb) } catch {}
      try { jsonStat = await fs.stat(json) } catch {}

      if (glbStat?.mtimeMs >= sourceStat.mtimeMs && glbStat.size > 0 && jsonStat?.mtimeMs >= sourceStat.mtimeMs && jsonStat.size > 0) {
        console.log(`[SKIP] ${relative}`)
        skipped += 1
        continue
      }

      console.log(`[CONVERT] ${relative}`)
      await fs.rm(rawGlb, { force: true })
      runFreeCad(freecad, input, rawGlb, json)
      await compressDraco(rawGlb, glb)
      await fs.rm(rawGlb, { force: true })
      console.log(`[OK] ${path.relative(root, glb)}`)
      console.log(`[OK] ${path.relative(root, json)}`)
      converted += 1
    } catch (error) {
      failed += 1
      await fs.rm(rawGlb, { force: true }).catch(() => {})
      console.error(`[FAILED] ${relative}`)
      console.error(error?.stack || error)
    }
  }

  console.log(`Finished. Converted ${converted}, skipped ${skipped}, failed ${failed}, total ${files.length}.`)
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
