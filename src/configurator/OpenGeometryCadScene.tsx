import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Cuboid, OpenGeometry, Vector3 } from 'opengeometry'
import wasmUrl from 'opengeometry/opengeometry_bg.wasm?url'

type OpenGeometryCadSceneProps = {
  width: number
  height: number
  depth: number
  railCount: number
}

let openGeometryReady: Promise<void> | null = null

function initOpenGeometry() {
  if (!openGeometryReady) {
    openGeometryReady = OpenGeometry.create({ wasmURL: wasmUrl }).then(() => {
      console.log('[OpenGeometry] WASM initialized')
    })
  }
  return openGeometryReady
}

export function OpenGeometryCadScene({ width, height, depth, railCount }: OpenGeometryCadSceneProps) {
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

    initOpenGeometry()
      .then(() => {
        if (disposed) return

        const cabinet = new Cuboid({
          center: new Vector3(0, 0, 0),
          width: width / 100,
          height: height / 100,
          depth: depth / 100,
          color: 0x777777,
        })

        cabinet.outline = true
        scene.add(cabinet)

        const largest = Math.max(width, height, depth) / 100
        camera.position.set(largest * 1.8, largest * 1.4, largest * 1.8)
        controls.target.set(0, 0, 0)
        controls.update()

        console.log('[OpenGeometry] Prototype created', {
          width,
          height,
          depth,
          railCount,
        })
      })
      .catch((error) => {
        console.error('[OpenGeometry] initialization failed', error)
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
