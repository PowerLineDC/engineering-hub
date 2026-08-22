import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('public/library/dkc')
const output = path.resolve('public/library/dkc-manifest.json')
const publicRoot = path.resolve('public')

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full))
    else if (/\.glb$/i.test(entry.name)) files.push(full)
  }
  return files
}

function toUrl(file) {
  const relative = path.relative(publicRoot, file).split(path.sep).join('/')
  return `/${relative.split('/').map(encodeURIComponent).join('/').replaceAll('%2F', '/')}`
}

function metadata(file) {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const parts = relative.split('/')
  const family = parts.length > 1 ? parts[parts.length - 2] : 'unknown'
  const name = path.basename(file, '.glb')
  const dimensions = [...name.matchAll(/(\d+)\s*[xх×]\s*(\d+)/gi)].map((m) => [Number(m[1]), Number(m[2])])
  const height = name.match(/H\s*=\s*(\d+)/i)?.[1]
  return {
    article: name,
    family,
    path: relative,
    url: toUrl(file),
    width: dimensions[0]?.[0] ?? null,
    depth: dimensions[0]?.[1] ?? null,
    height: height ? Number(height) : null,
  }
}

const files = await walk(root)
const models = files.map(metadata).sort((a, b) => a.article.localeCompare(b.article, 'en'))
await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), count: models.length, models }, null, 2), 'utf8')
console.log(`[DKC manifest] wrote ${output} (${models.length} GLB)`)
