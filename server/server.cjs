const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const HOST = '0.0.0.0'
const PORT = 3001
const ROOT_DIR = path.join(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'estimate.json')
const CAD_CACHE_DIR = path.join(DATA_DIR, 'cad')
const DEFAULT_OCCT_EXE = path.join(ROOT_DIR, 'native', 'occt-reader', 'build', 'Release', 'occt-reader.exe')
const OCCT_EXE = process.env.OCCT_READER_EXE || DEFAULT_OCCT_EXE

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

const cadId = (stepUrl) => crypto.createHash('sha256').update(stepUrl).digest('hex').slice(0, 16)

const loadCad = (stepUrl) => {
  const stepPath = resolveStepPath(stepUrl)
  if (!stepPath) return { error: 'STEP file must point to an existing /library/*.STEP or /library/*.stp file' }
  if (!fs.existsSync(OCCT_EXE)) return { error: `OCCT reader not found: ${OCCT_EXE}` }

  const id = cadId(stepUrl)
  const jsonPath = path.join(CAD_CACHE_DIR, `${id}.json`)
  const objPath = path.join(CAD_CACHE_DIR, `${id}.obj`)

  if (!fs.existsSync(jsonPath) || !fs.existsSync(objPath)) {
    try {
      execFileSync(OCCT_EXE, [stepPath, jsonPath, objPath], { cwd: ROOT_DIR, windowsHide: true, stdio: 'pipe' })
    } catch (error) {
      const stderr = error.stderr ? error.stderr.toString() : ''
      const stdout = error.stdout ? error.stdout.toString() : ''
      return { error: 'OCCT failed to process STEP', details: `${stderr}\n${stdout}`.trim() }
    }
  }

  try {
    const geometry = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    return { ...geometry, id, modelUrl: `/api/cad/model?id=${id}`, stepUrl }
  } catch {
    return { error: 'OCCT returned invalid geometry JSON' }
  }
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'GET' && url.pathname === '/api/estimate') {
    try { return send(res, 200, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))) }
    catch { return send(res, 500, { error: 'Не удалось прочитать данные' }) }
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
        fs.writeFileSync(DATA_FILE, JSON.stringify(estimate, null, 2), 'utf8')
        send(res, 200, estimate[input.id])
      } catch { send(res, 400, { error: 'Некорректный JSON' }) }
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/cad/inspect') {
    const result = loadCad(url.searchParams.get('step'))
    return send(res, result.error ? 500 : 200, result)
  }

  if (req.method === 'GET' && url.pathname === '/api/cad/load') {
    const result = loadCad(url.searchParams.get('step'))
    return send(res, result.error ? 500 : 200, result)
  }

  if (req.method === 'GET' && url.pathname === '/api/cad/model') {
    const id = url.searchParams.get('id')
    if (!/^[a-f0-9]{16}$/.test(id || '')) return send(res, 400, { error: 'Invalid CAD model id' })
    const objPath = path.join(CAD_CACHE_DIR, `${id}.obj`)
    if (!fs.existsSync(objPath)) return send(res, 404, { error: 'CAD model not generated' })
    return send(res, 200, fs.readFileSync(objPath, 'utf8'), 'text/plain; charset=utf-8')
  }

  send(res, 404, { error: 'Not found' })
}).listen(PORT, HOST, () => console.log(`Engineering Hub local server: http://localhost:${PORT}`))
