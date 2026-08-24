import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import './CadConfigurator.css'

type CadGeometry = {
  roots: number
  transferred: number
  solids: number
  shells: number
  faces: number
  boundingBox: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] }
  volume: number
}

const MODEL_URL = '/library/dkc/каркас корпуса/EngineeringHub_OCCT/model.obj'
const MODEL_JSON_URL = '/library/dkc/каркас корпуса/EngineeringHub_OCCT/model.json'

type PartKind = 'base' | 'posts' | 'roof' | 'other'

type CadPart = {
  kind: PartKind
  object: THREE.Object3D
  label: string
}

function buildPartGeometry(source: THREE.BufferGeometry, triangleFilter: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => boolean) {
  const position = source.getAttribute('position')
  if (!position) return null

  const sourceIndex = source.getIndex()
  const vertices: number[] = []
  const indices: number[] = []
  const map = new Map<string, number>()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()

  const addVertex = (x: number, y: number, z: number) => {
    const key = `${x}|${y}|${z}`
    const existing = map.get(key)
    if (existing !== undefined) return existing
    const index = vertices.length / 3
    vertices.push(x, y, z)
    map.set(key, index)
    return index
  }

  const triangleCount = sourceIndex ? sourceIndex.count / 3 : position.count / 3
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = sourceIndex ? sourceIndex.getX(triangle * 3) : triangle * 3
    const ib = sourceIndex ? sourceIndex.getX(triangle * 3 + 1) : triangle * 3 + 1
    const ic = sourceIndex ? sourceIndex.getX(triangle * 3 + 2) : triangle * 3 + 2
    a.fromBufferAttribute(position, ia)
    b.fromBufferAttribute(position, ib)
    c.fromBufferAttribute(position, ic)
    if (!triangleFilter(a, b, c)) continue
    indices.push(addVertex(a.x, a.y, a.z), addVertex(b.x, b.y, b.z), addVertex(c.x, c.y, c.z))
  }

  if (!indices.length) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function splitMonolithicModel(source: THREE.Object3D) {
  const meshes: THREE.Mesh[] = []
  source.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child)
  })
  if (!meshes.length) return [] as CadPart[]

  const sourceMesh = meshes[0]
  const sourceGeometry = sourceMesh.geometry
  sourceGeometry.computeBoundingBox()
  const box = sourceGeometry.boundingBox
  if (!box) return [] as CadPart[]

  const size = box.getSize(new THREE.Vector3())
  const min = box.min.clone()
  const max = box.max.clone()
  const yHeight = Math.max(size.y, 1)

  // The current OCCT OBJ is a single mesh. Until the exporter emits named
  // assembly components, split the mesh by spatial regions so the configurator
  // can already manipulate the real roof and the four posts as rigid groups.
  const roofY = min.y + yHeight * 0.82
  const baseY = min.y + yHeight * 0.16
  const postMinY = min.y + yHeight * 0.08
  const postMaxY = min.y + yHeight * 0.92
  const xMid = (min.x + max.x) / 2
  const zMid = (min.z + max.z) / 2
  const xQuarter = Math.max(size.x * 0.28, 1)
  const zQuarter = Math.max(size.z * 0.28, 1)

  const material = new THREE.MeshStandardMaterial({
    color: 0x9da8b2,
    metalness: 0.45,
    roughness: 0.42,
    side: THREE.DoubleSide,
  })

  const parts: CadPart[] = []
  const roofGeometry = buildPartGeometry(sourceGeometry, (a, b, c) => ((a.y + b.y + c.y) / 3) >= roofY)
  if (roofGeometry) {
    const roof = new THREE.Mesh(roofGeometry, material.clone())
    parts.push({ kind: 'roof', object: roof, label: 'Крыша' })
  }

  const baseGeometry = buildPartGeometry(sourceGeometry, (a, b, c) => ((a.y + b.y + c.y) / 3) <= baseY)
  if (baseGeometry) {
    const base = new THREE.Mesh(baseGeometry, material.clone())
    parts.push({ kind: 'base', object: base, label: 'Основание' })
  }

  const postGroups = [
    { x: -1, z: -1 }, { x: -1, z: 1 }, { x: 1, z: -1 }, { x: 1, z: 1 },
  ]
  postGroups.forEach((corner, index) => {
    const geometry = buildPartGeometry(sourceGeometry, (a, b, c) => {
      const y = (a.y + b.y + c.y) / 3
      if (y < postMinY || y > postMaxY || y >= roofY || y <= baseY) return false
      const x = (a.x + b.x + c.x) / 3
      const z = (a.z + b.z + c.z) / 3
      return Math.abs(x - (xMid + corner.x * xQuarter)) < size.x * 0.18 && Math.abs(z - (zMid + corner.z * zQuarter)) < size.z * 0.18
    })
    if (!geometry) return
    const post = new THREE.Mesh(geometry, material.clone())
    parts.push({ kind: 'posts', object: post, label: `Стойка ${index + 1}` })
  })

  // Keep anything not classified by the current spatial rules visible and fixed.
  const classifiedRoof = roofY
  const otherGeometry = buildPartGeometry(sourceGeometry, (a, b, c) => {
    const y = (a.y + b.y + c.y) / 3
    if (y >= classifiedRoof || y <= baseY) return false
    const x = (a.x + b.x + c.x) / 3
    const z = (a.z + b.z + c.z) / 3
    return !postGroups.some((corner) => Math.abs(x - (xMid + corner.x * xQuarter)) < size.x * 0.18 && Math.abs(z - (zMid + corner.z * zQuarter)) < size.z * 0.18)
  })
  if (otherGeometry) {
    const other = new THREE.Mesh(otherGeometry, material.clone())
    parts.push({ kind: 'other', object: other, label: 'Прочие элементы' })
  }

  return parts
}

