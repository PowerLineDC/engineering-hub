import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { makeBaseBox, makeCompound } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import { setOC } from 'replicad'
import replicadWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url'

type CadSceneProps = {
  width: number
  height: number
  depth: number
  railCount: number
}

type CadShape = ReturnType<typeof makeBaseBox>

let cadReady: Promise<void> | null = null

function initCad() {
  if (!cadReady) {
    cadReady = initOpenCascade({ locateFile: () => replicadWasm }).then((oc) => {
      setOC(oc)
    })
  }
  return cadReady
}

function makeCabinet(width: number, height: number, depth: number, railCount: number) {
  const wall = 2
  const back = makeBaseBox(width, height, wall)
  const left = makeBaseBox(wall, height, depth).translate([0, 0, 0])
  const right = makeBaseBox(wall, height, depth).translate([width - wall, 0, 0])
  const top = makeBaseBox(width, wall, depth).translate([0, height - wall, 0])
  const bottom = makeBaseBox(width, wall, depth)
  const plate = makeBaseBox(width - 40, height - 40, 2).translate([20, 20, depth - 35])

  const railLength = width - 80
  const railHeight = 35
  const railDepth = 7.5
  const railShapes = Array.from({ length: railCount }, (_, index) => {
    const y = 45 + index * ((height - 90 - railHeight) / Math.max(1, railCount - 1))
    return makeBaseBox(railLength, railDepth, railHeight).translate([40, y, depth - 55])
  })

  return [back, left, right, top, bottom, plate, ...railShapes]
}

function addReplicadShape(scene: THREE.Scene, shape: CadShape, material: THREE.Material) {
  const mesh = shape.mesh({ tolerance: 0.5, angularTolerance: 0.2 })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3))
  geometry.setIndex(Array.from(mesh.triangles))
  geometry.computeBoundingSphere()

  const object = new THREE.Mesh(geometry, material)
  object.rotation.x = -Math.PI / 2
  object.scale.set(0.01, 0.01, 0.01)
  scene.add(object)
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
    controls.target.set(0, 0, 2.5)

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2))
    const directional = new THREE.DirectionalLight(0xffffff, 2)
    directional.position.set(5, 10, 7)
    scene.add(directional)

    const grid = new THREE.GridHelper(12, 24, 0x444444, 0x222222)
    scene.add(grid)

    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.5, roughness: 0.45 })
    const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.35, roughness: 0.55 })
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.25 })

    initCad()
      .then(() => {
        if (disposed) return
        const shapes = makeCabinet(width, height, depth, railCount)
        shapes.forEach((shape, index) => {
          const material = index === 5 ? plateMaterial : index >= 6 ? railMaterial : frameMaterial
          addReplicadShape(scene, shape, material)
        })

        const largest = Math.max(width, height, depth) / 100
        camera.position.set(largest * 1.8, largest * 1.4, largest * 1.8)
        controls.target.set(0, height / 200, depth / 200)
      })
      .catch((error) => {
        console.error('Tau/Replicad CAD initialization failed', error)
      })

    const resize = () => {
      if (!container) return
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
