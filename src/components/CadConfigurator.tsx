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
  modelUrl: string
  stepUrl: string
}

const HEIGHTS = [1000, 1200, 1400, 1600, 1800, 2000, 2200]
const LIBRARY_ROOT = '/library/dkc/Osnovnyye_elementy_korpusa_CQE_N/R5NKMN'
const STEP_FOR_HEIGHT: Record<number, string> = Object.fromEntries(
  HEIGHTS.map((height) => [height, `${LIBRARY_ROOT}/R5NKMN${height / 100}.STEP`]),
)

function CadConfigurator({ onClose }: { onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const loadModelRef = useRef<((height: number, firstLoad?: boolean) => Promise<void>) | null>(null)
  const [height, setHeight] = useState(2000)
  const [geometry, setGeometry] = useState<CadGeometry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(false)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let cancelled = false
    let currentPosts: THREE.Group | null = null
    let animationFrame = 0

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
    transform.setTranslationSnap(1)
    transform.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value
    })
    scene.add(transform.getHelper())

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    const disposeObject = (object: THREE.Object3D) => {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.geometry.dispose()
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose())
        else child.material.dispose()
      })
      scene.remove(object)
    }

    const selectPosts = () => {
      if (!currentPosts) return
      transform.attach(currentPosts)
      setSelected(true)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || transform.dragging || !currentPosts) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObject(currentPosts, true)
      if (hits.length > 0) selectPosts()
      else {
        transform.detach()
        setSelected(false)
      }
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)

    const loadModel = async (selectedHeight: number, firstLoad = false) => {
      setLoading(true)
      setError(null)
      transform.detach()
      setSelected(false)

      try {
        const stepUrl = STEP_FOR_HEIGHT[selectedHeight]
        const response = await fetch(`/api/cad/load?step=${encodeURIComponent(stepUrl)}`)
        const data = await response.json() as CadGeometry & { error?: string; details?: string }
        if (!response.ok || data.error) {
          throw new Error(data.details ? `${data.error}: ${data.details}` : data.error || `CAD server error: ${response.status}`)
        }
        const object = await new OBJLoader().loadAsync(data.modelUrl)
        if (cancelled) {
          disposeObject(object)
          return
        }

        const box = new THREE.Box3().setFromObject(object)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        object.position.sub(center)
        grid.position.y = -size.y / 2

        object.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return
          child.material = new THREE.MeshStandardMaterial({
            color: 0x9da8b2,
            metalness: 0.45,
            roughness: 0.42,
            side: THREE.DoubleSide,
          })
        })

        const posts = new THREE.Group()
        posts.name = 'R5NKMN_FOUR_POSTS'
        posts.userData.partType = 'four-posts'
        posts.userData.manufacturer = 'DKC'
        posts.userData.article = `R5NKMN${selectedHeight / 100}`
        posts.userData.height = selectedHeight
        posts.add(object)

        if (currentPosts) disposeObject(currentPosts)
        currentPosts = posts
        scene.add(posts)
        setGeometry(data)

        if (firstLoad) {
          const maxDimension = Math.max(size.x, size.y, size.z, 1)
          const distance = maxDimension * 1.65
          camera.position.set(distance, distance * 0.8, distance)
          camera.near = Math.max(maxDimension / 10000, 0.1)
          camera.far = maxDimension * 20
          camera.updateProjectionMatrix()
          controls.target.set(0, 0, 0)
          controls.update()
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить STEP-модель')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadModelRef.current = loadModel
    void loadModel(2000, true)

    const resize = () => {
      const width = viewport.clientWidth
      const heightPx = viewport.clientHeight
      renderer.setSize(width, heightPx, false)
      camera.aspect = width / Math.max(heightPx, 1)
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    const animate = () => {
      animationFrame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelled = true
      loadModelRef.current = null
      cancelAnimationFrame(animationFrame)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', resize)
      transform.detach()
      transform.dispose()
      controls.dispose()
      if (currentPosts) disposeObject(currentPosts)
      renderer.dispose()
      if (renderer.domElement.parentNode === viewport) viewport.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => {
    if (height === 2000) return
    void loadModelRef.current?.(height)
  }, [height])

  const dimension = geometry?.boundingBox.size ?? [0, 0, 0]

  return (
    <div className="cad-overlay">
      <div className="cad-shell">
        <header className="cad-header">
          <div>
            <div className="cad-kicker">OCCT CAD CORE</div>
            <h2>Конфигуратор НКУ</h2>
            <div className="cad-file">DKC · 4 стойки · R5NKMN{height / 100}.STEP</div>
          </div>
          <button className="cad-close" onClick={onClose}>✕</button>
        </header>

        <div className="cad-toolbar">
          <label htmlFor="cad-height-select">Высота
            <select id="cad-height-select" value={height} onChange={(event) => setHeight(Number(event.target.value))}>
              {HEIGHTS.map((value) => <option key={value} value={value}>{value} мм</option>)}
            </select>
          </label>
          <div className="cad-status">
            {loading ? 'Загрузка STEP через OCCT…' : error ? 'Ошибка' : selected ? 'Выбрано: 4 стойки' : 'ЛКМ по стойке — выбрать 4 стойки'}
          </div>
        </div>

        <div className="cad-main">
          <div className="cad-viewport" ref={viewportRef}>
            {error && <div className="cad-error">{error}</div>}
          </div>
          <aside className="cad-inspector">
            <h3>Модель</h3>
            <div className="cad-row"><span>Высота</span><b>{height} мм</b></div>
            <div className="cad-row"><span>Артикул</span><b>R5NKMN{height / 100}</b></div>
            <div className="cad-row"><span>Объект</span><b>4 стойки</b></div>
            <div className="cad-divider" />
            <h3>Размеры OCCT</h3>
            <div className="cad-stat"><span>X</span><strong>{dimension[0].toFixed(1)} мм</strong></div>
            <div className="cad-stat"><span>Y</span><strong>{dimension[1].toFixed(1)} мм</strong></div>
            <div className="cad-stat"><span>Z</span><strong>{dimension[2].toFixed(1)} мм</strong></div>
            <div className="cad-divider" />
            <p className="cad-note">ЛКМ по любой из 4 стоек выбирает всю группу стоек. Перемещение вверх, вниз и в стороны. Шаг: 1 мм.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default CadConfigurator