function CadConfigurator({ onClose }: { onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = useState<CadGeometry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPart, setSelectedPart] = useState('Нет')

  useEffect(() => {
    let cancelled = false
    const viewport = viewportRef.current
    if (!viewport) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x11161c)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    viewport.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    scene.add(new THREE.HemisphereLight(0xffffff, 0x202830, 2.2))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5)
    keyLight.position.set(500, 1000, 700)
    scene.add(keyLight)
    const grid = new THREE.GridHelper(4000, 40, 0x3a4652, 0x26303a)
    scene.add(grid)

    const transform = new TransformControls(camera, renderer.domElement)
    transform.setMode('translate')
    transform.setSpace('world')
    transform.setSize(0.8)
    transform.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value
    })
    scene.add(transform.getHelper())

    const parts: CadPart[] = []
    let selected: CadPart | null = null
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    const selectPart = (part: CadPart | null) => {
      if (!part || part.kind === 'base' || part.kind === 'other') {
        selected = null
        transform.detach()
        setSelectedPart(part?.label ?? 'Нет')
        return
      }
      selected = part
      transform.attach(part.object)
      setSelectedPart(part.label)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || transform.dragging) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const intersections = raycaster.intersectObjects(parts.map((part) => part.object), true)
      if (!intersections.length) {
        selectPart(null)
        return
      }
      const hit = intersections[0].object
      const part = parts.find((item) => item.object === hit || item.object === hit.parent)
      selectPart(part ?? null)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)

    const resize = () => {
      const width = viewport.clientWidth
      const height = viewport.clientHeight
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    const loadModel = async () => {
      setLoading(true)
      setError(null)
      try {
        const [jsonResponse, object] = await Promise.all([
          fetch(MODEL_JSON_URL),
          new OBJLoader().loadAsync(MODEL_URL),
        ])
        if (!jsonResponse.ok) throw new Error(`Не удалось загрузить OCCT JSON: ${jsonResponse.status}`)
        const inspect = await jsonResponse.json() as CadGeometry
        if (cancelled) return
        setGeometry(inspect)

        const box = new THREE.Box3().setFromObject(object)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        object.position.sub(center)
        grid.position.y = -size.y / 2

        const splitParts = splitMonolithicModel(object)
        splitParts.forEach((part) => {
          part.object.position.copy(object.position)
          scene.add(part.object)
          parts.push(part)
        })

        const maxDimension = Math.max(size.x, size.y, size.z, 1)
        const distance = maxDimension * 1.65
        camera.position.set(distance, distance * 0.8, distance)
        camera.near = Math.max(maxDimension / 10000, 0.1)
        camera.far = maxDimension * 20
        camera.updateProjectionMatrix()
        controls.target.set(0, 0, 0)
        controls.update()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить CAD-модель')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadModel()
    let animationFrame = 0
    const animate = () => {
      animationFrame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelled = true
      cancelAnimationFrame(animationFrame)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', resize)
      controls.dispose()
      transform.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === viewport) viewport.removeChild(renderer.domElement)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
          else object.material.dispose()
        }
      })
    }
  }, [])

  const dimension = geometry?.boundingBox.size ?? [0, 0, 0]

  return (
    <div className="cad-overlay">
      <div className="cad-shell">
        <header className="cad-header">
          <div>
            <div className="cad-kicker">OCCT CAD CORE</div>
            <h2>Конфигуратор НКУ</h2>
            <div className="cad-file">R5CQEN1464A · OCCT mesh</div>
          </div>
          <button className="cad-close" onClick={onClose}>✕</button>
        </header>

        <div className="cad-toolbar">
          <label>Каркас
            <select value="R5CQEN1464A" disabled>
              <option value="R5CQEN1464A">R5CQEN1464A</option>
            </select>
          </label>
          <div className="cad-status">{loading ? 'Загрузка OCCT-модели…' : error ? 'Ошибка' : `Выбрано: ${selectedPart}`}</div>
        </div>

        <div className="cad-main">
          <div className="cad-viewport" ref={viewportRef}>{error && <div className="cad-error">{error}</div>}</div>
          <aside className="cad-inspector">
            <h3>Геометрия</h3>
            <div className="cad-stat"><span>X</span><strong>{dimension[0].toFixed(1)} мм</strong></div>
            <div className="cad-stat"><span>Y</span><strong>{dimension[1].toFixed(1)} мм</strong></div>
            <div className="cad-stat"><span>Z</span><strong>{dimension[2].toFixed(1)} мм</strong></div>
            <div className="cad-divider" />
            <div className="cad-row"><span>Выбранный элемент</span><b>{selectedPart}</b></div>
            <div className="cad-row"><span>Основание</span><b>Закреплено</b></div>
            <div className="cad-divider" />
            <div className="cad-row"><span>Корней STEP</span><b>{geometry?.roots ?? '—'}</b></div>
            <div className="cad-row"><span>Solid</span><b>{geometry?.solids ?? '—'}</b></div>
            <div className="cad-row"><span>Shell</span><b>{geometry?.shells ?? '—'}</b></div>
            <div className="cad-row"><span>Faces</span><b>{geometry?.faces ?? '—'}</b></div>
            <div className="cad-divider" />
            <p className="cad-note">ЛКМ выбирает крышу или стойки. Перемещение выполняется только в режиме Translate; основание закреплено на рабочей сетке.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default CadConfigurator
