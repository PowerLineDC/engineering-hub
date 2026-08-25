import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import './CadConfigurator.css'

type ComponentResult = {
  id: string
  type: string
  modelUrl: string
  position: [number, number, number]
  size: [number, number, number]
}

type RecognitionResult = {
  assemblyFile: string
  referenceFile: string
  solidCount: number
  postCount: number
  components: ComponentResult[]
  cacheId: string
}

const HEIGHTS = [1000, 1200, 1400, 1600, 1800, 2000, 2200]
const LIBRARY_ROOT = '/library/dkc/Osnovnyye_elementy_korpusa_CQE_N/R5NKMN'
const ASSEMBLY_FOR_HEIGHT: Record<number, string> = Object.fromEntries(
  HEIGHTS.map((height) => [height, `${LIBRARY_ROOT}/R5NKMN${height / 100}.STEP`]),
)
const REFERENCE_FOR_HEIGHT: Record<number, string> = Object.fromEntries(
  HEIGHTS.map((height) => [height, `${LIBRARY_ROOT}/1/R5NKMN${height / 100} (1шт).STEP`]),
)

type LoadModel = (selectedHeight: number, firstLoad?: boolean) => Promise<void>

function CadConfiguratorV2({ onClose }: { onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const loadModelRef = useRef<LoadModel | null>(null)
  const lastRequestedHeightRef = useRef<number | null>(null)
  const [height, setHeight] = useState(2000)
  const [recognition, setRecognition] = useState<RecognitionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPost, setSelectedPost] = useState<number | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let cancelled = false
    let components: THREE.Group[] = []
    let selected: THREE.Group | null = null
    let animationFrame = 0
    let dragging = false
    let dragAxis: 'x' | 'z' | null = null
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const dragPlane = new THREE.Plane()
    const dragPoint = new THREE.Vector3()
    const dragOffset = new THREE.Vector3()

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

    const disposeObject = (object: THREE.Object3D) => {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.geometry.dispose()
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose())
        else child.material.dispose()
      })
      scene.remove(object)
    }

    const clearComponents = () => {
      components.forEach(disposeObject)
      components = []
      selected = null
      setSelectedPost(null)
    }

    const setSelection = (index: number | null) => {
      components.forEach((component, componentIndex) => {
        component.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return
          const material = child.material
          if (Array.isArray(material)) return
          material.emissive.set(componentIndex === index ? 0x334455 : 0x000000)
          material.emissiveIntensity = componentIndex === index ? 0.7 : 0
        })
      })
      selected = index === null ? null : components[index]
      setSelectedPost(index)
    }

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || dragging || components.length === 0) return
      updatePointer(event)
      const hit = raycaster.intersectObjects(components, true)[0]
      if (!hit) {
        setSelection(null)
        return
      }

      let component: THREE.Object3D | null = hit.object
      while (component.parent && !components.includes(component as THREE.Group)) component = component.parent
      const index = components.indexOf(component as THREE.Group)
      if (index < 0) return
      setSelection(index)

      dragging = true
      dragAxis = event.shiftKey ? 'z' : 'x'
      const worldPosition = components[index].getWorldPosition(new THREE.Vector3())
      const normal = dragAxis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)
      dragPlane.setFromNormalAndCoplanarPoint(normal, worldPosition)
      if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) dragOffset.copy(worldPosition).sub(dragPoint)
      else dragOffset.set(0, 0, 0)
      controls.enabled = false
      renderer.domElement.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || !selected) return
      updatePointer(event)
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return
      const target = dragPoint.clone().add(dragOffset)
      if (dragAxis === 'x') selected.position.x = Math.round(target.x)
      else selected.position.z = Math.round(target.z)
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
      if (!selected || event.ctrlKey || event.altKey || event.metaKey) return
      switch (event.key) {
        case 'ArrowLeft': selected.position.x -= 1; event.preventDefault(); break
        case 'ArrowRight': selected.position.x += 1; event.preventDefault(); break
        case 'ArrowUp': selected.position.z -= 1; event.preventDefault(); break
        case 'ArrowDown': selected.position.z += 1; event.preventDefault(); break
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const loadModel: LoadModel = async (selectedHeight, firstLoad = false) => {
      lastRequestedHeightRef.current = selectedHeight
      setLoading(true)
      setError(null)
      clearComponents()

      try {
        const assemblyUrl = ASSEMBLY_FOR_HEIGHT[selectedHeight]
        const referenceUrl = REFERENCE_FOR_HEIGHT[selectedHeight]
        const response = await fetch(`/api/cad/recognize?assembly=${encodeURIComponent(assemblyUrl)}&reference=${encodeURIComponent(referenceUrl)}`)
        const data = await response.json() as RecognitionResult & { error?: string; details?: string }
        if (!response.ok || data.error) throw new Error(data.details ? `${data.error}: ${data.details}` : data.error || `OCCT recognition error: ${response.status}`)
        if (cancelled) return

        const postComponents = data.components.filter(component => component.type === 'post')
        if (postComponents.length === 0) throw new Error('OCCT не распознал ни одной стойки в сборке')

        const loader = new OBJLoader()
        const loadedGroups: THREE.Group[] = []
        for (const component of postComponents) {
          const object = await loader.loadAsync(component.modelUrl)
          if (cancelled) {
            disposeObject(object)
            return
          }

          const box = new THREE.Box3().setFromObject(object)
          const center = box.getCenter(new THREE.Vector3())
          object.position.sub(center)
          object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return
            child.material = new THREE.MeshStandardMaterial({
              color: 0x9da8b2,
              metalness: 0.45,
              roughness: 0.42,
              side: THREE.DoubleSide,
            })
          })

          const componentGroup = new THREE.Group()
          componentGroup.name = component.id
          componentGroup.userData.partType = component.type
          componentGroup.userData.occtId = component.id
          componentGroup.userData.article = `R5NKMN${selectedHeight / 100}`
          componentGroup.userData.size = component.size
          componentGroup.add(object)

          const [minX, minY, minZ] = component.position
          const [sx, sy, sz] = component.size
          componentGroup.position.set(minX + sx / 2, minY + sy / 2, minZ + sz / 2)
          scene.add(componentGroup)
          loadedGroups.push(componentGroup)
        }

        components = loadedGroups
        setRecognition(data)
        grid.position.y = 0

        if (firstLoad) {
          const allBox = new THREE.Box3()
          components.forEach(component => allBox.expandByObject(component))
          const size = allBox.getSize(new THREE.Vector3())
          const center = allBox.getCenter(new THREE.Vector3())
          const maxDimension = Math.max(size.x, size.y, size.z, 1)
          const distance = maxDimension * 1.8
          camera.position.set(center.x + distance, center.y + distance * 0.8, center.z + distance)
          camera.near = Math.max(maxDimension / 10000, 0.1)
          camera.far = maxDimension * 20
          camera.updateProjectionMatrix()
          controls.target.copy(center)
          controls.update()
          grid.position.y = allBox.min.y
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось распознать STEP-сборку через OCCT')
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
      clearComponents()
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === viewport) viewport.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => {
    if (lastRequestedHeightRef.current === height) return
    void loadModelRef.current?.(height)
  }, [height])

  return (
    <div className="cad-overlay">
      <div className="cad-shell">
        <header className="cad-header">
          <div>
            <div className="cad-kicker">OCCT CAD CORE</div>
            <h2>Конфигуратор НКУ</h2>
            <div className="cad-file">DKC · OCCT recognition · R5NKMN{height / 100}.STEP</div>
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
            {loading ? 'OCCT распознаёт STEP-сборку…' : error ? 'Ошибка' : selectedPost === null ? `OCCT: ${recognition?.postCount ?? 0} стоек распознано · ЛКМ для выбора` : `Выбрана стойка ${selectedPost + 1} · стрелки: 1 мм`}
          </div>
        </div>

        <div className="cad-main">
          <div className="cad-viewport" ref={viewportRef}>{error && <div className="cad-error">{error}</div>}</div>
          <aside className="cad-inspector">
            <h3>OCCT распознавание</h3>
            <div className="cad-row"><span>Солидов</span><b>{recognition?.solidCount ?? '—'}</b></div>
            <div className="cad-row"><span>Стойки</span><b>{recognition?.postCount ?? '—'}</b></div>
            <div className="cad-row"><span>Компонентов</span><b>{recognition?.components.length ?? '—'}</b></div>
            <div className="cad-row"><span>Выбрана</span><b>{selectedPost === null ? '—' : `№${selectedPost + 1}`}</b></div>
            <div className="cad-divider" />
            <h3>Перемещение</h3>
            <p className="cad-note">Теперь конфигуратор использует компоненты, которые реально вернул OCCT. Каждая распознанная стойка загружается как отдельная сущность. ЛКМ перемещает выбранную стойку по X; Shift + ЛКМ — по Z. Стрелки — 1 мм. Расстояния между компонентами не фиксируются.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default CadConfiguratorV2
