import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'

type CadSceneProps = {
  width: number
  height: number
  depth: number
  railCount: number
}

const MODEL_URL = '/library/dkc/каркас корпуса/R5CQEN1464A.obj'

export function CadScene({ width, height, depth, railCount }: CadSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#101010')

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000)
    camera.position.set(3000, 2500, 3000)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2))
    const directional = new THREE.DirectionalLight(0xffffff, 2)
    directional.position.set(5000, 8000, 7000)
    scene.add(directional)
    scene.add(new THREE.GridHelper(6000, 60, 0x444444, 0x222222))

    const material = new THREE.MeshStandardMaterial({
      color: 0x777777,
      metalness: 0.5,
      roughness: 0.45,
    })

    const loader = new OBJLoader()
    loader.load(
      MODEL_URL,
      (object) => {
        if (disposed) return

        object.traverse((child) => {
          if (child instanceof THREE.Mesh) child.material = material
        })

        const box = new THREE.Box3().setFromObject(object)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxSize = Math.max(size.x, size.y, size.z)
        const distance = maxSize * 1.8

        object.position.sub(center)
        scene.add(object)

        camera.position.set(distance, distance * 0.8, distance)
        camera.near = Math.max(maxSize / 10000, 0.01)
        camera.far = maxSize * 20
        camera.updateProjectionMatrix()
        controls.target.set(0, 0, 0)
        controls.update()

        console.log('[CAD] OCCT OBJ loaded:', {
          url: MODEL_URL,
          width: size.x,
          height: size.y,
          depth: size.z,
        })
      },
      undefined,
      (error) => console.error('[CAD] OCCT OBJ loading failed:', error),
    )

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
      material.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={containerRef} className="cad-scene" />
}
