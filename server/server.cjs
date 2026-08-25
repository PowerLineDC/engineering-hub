const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const HOST = '0.0.0.0'
const PORT = 3001
const ROOT_DIR = path.join(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'estimate.json')
const CAD_CACHE_DIR = path.join(DATA_DIR, 'cad')
const DEFAULT_OCCT_EXE = path.join(ROOT_DIR, 'native', 'occt-reader', 'build', 'Release', 'occt-reader.exe')
const DEFAULT_OCCT_XDE_EXE = path.join(ROOT_DIR, 'native', 'occt-reader', 'build', 'Release', 'occt-xde-reader.exe')
const OCCT_EXE = process.env.OCCT_READER_EXE || DEFAULT_OCCT_EXE
const OCCT_XDE_EXE = process.env.OCCT_XDE_READER_EXE || DEFAULT_OCCT_XDE_EXE

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(CAD_CACHE_DIR, { recursive: true })
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf8')

const send = (res, status, data, contentType = 'application/json; charset=utf-8') => {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(contentType.startsWith('application/json') ? JSON.stringify(data) : data)
}

const resolveStepPath = (stepUrl) => {
  if (!stepUrl || !stepUrl.startsWith('/library/') || !/\.(?:stp|step)$/i.test(stepUrl)) return null
  const relative = stepUrl.replace(/^\/+/, '')
  const absolute = path.resolve(PUBLIC_DIR, relative.replace(/^library[\\/]/, 'library/'))
  const publicRoot = path.resolve(PUBLIC_DIR) + path.sep
  if (!absolute.startsWith(publicRoot)) return null
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null
  return absolute
}

const cadId = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)

const runReader = (exe, args) => {
  const result = spawnSync(exe, args, {
    cwd: ROOT_DIR,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) return `spawn error: ${result.error.message}`
  const stdout = String(result.stdout || '').trim()
  const stderr = String(result.stderr || '').trim()
  if (result.status !== 0) return `exit code ${result.status}${result.signal ? `, signal ${result.signal}` : ''}\n${stderr}\n${stdout}`.trim()
  return null
}

const loadCad = (stepUrl) => {
  const stepPath = resolveStepPath(stepUrl)
  if (!stepPath) return { error: 'STEP file must point to an existing /library/*.STEP or /library/*.stp file' }
  if (!fs.existsSync(OCCT_EXE)) return { error: `OCCT reader not found: ${OCCT_EXE}` }
  const id = cadId(stepUrl)
  const jsonPath = path.join(CAD_CACHE_DIR, `${id}.json`)
  const objPath = path.join(CAD_CACHE_DIR, `${id}.obj`)
  if (!fs.existsSync(jsonPath) || !fs.existsSync(objPath)) {
    const details = runReader(OCCT_EXE, [stepPath, jsonPath, objPath])
    if (details) return { error: 'OCCT failed to process STEP', details }
  }
  try {
    const geometry = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    return { ...geometry, id, modelUrl: `/api/cad/model?id=${id}`, stepUrl }
  } catch { return { error: 'OCCT returned invalid geometry JSON' } }
}

const loadCadAssembly = (assemblyUrl, referenceUrl) => {
  const assemblyPath = resolveStepPath(assemblyUrl)
  const referencePath = resolveStepPath(referenceUrl)
  if (!assemblyPath || !referencePath) return { error: 'Assembly and reference must be existing STEP files under /library/' }
  if (!fs.existsSync(OCCT_EXE)) return { error: `OCCT reader not found: ${OCCT_EXE}` }
  const id = cadId(assemblyUrl, referenceUrl)
  const jsonPath = path.join(CAD_CACHE_DIR, `${id}.assembly.json`)
  const objPath = path.join(CAD_CACHE_DIR, `${id}.assembly.obj`)
  const componentDir = path.join(CAD_CACHE_DIR, `${id}.components`)
  let validCache = false
  if (fs.existsSync(jsonPath) && fs.existsSync(componentDir)) {
    try {
      const cached = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      const components = Array.isArray(cached.components) ? cached.components : []
      const posts = components.filter(component => component && component.type === 'post')
      validCache = components.length > 0 && posts.length > 0 && components.every(component => {
        const modelName = path.basename(String(component.modelUrl || '').split('file=')[1] || '')
        return /^(?:post|other)-\d+\.obj$/i.test(modelName) && fs.existsSync(path.join(componentDir, modelName))
      })
    } catch { validCache = false }
  }
  if (!validCache) {
    fs.rmSync(componentDir, { recursive: true, force: true }); fs.mkdirSync(componentDir, { recursive: true })
    fs.rmSync(jsonPath, { force: true }); fs.rmSync(objPath, { force: true })
    const details = runReader(OCCT_EXE, [assemblyPath, jsonPath, objPath, referencePath, componentDir])
    if (details) return { error: 'OCCT failed to recognize assembly components', details }
  }
  try {
    const result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    const components = Array.isArray(result.components) ? result.components : []
    const posts = components.filter(component => component && component.type === 'post')
    if (!components.length || !posts.length) return { error: 'OCCT recognition returned no components', details: `solidCount=${result.solidCount ?? 'unknown'}, postCount=${result.postCount ?? 'unknown'}` }
    result.components = components.map(component => ({ ...component, modelUrl: `/api/cad/component?id=${id}&file=${encodeURIComponent(path.basename(String(component.modelUrl || '').split('file=')[1] || ''))}` }))
    result.cacheId = id
    return result
  } catch (error) { return { error: 'OCCT returned invalid assembly JSON', details: error instanceof Error ? error.message : String(error) } }
}

const listDkcStepFiles = () => {
  const root = path.join(PUBLIC_DIR, 'library', 'dkc')
  const result = []
  const walk = dir => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile() && /\.(?:step|stp)$/i.test(entry.name)) {
        const relative = path.relative(PUBLIC_DIR, absolute).split(path.sep).join('/')
        result.push({ name: entry.name, path: `/${relative}` })
      }
    }
  }
  walk(root)
  result.sort((a, b) => a.path.localeCompare(b.path, 'ru'))
  return result
}

