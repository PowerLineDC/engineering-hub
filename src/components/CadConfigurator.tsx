import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import './CadConfigurator.css'

type CadLoadResult = {
  modelUrl: string
  boundingBox?: { size: [number, number, number] }
  volume?: number
  id?: string
  stepUrl?: string
}

const HEIGHTS = [1000, 1200, 1400, 1600, 1800, 2000, 2200]
const REFERENCE_ROOT = '/library/dkc/Osnovnyye_elementy_korpusa_CQE_N/R5NKMN/1'
const POST_FOR_HEIGHT: Record<number, string> = Object.fromEntries(
  HEIGHTS.map((height) => [height, `${REFERENCE_ROOT}/R5NKMN${height / 100} (1шт).STEP`]),
)

function CadConfigurator({ onClose }: { onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const loadModelRef = useRef<((height: number, firstLoad?: boolean) => Promise<void>) | null>(null)
  const [height, setHeight] = useState(2000)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPost, setSelectedPost] = useState<number | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let cancelled = false
    let postsRoot: THREE.Group | null = null
    let selectedObject: THREE.Object3D | null = null
    let dragPlane: THREE.Plane | null = null
    let dragOffset = new THREE.Vector3()
    let draggingPost = false
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

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const dragPoint = new THREE.Vector3()
    const groundNormal = new THREE.Vector3(0, 1, 0)

    const disposeObject = (object: THREE.Object3D) => {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.geometry.dispose()
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose())
        else child.material.dispose()
      })
      scene.remove(object)
    }

    const getPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }

    const selectPost = (post: THREE.Object3D, index: number) => {
      selectedObject = post
      setSelectedPost(index)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !postsRoot) return

      getPointer(event)
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(postsRoot.children, true)
      const hit = hits[0]

      if (!hit) {
        selectedObject = null
        draggingPost = false
        setSelectedPost(null)
        return
      }

      let post: THREE.Object3D | null = hit.object
      while (post.parent && post.parent !== postsRoot) post = post.parent
      if (post.parent !== postsRoot) return

      const index = postsRoot.children.indexOf(post)
      if (index < 0) return

      selectPost(post, index)

      const box = new THREE.Box3().setFromObject(post)
      const center = box.getCenter(new THREE.Vector3())
      const planeY = box.min.y
      dragPlane = new THREE.Plane(groundNormal, -planeY)

      raycaster.ray.intersectPlane(dragPlane, dragPoint)
      dragOffset.copy(center).sub(dragPoint)
      draggingPost = true
      controls.enabled = false
      renderer.domElement.setPointerCapture(event.pointerId)
      event.preventDefault()
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!draggingPost || !selectedObject || !dragPlane) return

      getPointer(event)
      raycaster.setFromCamera(pointer, camera)
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return

      const target = dragPoint.clone().add(dragOffset)
      const currentWorld = new THREE.Vector3()
      selectedObject.getWorldPosition(currentWorld)
      const delta = target.sub(currentWorld)
      selectedObject.position.x += delta.x
      selectedObject.position.z += delta.z
      event.preventDefault()
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!draggingPost) return
      draggingPost = false
      dragPlane = null
      controls.enabled = true
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId)
      }
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)

    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedObject || event.ctrlKey || event.altKey || event.metaKey) return

      let handled = true
      switch (event.key) {
        case 'ArrowLeft':
          selectedObject.position.x -= 1
          break
        case 'ArrowRight':
          selectedObject.position.x += 1
          break
        case 'ArrowUp':
          selectedObject.position.z -= 1
          break
        case 'ArrowDown':
          selectedObject.position.z += 1
          break
        default:
          handled = false
      }

      if (handled) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)

    const loadModel = async (selectedHeight: number, firstLoad = false) => {
      setLoading(true)
      setError(null)
      selectedObject = null
      draggingPost = false
      setSelectedPost(null)

      try {
        const referenceUrl = POST_FOR_HEIGHT[selectedHeight]
        const response = await fetch(`/api/cad/load?step=${encodeURIComponent(referenceUrl)}`)
        const data = await response.json() as CadLoadResult & { error?: string }
        if (!response.ok || data.error) {
          throw new Error(data.error || `CAD server error: ${response.status}`)
        }
        if (cancelled) return

        const loader = new OBJLoader()
        const source = await loader.loadAsync(data.modelUrl)
        if (cancelled) return

        const sourceBox = new THREE.Box3().setFromObject(source)
        const sourceCenter = sourceBox.getCenter(new THREE.Vector3())
        const sourceSize = sourceBox.getSize(new THREE.Vector3())
        source.position.sub(sourceCenter)

        const root = new THREE.Group()
        root.name = `R5NKMN_${selectedHeight}_REFERENCE_POSTS`
        root.userData.partType = 'four-posts'
        root.userData.height = selectedHeight
        root.userData.manufacturer = 'DKC'
        root.userData.article = `R5NKMN${selectedHeight / 100}`

        const spacingX = Math.max(sourceSize.x * 4, 500)
        const spacingZ = Math.max(sourceSize.z * 4, 300)
        const positions: [number, number, number][] = [
          [-spacingX / 2, 0, -spacingZ / 2],
          [spacingX / 2, 0, -spacingZ / 2],
          [-spacingX / 2, 0, spacingZ / 2],
          [spacingX / 2, 0, spacingZ / 2],
        ]

        positions.forEach(([x, y, z], index) => {
          const post = new THREE.Group()
          post.name = `REFERENCE_POST_${index + 1}`
          post.userData.partType = 'post'
          post.userData.index = index + 1
          post.userData.height = selectedHeight
          post.userData.manufacturer = 'DKC'
          post.userData.article = `R5NKMN${selectedHeight / 100}`
          post.position.set(x, y, z)

          const model = source.clone(true)
          model.position.set(0, 0, 0)
          model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return
            child.material = new THREE.MeshStandardMaterial({
              color: 0xb7c0c8,
              metalness: 0.45,
              roughness: 0.42,
              side: THREE.DoubleSide,
            })
          })
          post.add(model)
          root.add(post)
        })

        if (postsRoot) disposeObject(postsRoot)
        scene.add(root)
        postsRoot = root
        grid.position.y = -sourceSize.y / 2

        if (firstLoad) {
          const maxDimension = Math.max(sourceSize.y, spacingX, spacingZ, 1)
          const distance = maxDimension * 2.2
          camera.position.set(distance, distance * 0.8, distance)
          camera.near = Math.max(maxDimension / 10000, 0.1)
          camera.far = maxDimension * 20
          camera.updateProjectionMatrix()
          controls.target.set(0, 0, 0)
          controls.update()
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить проверенную модель стойки')
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
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onKeyDown)
      controls.dispose()
      if (postsRoot) disposeObject(postsRoot)
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
            <div className="cad-file">DKC · проверенная модель стойки · R5NKMN{height / 100} (1шт).STEP</div>
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
            {loading ? 'OCCT загружает проверенную стойку…' : error ? 'Ошибка' : selectedPost === null ? 'ЛКМ по стойке для выбора и перемещения' : `Выбрана стойка ${selectedPost + 1} · стрелки: 1 мм`}
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
            <div className="cad-row"><span>Стойки</span><b>4</b></div>
            <div className="cad-row"><span>Источник</span><b>OCCT reference</b></div>
            <div className="cad-divider" />
            <h3>Перемещение</h3>
            <p className="cad-note">ЛКМ по стойке выбирает её и позволяет перетаскивать только выбранную стойку по рабочей плоскости. Стрелки перемещают выбранную стойку на 1 мм по X/Z. Между стойками нет связи.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default CadConfigurator
