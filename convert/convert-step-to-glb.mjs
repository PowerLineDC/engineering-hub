import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const inputRoot = path.join(root, 'native', 'occt-reader', 'dkc', 'Osnovnyye_elementy_korpusa_CQE_N', 'R5NKMN')
const freecadScript = path.join(__dirname, 'freecad-step-to-glb-json.py')

function findFreeCad() {
  if (process.env.FREECAD_CMD) return process.env.FREECAD_CMD
  const candidates = process.platform === 'win32'
    ? [
        'D:\\программы\\FreeCAD\\FreeCAD_1.1.3-Windows-x86_64-py311\\bin\\FreeCADCmd.exe',
        'D:\\программы\\FreeCAD 1.1.3\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCADCmd.exe'
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
  if (result.status === 0) return result.stdout.trim().split(/\r?\n/).find(Boolean) ?? null
  return null
}

function runFreeCad(freecad, input, glbOutput, jsonOutput) {
  const scriptPath = freecadScript.replace(/\\/g, '/').replace(/'/g, "\\'")
  const command = `exec(open('${scriptPath}', encoding='utf-8').read())`
  const result = spawnSync(freecad, ['-c', command], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      ENGINEERINGHUB_STEP_INPUT: input,
      ENGINEERINGHUB_GLB_OUTPUT: glbOutput,
      ENGINEERINGHUB_JSON_OUTPUT: jsonOutput
    }
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`FreeCAD exited with code ${result.status ?? 'unknown'}`)
}

async function main() {
  const freecad = findFreeCad()
  if (!freecad) throw new Error('FreeCADCmd was not found. Set FREECAD_CMD to the full path of FreeCADCmd.exe.')
  console.log(`[STEP→GLB+JSON] FreeCADCmd: ${freecad}`)
  console.log(`[STEP→GLB+JSON] Input: ${inputRoot}`)

  const entries = await fs.readdir(inputRoot, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && /\.(step|stp)$/i.test(entry.name))
    .map((entry) => path.relative(inputRoot, path.join(entry.parentPath ?? entry.path, entry.name)))
    .sort((a, b) => a.localeCompare(b, 'en'))

  if (!files.length) throw new Error(`No STEP/STP files found under ${inputRoot}`)

  let converted = 0, skipped = 0, failed = 0
  for (const relative of files) {
    const input = path.join(inputRoot, relative)
    const glb = input.replace(/\.(step|stp)$/i, '.glb')
    const json = input.replace(/\.(step|stp)$/i, '.json')
    try {
      const sourceStat = await fs.stat(input)
      let glbStat, jsonStat
      try { glbStat = await fs.stat(glb) } catch {}
      try { jsonStat = await fs.stat(json) } catch {}
      if (glbStat?.mtimeMs >= sourceStat.mtimeMs && glbStat.size > 0 && jsonStat?.mtimeMs >= sourceStat.mtimeMs && jsonStat.size > 0) {
        console.log(`[SKIP] ${relative}`)
        skipped++
        continue
      }
      console.log(`[CONVERT] ${relative}`)
      runFreeCad(freecad, input, glb, json)
      console.log(`[OK] ${path.relative(root, glb)}`)
      console.log(`[OK] ${path.relative(root, json)}`)
      converted++
    } catch (error) {
      failed++
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