const loadXde = (stepUrl) => {
  const stepPath = resolveStepPath(stepUrl)
  if (!stepPath) return { error: 'XDE source must be an existing STEP file under /library/' }
  if (!fs.existsSync(OCCT_XDE_EXE)) return { error: `OCCT XDE reader not found: ${OCCT_XDE_EXE}` }
  const id = cadId('xde', stepUrl)
  const jsonPath = path.join(CAD_CACHE_DIR, `${id}.xde.json`)
  const componentDir = path.join(CAD_CACHE_DIR, `${id}.xde.components`)
  const hasCache = fs.existsSync(jsonPath) && fs.existsSync(componentDir)
  if (!hasCache) {
    fs.rmSync(componentDir, { recursive: true, force: true }); fs.mkdirSync(componentDir, { recursive: true }); fs.rmSync(jsonPath, { force: true })
    const details = runReader(OCCT_XDE_EXE, [stepPath, jsonPath, componentDir])
    if (details) return { error: 'OCCT XDE failed to process STEP', details }
  }
  try {
    const result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    result.cacheId = id
    result.components = (result.components || []).map(component => ({ ...component, modelUrl: `/api/cad/xde-component?id=${id}&file=${encodeURIComponent(path.basename(String(component.modelUrl || '').split('file=')[1] || ''))}` }))
    return result
  } catch (error) { return { error: 'OCCT XDE returned invalid JSON', details: error instanceof Error ? error.message : String(error) } }
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'GET' && url.pathname === '/api/estimate') {
    try { return send(res, 200, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))) } catch { return send(res, 500, { error: 'Не удалось прочитать данные' }) }
  }
  if (req.method === 'POST' && url.pathname === '/api/estimate') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const input = JSON.parse(body)
        if (!input || typeof input.id !== 'string') return send(res, 400, { error: 'Некорректные данные' })
        const estimate = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
        estimate[input.id] = { quantity: input.quantity, updatedAt: new Date().toISOString() }
        fs.writeFileSync(DATA_FILE, JSON.stringify(estimate, null, 2), 'utf8'); send(res, 200, estimate[input.id])
      } catch { send(res, 400, { error: 'Некорректный JSON' }) }
    }); return
  }
  if (req.method === 'GET' && url.pathname === '/api/cad/files') return send(res, 200, { files: listDkcStepFiles() })
  if (req.method === 'GET' && url.pathname === '/api/cad/inspect') { const result = loadCad(url.searchParams.get('step')); return send(res, result.error ? 500 : 200, result) }
  if (req.method === 'GET' && url.pathname === '/api/cad/load') { const result = loadCad(url.searchParams.get('step')); return send(res, result.error ? 500 : 200, result) }
  if (req.method === 'GET' && url.pathname === '/api/cad/recognize') { const result = loadCadAssembly(url.searchParams.get('assembly'), url.searchParams.get('reference')); return send(res, result.error ? 500 : 200, result) }
  if (req.method === 'GET' && url.pathname === '/api/cad/xde') { const result = loadXde(url.searchParams.get('step')); return send(res, result.error ? 500 : 200, result) }
  if (req.method === 'GET' && url.pathname === '/api/cad/model') {
    const id = url.searchParams.get('id'); if (!/^[a-f0-9]{16}$/.test(id || '')) return send(res, 400, { error: 'Invalid CAD model id' })
    const objPath = path.join(CAD_CACHE_DIR, `${id}.obj`); if (!fs.existsSync(objPath)) return send(res, 404, { error: 'CAD model not generated' })
    return send(res, 200, fs.readFileSync(objPath, 'utf8'), 'text/plain; charset=utf-8')
  }
  if (req.method === 'GET' && url.pathname === '/api/cad/component') {
    const id = url.searchParams.get('id') || ''; const file = url.searchParams.get('file') || ''
    if (!/^[a-f0-9]{16}$/.test(id) || !/^(?:post|other)-\d+\.obj$/i.test(file)) return send(res, 400, { error: 'Invalid CAD component reference' })
    const objPath = path.join(CAD_CACHE_DIR, `${id}.components`, file); if (!fs.existsSync(objPath)) return send(res, 404, { error: 'CAD component not generated' })
    return send(res, 200, fs.readFileSync(objPath, 'utf8'), 'text/plain; charset=utf-8')
  }
  if (req.method === 'GET' && url.pathname === '/api/cad/xde-component') {
    const id = url.searchParams.get('id') || ''; const file = url.searchParams.get('file') || ''
    if (!/^[a-f0-9]{16}$/.test(id) || !/^component-\d+\.obj$/i.test(file)) return send(res, 400, { error: 'Invalid XDE component reference' })
    const objPath = path.join(CAD_CACHE_DIR, `${id}.xde.components`, file); if (!fs.existsSync(objPath)) return send(res, 404, { error: 'XDE component not generated' })
    return send(res, 200, fs.readFileSync(objPath, 'utf8'), 'text/plain; charset=utf-8')
  }
  send(res, 404, { error: 'Not found' })
}).listen(PORT, HOST, () => console.log(`Engineering Hub local server: http://localhost:${PORT}`))
