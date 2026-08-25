import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import './CadConfigurator.css'

type ComponentResult = { id: string; type: string; modelUrl: string; position: [number, number, number]; size: [number, number, number] }
type RecognitionResult = { assemblyFile: string; referenceFile: string; solidCount: number; postCount: number; components: ComponentResult[]; cacheId: string }

const HEIGHTS = [1000, 1200, 1400, 1600, 1800, 2000, 2200]
const LIBRARY_ROOT = '/library/dkc/Osnovnyye_elementy_korpusa_CQE_N/R5NKMN'
const ASSEMBLY_FOR_HEIGHT: Record<number, string> = Object.fromEntries(HEIGHTS.map(h => [h, `${LIBRARY_ROOT}/R5NKMN${h / 100}.STEP`]))
const REFERENCE_FOR_HEIGHT: Record<number, string> = Object.fromEntries(HEIGHTS.map(h => [h, `${LIBRARY_ROOT}/1/R5NKMN${h / 100} (1шт).STEP`]))

type LoadModel = (height: number, first?: boolean) => Promise<void>

function CadConfiguratorV2({ onClose }: { onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const loadModelRef = useRef<LoadModel | null>(null)
  const requestedHeightRef = useRef<number | null>(null)
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
    let dragging = false
    let dragStart = new THREE.Vector2()
    let dragOrigin = new THREE.Vector3()
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
    const light = new THREE.DirectionalLight(0xffffff, 2.5)
    light.position.set(500, 1000, 700)
    scene.add(light)
    const grid = new THREE.GridHelper(4000, 40, 0x3a4652, 0x26303a)
    scene.add(grid)
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const loader = new OBJLoader()

    const dispose = (object: THREE.Object3D) => {
      object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
        child.geometry.dispose()
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose())
        else child.material.dispose()
      })
      scene.remove(object)
    }
    const clear = () => { components.forEach(dispose); components = []; selected = null; setSelectedPost(null) }
    const pointerNdc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
    }
    const findComponent = (object: THREE.Object3D) => {
      let current: THREE.Object3D | null = object
      while (current) {
        if (components.includes(current as THREE.Group)) return current as THREE.Group
        current = current.parent
      }
      return null
    }
    const select = (group: THREE.Group) => {
      components.forEach(g => g.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach(m => { m.emissive.set(0x000000); m.emissiveIntensity = 0 })
      }))
      selected = group
      const index = components.indexOf(group)
      group.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach(m => { m.emissive.set(0x334455); m.emissiveIntensity = 0.7 })
      })
      setSelectedPost(index)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || dragging) return
      pointerNdc(e)
      const hit = raycaster.intersectObjects(components, true)[0]
      if (!hit) { selected = null; setSelectedPost(null); return }
      const group = findComponent(hit.object)
      if (!group) return
      select(group)
      dragging = true
      dragStart.set(e.clientX, e.clientY)
      dragOrigin.copy(group.position)
      controls.enabled = false
      renderer.domElement.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || !selected) return
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      const distance = Math.max(camera.position.distanceTo(controls.target), 1)
      const scale = distance / Math.max(renderer.domElement.clientWidth, 1)
      if (e.shiftKey) selected.position.z = dragOrigin.z + dy * scale
      else selected.position.x = dragOrigin.x + dx * scale
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      controls.enabled = true
      if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)

    const onKeyDown = (e: KeyboardEvent) => {
      if (!selected || e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key === 'ArrowLeft') { selected.position.x -= 1; e.preventDefault() }
      else if (e.key === 'ArrowRight') { selected.position.x += 1; e.preventDefault() }
      else if (e.key === 'ArrowUp') { selected.position.z -= 1; e.preventDefault() }
      else if (e.key === 'ArrowDown') { selected.position.z += 1; e.preventDefault() }
    }
    window.addEventListener('keydown', onKeyDown)

    const loadModel: LoadModel = async (selectedHeight, firstLoad = false) => {
      requestedHeightRef.current = selectedHeight
      setLoading(true); setError(null); clear()
      try {
        const response = await fetch(`/api/cad/recognize?assembly=${encodeURIComponent(ASSEMBLY_FOR_HEIGHT[selectedHeight])}&reference=${encodeURIComponent(REFERENCE_FOR_HEIGHT[selectedHeight])}`)
        const data = await response.json() as RecognitionResult & { error?: string; details?: string }
        if (!response.ok || data.error) throw new Error(data.details ? `${data.error}: ${data.details}` : data.error || `OCCT recognition error: ${response.status}`)
        if (cancelled) return
        const posts = data.components.filter(c => c.type === 'post')
        if (!posts.length) throw new Error(`OCCT не распознал стойки: solidCount=${data.solidCount}, postCount=${data.postCount}`)
        const loaded: THREE.Group[] = []
        for (const component of posts) {
          const object = await loader.loadAsync(component.modelUrl)
          if (cancelled) { dispose(object); return }
          object.position.set(0, 0, 0)
          object.traverse(child => {
            if (!(child instanceof THREE.Mesh)) return
            child.material = new THREE.MeshStandardMaterial({ color: 0x9da8b2, metalness: 0.45, roughness: 0.42, side: THREE.DoubleSide })
          })
          const group = new THREE.Group()
          group.name = component.id
          group.userData.occtId = component.id
          group.userData.partType = component.type
          group.userData.article = `R5NKMN${selectedHeight / 100}`
          group.userData.occtPosition = component.position
          group.userData.size = component.size
          group.add(object)
          group.position.set(component.position[0], component.position[1], component.position[2])
          scene.add(group)
          loaded.push(group)
        }
        components = loaded
        setRecognition(data)
        const box = new THREE.Box3()
        components.forEach(g => box.expandByObject(g))
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        grid.position.y = box.min.y
        if (firstLoad) {
          const max = Math.max(size.x, size.y, size.z, 1)
          const distance = max * 1.8
          camera.position.set(center.x + distance, center.y + distance * 0.8, center.z + distance)
          camera.near = Math.max(max / 10000, 0.1); camera.far = max * 20; camera.updateProjectionMatrix()
          controls.target.copy(center); controls.update()
        }
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось распознать STEP-сборку через OCCT') }
      finally { if (!cancelled) setLoading(false) }
    }
    loadModelRef.current = loadModel
    void loadModel(2000, true)
    const resize = () => { const w = viewport.clientWidth; const h = viewport.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix() }
    resize(); window.addEventListener('resize', resize)
    const animate = () => { animationFrame = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera) }
    animate()
    return () => { cancelled = true; loadModelRef.current = null; cancelAnimationFrame(animationFrame); renderer.domElement.removeEventListener('pointerdown', onPointerDown); renderer.domElement.removeEventListener('pointermove', onPointerMove); renderer.domElement.removeEventListener('pointerup', onPointerUp); renderer.domElement.removeEventListener('pointercancel', onPointerUp); window.removeEventListener('resize', resize); window.removeEventListener('keydown', onKeyDown); clear(); controls.dispose(); renderer.dispose(); if (renderer.domElement.parentNode === viewport) viewport.removeChild(renderer.domElement) }
  }, [])

  useEffect(() => { if (requestedHeightRef.current !== height) void loadModelRef.current?.(height) }, [height])

  return <div className="cad-overlay"><div className="cad-shell"><header className="cad-header"><div><div className="cad-kicker">OCCT CAD CORE</div><h2>Конфигуратор НКУ</h2><div className="cad-file">DKC · OCCT recognition · R5NKMN{height / 100}.STEP</div></div><button className="cad-close" onClick={onClose}>✕</button></header><div className="cad-toolbar"><label htmlFor="cad-height-select">Высота<select id="cad-height-select" value={height} onChange={e => setHeight(Number(e.target.value))}>{HEIGHTS.map(v => <option key={v} value={v}>{v} мм</option>)}</select></label><div className="cad-status">{loading ? 'OCCT распознаёт STEP-сборку…' : error ? 'Ошибка' : selectedPost === null ? `OCCT: ${recognition?.postCount ?? 0} независимых стоек` : `Выбрана стойка ${selectedPost + 1} · стрелки: 1 мм`}</div></div><div className="cad-main"><div className="cad-viewport" ref={viewportRef}>{error && <div className="cad-error">{error}</div>}</div><aside className="cad-inspector"><h3>OCCT распознавание</h3><div className="cad-row"><span>Солидов</span><b>{recognition?.solidCount ?? '—'}</b></div><div className="cad-row"><span>Стойки</span><b>{recognition?.postCount ?? '—'}</b></div><div className="cad-row"><span>Компонентов</span><b>{recognition?.components.length ?? '—'}</b></div><div className="cad-row"><span>Выбрана</span><b>{selectedPost === null ? '—' : `№${selectedPost + 1}`}</b></div><div className="cad-divider" /><h3>Перемещение</h3><p className="cad-note">Каждая post-* — отдельная сущность, распознанная OCCT. Используется её собственная геометрия и координаты из результата распознавания. ЛКМ перемещает только выбранную стойку; Shift + ЛКМ — по Z; стрелки — 1 мм.</p></aside></div></div></div>
}

export default CadConfiguratorV2
