import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { importSTEP } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import { setOC } from 'replicad'

type CadSceneProps = {
  width: number
  height: number
  depth: number
  railCount: number
}

type CadShape = Awaited<ReturnType<typeof importSTEP>>

let cadReady: Promise<void> | null = null

function initCad() {
  if (!cadReady) {
    cadReady = initOpenCascade().then((oc) => {
      console.log('[CAD] OpenCascade initialized')
      setOC(oc)
    })
  }
  return cadReady
}

async function loadStepModel(url: string): Promise<CadShape> {
  console.log('[CAD] Loading STEP:', url)

  const response = await fetch(url)

  console.log('[CAD] STEP response:', response.status, response.statusText)
  console.log('[CAD] STEP content-type:', response.headers.get('content-type'))

  if (!response.ok) {
    throw new Error(`STEP download failed: ${response.status} ${response.statusText}`)
  }

  const blob = await response.blob()

  console.log('[CAD] STEP size:', blob.size, 'bytes')
  console.log('[CAD] STEP type:', blob.type)

  const shape = await importSTEP(blob)

  console.log('[CAD] STEP imported:', shape)

  return shape
}

function addReplicadShape(scene: THREE.Scene, shape: CadShape, material: THREE.Material) {
  console.log('[CAD] Tessellating STEP shape')

  const mesh = shape.mesh({ tolerance: 0.5, angularTolerance: 0.2 })

  console.log('[CAD] Mesh generated:', {
    vertices: mesh.vertices.length,
    normals: mesh.normals.length,
    triangles: mesh.triangles.length,
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3))
  geometry.setIndex(Array.from(mesh.triangles))
  geometry.computeBoundingSphere()

  console.log('[CAD] Geometry bounding sphere:', geometry.boundingSphere)

  const object = new THREE.Mesh(geometry, material)
  object.scale.setScalar(0.01)
  scene.add(object)

  console.log('[CAD] STEP mesh added to Three.js scene')

  return object
}

export function CadScene({ width, height, depth, railCount }: CadSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#101010')

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(9, 8, 9)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2))
    const directional = new THREE.DirectionalLight(0xffffff, 2)
    directional.position.set(5, 10, 7)
    scene.add(directional)

    scene.add(new THREE.GridHelper(12, 24, 0x444444, 0x222222))

    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.5, roughness: 0.45 })

    initCad()
      .then(async () => {
        if (disposed) return

        const shape = await loadStepModel('/cad/Osnovnyye_elementy_korpusa_CQE_N/R5NBP02B.STEP')
        if (disposed) return

        addReplicadShape(scene, shape, frameMaterial)

        const largest = Math.max(width, height, depth) / 100
        camera.position.set(largest * 1.8, largest * 1.4, largest * 1.8)
        controls.target.set(0, 0, 0)
        controls.update()
      })
      .catch((error) => {
        console.error('Tau/Replicad STEP loading failed', error)
      })

    const resize = () => {
      const aspect = container.clientWidth / Math.max(container.clientHeight, 1)
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
          else object.material.dispose()
        }
      })
      container.removeChild(renderer.domElement)
    }
  }, [width, height, depth, railCount])

  return <div ref={containerRef} className="cad-scene" />
}
