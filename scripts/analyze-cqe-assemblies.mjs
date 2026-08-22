import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const assemblyRoot = path.join(root, 'public', 'library', 'dkc', 'Osnovnyye_elementy_korpusa_CQE_N', 'Собранные корпуса CQE N со сплошной дверью')
const analyzerScript = path.join(__dirname, 'freecad-analyze-cqe-assemblies.py')
const output = path.join(assemblyRoot, 'cqe-assembly-analysis.json')

function findFreeCad() {
  if (process.env.FREECAD_CMD) return process.env.FREECAD_CMD
  const candidates = process.platform === 'win32'
    ? ['D:\\программы\\FreeCAD\\FreeCAD_1.1.3-Windows-x86_64-py311\\bin\\FreeCADCmd.exe', 'C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe']
    : ['/usr/bin/FreeCADCmd', '/usr/local/bin/FreeCADCmd', '/usr/bin/freecadcmd']
  for (const candidate of candidates) {
    const r = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'test', process.platform === 'win32' ? ['/c', 'if', 'exist', candidate, 'exit', '0', 'else', 'exit', '1'] : ['-x', candidate], { windowsHide: true })
    if (r.status === 0) return candidate
  }
  return null
}

function runFreeCad(freecad, env) {
  return new Promise((resolve, reject) => {
    // FreeCADCmd is documented to execute a Python script passed as a file.
    // The analyzer has an unconditional main(), which also works around the
    // FreeCAD 1.1 import-vs-__main__ behavior.
    const child = spawn(freecad, [analyzerScript], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.on('data', chunk => process.stdout.write(chunk))
    child.stderr.on('data', chunk => process.stderr.write(chunk))
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (signal) reject(new Error(`FreeCAD terminated by signal ${signal}`))
      else if (code !== 0) reject(new Error(`FreeCAD exited with code ${code}`))
      else resolve()
    })
  })
}

async function main() {
  const freecad = findFreeCad()
  if (!freecad) throw new Error('FreeCADCmd was not found')
  await fs.access(analyzerScript)
  const entries = await fs.readdir(assemblyRoot, { withFileTypes: true })
  const files = entries.filter(e => e.isFile() && /\.(step|stp)$/i.test(e.name))
  if (!files.length) throw new Error(`No STEP/STP assembly files found in ${assemblyRoot}`)

  const env = {
    ...process.env,
    ENGINEERINGHUB_CQE_ASSEMBLY_ROOT: assemblyRoot,
    ENGINEERINGHUB_CQE_ANALYSIS_OUTPUT: output,
  }

  console.log(`[CQE analysis] FreeCADCmd: ${freecad}`)
  console.log(`[CQE analysis] STEP assemblies: ${files.length}`)
  console.log(`[CQE analysis] Analyzer: ${analyzerScript}`)
  console.log('[CQE analysis] Starting FreeCAD analysis...')
  console.log('[CQE analysis] Live output follows:')

  await runFreeCad(freecad, env)

  const stat = await fs.stat(output).catch(() => null)
  if (!stat || stat.size < 10) throw new Error(`FreeCAD finished successfully, but the analysis file was not created: ${output}`)
  console.log(`[CQE analysis] Done: ${stat.size} bytes`)
  console.log(`[CQE analysis] Saved: ${output}`)
}

main().catch(error => {
  console.error('[CQE analysis] FAILED:', error)
  process.exitCode = 1
})
