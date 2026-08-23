import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const assemblyRoot = path.join(root, 'public', 'library', 'dkc', 'Osnovnyye_elementy_korpusa_CQE_N', 'Собранные корпуса CQE N со сплошной дверью')
const analyzerScript = path.join(__dirname, 'freecad-analyze-cqe-assemblies.py')

function findFreeCad(explicit) {
  if (explicit) return explicit
  if (process.env.FREECAD_CMD) return process.env.FREECAD_CMD
  const candidates = process.platform === 'win32'
    ? [
        'D:\\программы\\FreeCAD\\FreeCAD_1.1.3-Windows-x86_64-py311\\bin\\FreeCADCmd.exe',
        'D:\\FreeCAD 1.1.3\\bin\\FreeCADCmd.exe',
        'D:\\FreeCAD\\bin\\FreeCADCmd.exe',
        'C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe',
      ]
    : ['/usr/bin/FreeCADCmd', '/usr/local/bin/FreeCADCmd', '/usr/bin/freecadcmd']

  for (const candidate of candidates) {
    const r = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/c', 'if', 'exist', candidate, 'exit', '0', 'else', 'exit', '1'], { windowsHide: true })
      : spawnSync('test', ['-x', candidate])
    if (r.status === 0) return candidate
  }
  return null
}

function runFreeCad(freecad, env) {
  return new Promise((resolve, reject) => {
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
  const freecad = findFreeCad(process.argv[2])
  if (!freecad) throw new Error('FreeCADCmd.exe не найден. Передайте путь первым аргументом или задайте FREECAD_CMD.')
  await fs.access(analyzerScript)
  const entries = await fs.readdir(assemblyRoot, { withFileTypes: true })
  const files = entries.filter(e => e.isFile() && /\.(step|stp)$/i.test(e.name))
  if (!files.length) throw new Error(`Не найдены STEP/STP сборки: ${assemblyRoot}`)

  const outputRoot = path.join(assemblyRoot, 'analysis')
  const env = {
    ...process.env,
    ENGINEERINGHUB_CQE_ASSEMBLY_ROOT: assemblyRoot,
    ENGINEERINGHUB_CQE_ANALYSIS_OUTPUT: outputRoot,
    ENGINEERINGHUB_CQE_LIBRARY_ROOT: path.join(root, 'public', 'library', 'dkc'),
  }

  console.log(`[CQE analyzer] FreeCADCmd: ${freecad}`)
  console.log(`[CQE analyzer] STEP assemblies: ${files.length}`)
  console.log(`[CQE analyzer] Output: ${outputRoot}`)
  console.log('[CQE analyzer] Starting FreeCAD analysis...')

  await runFreeCad(freecad, env)

  console.log('[CQE analyzer] Done')
}

main().catch(error => {
  console.error('[CQE analyzer] FAILED:', error)
  process.exitCode = 1
})
