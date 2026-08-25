import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import './CadConfigurator.css'

type CadGeometry = {
  boundingBox: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] }
  roots: number
  transferred: number
  solids: number
  shells: number
  faces: number
  volume: number
  modelUrl: string
  stepUrl: string
}

const HEIGHTS = [1000, 1200, 1400, 1600, 1800, 2000, 2200]
const LIBRARY_ROOT = '/library/dkc/Osnovnyye_elementy_korpusa_CQE_N/R5NKMN'
const STEP_FOR_HEIGHT: Record<number, string> = Object.fromEntries(
  HEIGHTS.map((height) => [height, `${LIBRARY_ROOT}/R5NKMN${height / 100}.STEP`]),
)

type LoadModel = (selectedHeight: number, firstLoad?: boolean) => Promise<void>

function CadConfiguratorV2({ onClose }: { onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const loadModelRef = useRef<LoadModel | null>(null)
  const lastRequestedHeightRef = useRef<number | null>(null)
  const [height, setHeight] = useState(2000)
  const [geometry, setGeometry] = useState<CadGeometry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPost, setSelectedPost] = useState<number | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let cancelled = false
    let posts: THREE.Group[] = []
    let selectedPost: THREE.Group | null = null
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
    const dragPlane = new THREE.Plane()
    const dragOffset = new THREE.Vector3()
    const dragPoint = new THREE.Vector3()
    let dragging = false
    let dragAxis: 'x' | 'z' | null = null

    const disposePost = (post: THREE.Object3D) => {
      post.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.geometry.dispose()
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose())
        else child.material.dispose()
      })
      scene.remove(post)
    }

    const clearPosts = () => {
      posts.forEach(disposePost)
      posts = []
      selectedPost = null
      setSelectedPost(null)
    }

    const updateSelection = (index: number | null) => {
      posts.forEach((post, postIndex) => {
        post.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return
          const material = child.material
          if (Array.isArray(material)) return
          material.emissive.set(postIndex === index ? 0x334455 : 0x000000)
          material.emissiveIntensity = postIndex === index ? 0.7 : 0
        })
      })
      selectedPost = index === null ? null : posts[index]
      setSelectedPost(index)
    }

    const getPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || dragging || posts.length === 0) return
      getPointer(event)
      const hits = raycaster.intersectObjects(posts, true)
      const hit = hits[0]

      if (!hit) {
        updateSelection(null)
        return
      }

      let post: THREE.Object3D | null = hit.object
      while (post.parent && !posts.includes(post as THREE.Group)) {
        post = post.parent
      }
      const index = posts.indexOf(post as THREE.Group)
      if (index < 0) return

      updateSelection(index)

      // Drag only the selected post. It is intentionally not a child of a common
      // transform group, so moving it cannot change the other three posts.
      dragging = true
      dragAxis = event.shiftKey ? 'z' : 'x'
      const postPosition = posts[index].getWorldPosition(new THREE.Vector3())
      const cameraDirection = new THREE.Vector3()
      camera.getWorldDirection(cameraDirection)

      if (dragAxis === 'x') {
        dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), postPosition)
      } else {
        dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(1, 0, 0), postPosition)
      }

      if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        dragOffset.copy(postPosition).sub(dragPoint)
      } else {
        dragOffset.set(0, 0, 0)
      }

      controls.enabled = false
      renderer.domElement.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || !selectedPost) return
      getPointer(event)
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return

      const target = dragPoint.clone().add(dragOffset)
      if (dragAxis === 'x') {
        selectedPost.position.x = Math.round(target.x)
      } else {
        selectedPost.position.z = Math.round(target.z)
      }
    }

    const stopDragging = (event: PointerEvent) => {
      if (!dragging) return
      dragging = false
      dragAxis = null
      controls.enabled = true
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', stopDragging)
    renderer.domElement.addEventListener('pointercancel', stopDragging)

    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedPost || event.ctrlKey || event.altKey || event.metaKey) return
      switch (event.key) {
        case 'ArrowLeft':
          selectedPost.position.x -= 1
          event.preventDefault()
          break
        case 'ArrowRight':
          selectedPost.position.x += 1
          event.preventDefault()
          break
        case 'ArrowUp':
          selectedPost.position.z -= 1
          event.preventDefault()
          break
        case 'ArrowDown':
          selectedPost.position.z += 1
          event.preventDefault()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const loadModel: LoadModel = async (selectedHeight, firstLoad = false) => {
      lastRequestedHeightRef.current = selectedHeight
      setLoading(true)
      setError(null)
      clearPosts()

      try {
        const stepUrl = STEP_FOR_HEIGHT[selectedHeight]
        const response = await fetch(`/api/cad/load?step=${encodeURIComponent(stepUrl)}`)
        const data = await response.json() as CadGeometry & { error?: string; details?: string }
        if (!response.ok || data.error) {
          throw new Error(data.details ? `${data.error}: ${data.details}` : data.error || `CAD server error: ${response.status}`)
        }

        const source = await new OBJLoader().loadAsync(data.modelUrl)
        if (cancelled) {
          disposePost(source)
          return
        }

        const box = new THREE.Box3().setFromObject(source)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        source.position.sub(center)
        source.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return
          child.material = new THREE.MeshStandardMaterial({
            color: 0x9da8b2,
            metalness: 0.45,
            roughness: 0.42,
            side: THREE.DoubleSide,
          })
        })

        // The loaded STEP/OBJ is one verified DKC reference post. Clone the
        // geometry into four independent top-level groups. No common parent
        // controls their transforms.
        const spacingX = Math.max(size.x * 4, 500)
        const spacingZ = Math.max(size.z * 4, 300)
        const positions: [number, number, number][] = [
          [-spacingX / 2, 0, -spacingZ / 2],
          [ spacingX / 2, 0, -spacingZ / 2],
          [-spacingX / 2, 0,  spacingZ / 2],
          [ spacingX / 2, 0,  spacingZ / 2],
        ]

        for (let index = 0; index < positions.length; index += 1) {
          const post = source.clone(true) as THREE.Group
          post.name = `DKC_REFERENCE_POST_${index + 1}`
          post.userData.partType = 'post'
          post.userData.index = index + 1
          post.userData.height = selectedHeight
          post.userData.manufacturer = 'DKC'
          post.userData.article = `R5NKMN${selectedHeight / 100}`
          post.position.set(...positions[index])
          scene.add(post)
          posts.push(post)
        }

        // The source is only a template. It is not added to the scene.
        source.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return
          child.geometry.dispose()
          if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose())
          else child.material.dispose()
        })

        grid.position.y = -size.y / 2
        setGeometry(data)

        if (firstLoad) {
          const maxDimension = Math.max(size.x, size.y, size.z, spacingX, spacingZ, 1)
          const distance = maxDimension * 1.8
          camera.position.set(distance, distance * 0.8, distance)
          camera.near = Math.max(maxDimension / 10000, 0.1)
          camera.far = maxDimension * 20
          camera.updateProjectionMatrix()
          controls.target.set(0, 0, 0)
          controls.update()
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить CAD-модель')
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
      renderer.domElement.removeEventListener('pointerup', stopDragging)
      renderer.domElement.removeEventListener('pointercancel', stopDragging)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onKeyDown)
      clearPosts()
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === viewport) viewport.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => {
    if (lastRequestedHeightRef.current === height) return
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
            <div className="cad-file">DKC · R5NKMN{height / 100}.STEP · 4 независимые стойки</div>
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
            {loading ? 'Загрузка STEP через OCCT…' : error ? 'Ошибка' : selectedPost === null ? 'ЛКМ по стойке для выбора' : `Выбрана стойка ${selectedPost + 1} · стрелки: 1 мм`}
          </div>
        </div>

        <div className="cad-main">
          <div className="cad-viewport" ref={viewportRef}>{error && <div className="cad-error">{error}</div>}</div>
          <aside className="cad-inspector">
            <h3>Модель</h3>
            <div className="cad-row"><span>Высота</span><b>{height} мм</b></div>
            <div className="cad-row"><span>Файл</span><b>R5NKMN{height / 100}.STEP</b></div>
            <div className="cad-row"><span>Стойки</span><b>4</b></div>
            <div className="cad-row"><span>Выбрана</span><b>{selectedPost === null ? '—' : `№${selectedPost + 1}`}</b></div>
            <div className="cad-divider" />
            <h3>Размеры OCCT</h3>
            <div className="cad-stat"><span>X</span><strong>{dimension[0].toFixed(1)} мм</strong></div>
            <div className="cad-stat"><span>Y</span><strong>{dimension[1].toFixed(1)} мм</strong></div>
            <div className="cad-stat"><span>Z</span><strong>{dimension[2].toFixed(1)} мм</strong></div>
            <div className="cad-divider" />
            <p className="cad-note">ЛКМ по стойке выбирает только её. Зажатая ЛКМ перемещает выбранную стойку по X; Shift + ЛКМ — по Z. Стрелки перемещают выбранную стойку на 1 мм. Связи между стойками отсутствуют.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default CadConfiguratorV2
