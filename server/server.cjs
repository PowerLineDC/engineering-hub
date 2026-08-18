const http = require('http')
const fs = require('fs')
const path = require('path')

const HOST = '0.0.0.0'
const PORT = 3001
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'estimate.json')

fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf8')

const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' })
  res.end(JSON.stringify(data))
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  if (req.method === 'GET' && req.url === '/api/estimate') {
    try { return send(res, 200, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))) }
    catch { return send(res, 500, { error: 'Не удалось прочитать данные' }) }
  }
  if (req.method === 'POST' && req.url === '/api/estimate') {
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
  send(res, 404, { error: 'Not found' })
}).listen(PORT, HOST, () => console.log(`Engineering Hub local server: http://localhost:${PORT}`))
