import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import './CadConfigurator.css'

type ComponentInfo = {
  id: string
  type: 'post' | 'other'
  modelUrl: string
  size: [number, number, number]
  volume: number
}

type RecognitionResult = {
  assemblyFile: string
  referenceFile: string
  solidCount: number
  postCount: number
  components: ComponentInfo[]
  cacheId: string
}

const HEIGHTS = [1000, 1200, 1400, 1600, 1800, 2000, 2200]
const LIBRARY_ROOT = '/library/dkc/Osnovnyye_elementy_korpusa_CQE_N/R5NKMN'
const REFERENCE_ROOT = `${LIBRARY_ROOT}/1`
const STEP_FOR_HEIGHT: Record<number, string> = Object.fromEntries(
  HEIGHTS.map((height) => [height, `${LIBRARY_ROOT}/R5NKMN${height / 100}.STEP`]),
)
const POST_FOR_HEIGHT: Record<number, string> = Object.fromEntries(
  HEIGHTS.map((height) => [height, `${REFERENCE_ROOT}/R5NKMN${height / 100} (1шт).step`]),
)

function CadConfigurator({ onClose }: { onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const loadModelRef = useRef<((height: number, firstLoad?: boolean) => Promise<void>) | null>(null)
  const [height, setHeight] = useState(2000)
  const [recognition, setRecognition] = useState<RecognitionResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(false)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let cancelled = false
    let assemblyRoot: THREE.Group | null = null
    let postsGroup: THREE.Group | null = null
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
      if (!postsGroup) return
      transform.attach(postsGroup)
      setSelected(true)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || transform.dragging || !postsGroup) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObject(postsGroup, true)
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
        const assemblyUrl = STEP_FOR_HEIGHT[selectedHeight]
        const referenceUrl = POST_FOR_HEIGHT[selectedHeight]
        const response = await fetch(`/api/cad/recognize?assembly=${encodeURIComponent(assemblyUrl)}&reference=${encodeURIComponent(referenceUrl)}`)
        const data = await response.json() as RecognitionResult & { error?: string; details?: string }
        if (!response.ok || data.error) {
          throw new Error(data.details ? `${data.error}: ${data.details}` : data.error || `CAD server error: ${response.status}`)
        }
        if (cancelled) return

        const root = new THREE.Group()
        root.name = `R5NKMN_${selectedHeight}_ASSEMBLY`
        const posts = new THREE.Group()
        posts.name = 'R5NKMN_FOUR_POSTS'
        posts.userData.partType = 'four-posts'
        posts.userData.height = selectedHeight
        posts.userData.manufacturer = 'DKC'
        posts.userData.article = `R5NKMN${selectedHeight / 100}`

        const loader = new OBJLoader()
        for (const component of data.components) {
          const object = await loader.loadAsync(component.modelUrl)
          object.name = component.id
          object.userData.partType = component.type
          object.userData.componentId = component.id
          object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return
            child.material = new THREE.MeshStandardMaterial({
              color: component.type === 'post' ? 0xb7c0c8 : 0x89949f,
              metalness: 0.45,
              roughness: 0.42,
              side: THREE.DoubleSide,
            })
          })
          if (component.type === 'post') posts.add(object)
          else root.add(object)
        }

        root.add(posts)
        scene.add(root)
        const box = new THREE.Box3().setFromObject(root)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        root.position.sub(center)
        grid.position.y = -size.y / 2

        if (assemblyRoot) disposeObject(assemblyRoot)
        assemblyRoot = root
        postsGroup = posts
        setRecognition(data)

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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось распознать STEP-сборку')
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
      if (assemblyRoot) disposeObject(assemblyRoot)
      renderer.dispose()
      if (renderer.domElement.parentNode === viewport) viewport.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => {
    if (height === 2000) return
    void loadModelRef.current?.(height)
  }, [height])

  return (
    <div className="cad-overlay">
      <div className="cad-shell">
        <header className="cad-header">
          <div>
            <div className="cad-kicker">OCCT CAD CORE</div>
            <h2>Конфигуратор НКУ</h2>
            <div className="cad-file">DKC · распознавание стоек · R5NKMN{height / 100}.STEP</div>
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
            {loading ? 'OCCT распознаёт стойки…' : error ? 'Ошибка' : selected ? `Выбрано стоек: ${recognition?.postCount ?? 0}` : `Распознано стоек: ${recognition?.postCount ?? 0} · ЛКМ по стойке`}
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
            <div className="cad-row"><span>Solid в STEP</span><b>{recognition?.solidCount ?? '—'}</b></div>
            <div className="cad-row"><span>Распознано стоек</span><b>{recognition?.postCount ?? '—'}</b></div>
            <div className="cad-divider" />
            <h3>Управление</h3>
            <p className="cad-note">ЛКМ по любой стойке выбирает все распознанные стойки как одну группу. Перемещение по X/Y/Z с шагом 1 мм. Взаимное расстояние между стойками сохраняется.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default CadConfigurator
