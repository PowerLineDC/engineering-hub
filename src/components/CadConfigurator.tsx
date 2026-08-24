import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
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

function CadConfigurator({ onClose }: { onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = useState<CadGeometry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material = new THREE.MeshStandardMaterial({ color: 0x9da8b2, metalness: 0.45, roughness: 0.42, side: THREE.DoubleSide })
          }
        })

        const box = new THREE.Box3().setFromObject(object)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        object.position.sub(center)
        grid.position.y = -size.y / 2
        const maxDimension = Math.max(size.x, size.y, size.z, 1)
        const distance = maxDimension * 1.65
        camera.position.set(distance, distance * 0.8, distance)
        camera.near = Math.max(maxDimension / 10000, 0.1)
        camera.far = maxDimension * 20
        camera.updateProjectionMatrix()
        controls.target.set(0, 0, 0)
        controls.update()
        scene.add(object)
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
      window.removeEventListener('resize', resize)
      controls.dispose()
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
          <div className="cad-status">{loading ? 'Загрузка OCCT-модели…' : error ? 'Ошибка' : 'Геометрия загружена'}</div>
        </div>

        <div className="cad-main">
          <div className="cad-viewport" ref={viewportRef}>{error && <div className="cad-error">{error}</div>}</div>
          <aside className="cad-inspector">
            <h3>Геометрия</h3>
            <div className="cad-stat"><span>X</span><strong>{dimension[0].toFixed(1)} мм</strong></div>
            <div className="cad-stat"><span>Y</span><strong>{dimension[1].toFixed(1)} мм</strong></div>
            <div className="cad-stat"><span>Z</span><strong>{dimension[2].toFixed(1)} мм</strong></div>
            <div className="cad-divider" />
            <div className="cad-row"><span>Корней STEP</span><b>{geometry?.roots ?? '—'}</b></div>
            <div className="cad-row"><span>Solid</span><b>{geometry?.solids ?? '—'}</b></div>
            <div className="cad-row"><span>Shell</span><b>{geometry?.shells ?? '—'}</b></div>
            <div className="cad-row"><span>Faces</span><b>{geometry?.faces ?? '—'}</b></div>
            <div className="cad-divider" />
            <p className="cad-note">Размеры и топология получены из результата OCCT. OBJ используется только для отображения геометрии в браузере.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default CadConfigurator
