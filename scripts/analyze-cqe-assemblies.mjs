import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const assemblyRoot = path.join(
  root,
  'public',
  'library',
  'dkc',
  'Osnovnyye_elementy_korpusa_CQE_N',
  'Собранные корпуса CQE N со сплошной дверью',
)
const analyzerScript = path.join(__dirname, 'freecad-analyze-cqe-assemblies.py')
const output = path.join(assemblyRoot, 'cqe-assembly-analysis.json')

function findFreeCad() {
  if (process.env.FREECAD_CMD) return process.env.FREECAD_CMD

  const candidates = process.platform === 'win32'
    ? [
        'D:\\программы\\FreeCAD\\FreeCAD_1.1.3-Windows-x86_64-py311\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 0.21\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 0.20\\bin\\FreeCADCmd.exe',
      ]
    : ['/usr/bin/FreeCADCmd', '/usr/local/bin/FreeCADCmd', '/usr/bin/freecadcmd']

  for (const candidate of candidates) {
    const result = spawnSync(
      process.platform === 'win32' ? 'cmd.exe' : 'test',
      process.platform === 'win32'
        ? ['/c', 'if', 'exist', candidate, 'exit', '0', 'else', 'exit', '1']
        : ['-x', candidate],
      { windowsHide: true },
    )
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

async function main() {
  const freecad = findFreeCad()
  if (!freecad) {
    throw new Error('FreeCADCmd was not found. Install FreeCAD or set FREECAD_CMD to the full path of FreeCADCmd.exe.')
  }

  await fs.access(analyzerScript)
  await fs.mkdir(assemblyRoot, { recursive: true })

  const entries = await fs.readdir(assemblyRoot, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && /\.(step|stp)$/i.test(entry.name))
    .map((entry) => path.join(assemblyRoot, entry.name))
    .sort((a, b) => a.localeCompare(b, 'en'))

  if (!files.length) throw new Error(`No STEP/STP assembly files found in ${assemblyRoot}`)

  const env = {
    ...process.env,
    ENGINEERINGHUB_CQE_ASSEMBLY_ROOT: assemblyRoot,
    ENGINEERINGHUB_CQE_ANALYSIS_OUTPUT: output,
  }

  console.log(`[CQE analysis] FreeCADCmd: ${freecad}`)
  console.log(`[CQE analysis] STEP assemblies: ${files.length}`)
  console.log(`[CQE analysis] Output: ${output}`)
  console.log('[CQE analysis] Starting FreeCAD analysis...')

  // Do not use FreeCADCmd -c here. -c starts FreeCAD's interactive console,
  // so spawnSync waits for stdin and the analyzer appears to hang after startup.
  // FreeCADCmd accepts a Python script as a positional argument and exits when
  // that script finishes.
  const result = spawnSync(freecad, [analyzerScript], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env,
  })

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`FreeCAD exited with code ${result.status ?? 'unknown'}`)
  }

  let stat
  try {
    stat = await fs.stat(output)
  } catch {
    throw new Error(`FreeCAD finished successfully, but the analysis file was not created: ${output}`)
  }

  if (!stat.isFile() || stat.size < 10) {
    throw new Error(`Analysis file was created but is empty or invalid: ${output}`)
  }

  console.log(`[CQE analysis] Done: ${stat.size} bytes`)
  console.log(`[CQE analysis] Saved: ${output}`)
}

main().catch((error) => {
  console.error('[CQE analysis] FAILED:', error)
  process.exitCode = 1
})
