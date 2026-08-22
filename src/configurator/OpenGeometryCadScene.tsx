import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

type OpenGeometryCadSceneProps = {
  width: number
  height: number
  depth: number
  railCount: number
  plinthHeight: number
}

type CadSceneTemplate = { scene: THREE.Group }

const LIBRARY_ROOT = '/library/dkc/Osnovnyye_elementy_korpusa_CQE_N/Osnovnie_elementi_korpusa_CQE%20N'
const FRAME_ROOT = `${LIBRARY_ROOT}/R5NKMN`
const ROOF_ROOT = `${LIBRARY_ROOT}/R5NKTB`
const REAR_ROOT = `${LIBRARY_ROOT}/R5NCRE`
const DOOR_ROOT = `${LIBRARY_ROOT}/R5NCPE_R5NCPTE/%D0%94%D0%B2%D0%B5%D1%80%D0%B8%20%D0%B4%D0%BB%D1%8F%20%D0%BA%D0%BE%D1%80%D0%BF%D1%83%D1%81%D0%BE%D0%B2%20CQE%20N/%D0%94%D0%B2%D0%B5%D1%80%D0%B8%20%D1%81%D0%BF%D0%BB%D0%BE%D1%88%D0%BD%D1%8B%D0%B5%20%D0%B4%D0%BB%D1%8F%20%D0%BA%D0%BE%D1%80%D0%BF%D1%83%D1%81%D0%BE%D0%B2%20CQE%20N`

function dimensionCode(mm: number) {
  if (mm % 100 !== 0) throw new Error(`Unsupported CQE N dimension: ${mm} mm`)
  return String(mm / 100)
}

function encodeFilename(filename: string) {
  return encodeURIComponent(filename)
}

function frameGlbUrls(height: number) {
  const h = dimensionCode(height)
  return [
    `${FRAME_ROOT}/${encodeFilename(`R5NKMN${h}(800х600).glb`)}`,
    `${FRAME_ROOT}/${encodeFilename(`R5NKMN${h}(800x600).glb`)}`,
  ]
}

function roofGlbUrl(width: number, depth: number) {
  return `${ROOF_ROOT}/${encodeFilename(`R5NKTB${dimensionCode(width)}${dimensionCode(depth)}(H=2000) изм.glb`)}`
}

function doorGlbUrl(height: number, width: number) {
  return `${DOOR_ROOT}/${encodeFilename(`R5NCPE${dimensionCode(height)}${dimensionCode(width)}.glb`)}`
}

function rearGlbUrl(height: number, width: number) {
  return `${REAR_ROOT}/${encodeFilename(`R5NCRE${dimensionCode(height)}${dimensionCode(width)}.glb`)}`
}

const gltfLoader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
gltfLoader.setDRACOLoader(dracoLoader)
gltfLoader.setMeshoptDecoder(MeshoptDecoder)

const glbCache = new Map<string, Promise<CadSceneTemplate>>()

async function loadGlbTemplate(urls: string[], label: string): Promise<CadSceneTemplate> {
  const cacheKey = urls[0]
  const cached = glbCache.get(cacheKey)
  if (cached) {
    console.log('[GLB cache] hit', label, cacheKey)
    return cached
  }

  const loading = (async () => {
    let lastError: unknown = null

    for (const url of urls) {
      try {
        console.log('[GLB cache] loading Draco GLB', label, url)
        const response = await fetch(url, { cache: 'force-cache' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const buffer = await response.arrayBuffer()
        const magic = new Uint8Array(buffer, 0, 4)
        if (magic[0] !== 0x67 || magic[1] !== 0x6c || magic[2] !== 0x54 || magic[3] !== 0x46) {
          throw new Error('Response is not a GLB file')
        }

        const gltf = await new Promise<THREE.GLTF>((resolve, reject) => {
          gltfLoader.parse(buffer, '', resolve, reject)
        })

        const scene = gltf.scene.clone(true)
        let meshCount = 0
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            meshCount += 1
            object.geometry = object.geometry.clone()
            if (Array.isArray(object.material)) {
              object.material = object.material.map((material) => material.clone())
            } else {
              object.material = object.material.clone()
            }
          }
        })

        if (!meshCount) throw new Error('GLB contains no meshes')
        console.log('[GLB cache] ready', label, url, `meshes=${meshCount}`)
        return { scene }
      } catch (error) {
        lastError = error
      }
    }

    throw new Error(`${label}: unable to load GLB. ${String(lastError)}`)
  })()

  glbCache.set(cacheKey, loading)
  try {
    return await loading
  } catch (error) {
    glbCache.delete(cacheKey)
    throw error
  }
}

function cloneScene(template: CadSceneTemplate, name: string) {
  const object = template.scene.clone(true)
  object.name = name
  object.scale.setScalar(0.01)
  object.updateMatrixWorld(true)
  return object
}

function centerXZ(object: THREE.Object3D) {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  object.position.x -= (box.min.x + box.max.x) / 2
  object.position.z -= (box.min.z + box.max.z) / 2
  object.position.y -= box.min.y
  object.updateMatrixWorld(true)
}

function getWorldBox(object: THREE.Object3D) {
  object.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(object)
}

function moveDoorToFront(object: THREE.Object3D, frameBox: THREE.Box3) {
  object.updateMatrixWorld(true)
  const box = getWorldBox(object)
  object.position.x += (frameBox.min.x + frameBox.max.x) / 2 - (box.min.x + box.max.x) / 2
  object.position.y += frameBox.min.y - box.min.y
  object.position.z += frameBox.max.z - box.max.z
  object.updateMatrixWorld(true)
}

function moveRearToBack(object: THREE.Object3D, frameBox: THREE.Box3) {
  object.updateMatrixWorld(true)
  const box = getWorldBox(object)
  object.position.x += (frameBox.min.x + frameBox.max.x) / 2 - (box.min.x + box.max.x) / 2
  object.position.y += frameBox.min.y - box.min.y
  object.position.z += frameBox.min.z - box.min.z
  object.updateMatrixWorld(true)
}

export function OpenGeometryCadScene({ width, height, depth, railCount, plinthHeight }: OpenGeometryCadSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const parametersRef = useRef({ width, height, depth, railCount, plinthHeight })
  const applyAssemblyRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    parametersRef.current = { width, height, depth, railCount, plinthHeight }
    applyAssemblyRef.current?.()
  }, [width, height, depth, railCount, plinthHeight])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let loadVersion = 0
    let assembly: THREE.Group | null = null
    let applyTimer: ReturnType<typeof setTimeout> | null = null

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#101010')

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(4, 3.5, 4)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 1.2, 0)
    controls.update()

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2))
    const directional = new THREE.DirectionalLight(0xffffff, 2)
    directional.position.set(5, 10, 7)
    scene.add(directional)
    scene.add(new THREE.GridHelper(12, 24, 0x444444, 0x222222))

    const applyAssembly = async () => {
      const version = ++loadVersion
      const { width: currentWidth, height: currentHeight, depth: currentDepth } = parametersRef.current

      try {
        const [roofTemplate, frameTemplate, doorTemplate, rearTemplate] = await Promise.all([
          loadGlbTemplate([roofGlbUrl(currentWidth, currentDepth)], `roof+base R5NKTB${dimensionCode(currentWidth)}${dimensionCode(currentDepth)}`),
          loadGlbTemplate(frameGlbUrls(currentHeight), `4 uprights R5NKMN${dimensionCode(currentHeight)}`),
          loadGlbTemplate([doorGlbUrl(currentHeight, currentWidth)], `solid door R5NCPE${dimensionCode(currentHeight)}${dimensionCode(currentWidth)}`),
          loadGlbTemplate([rearGlbUrl(currentHeight, currentWidth)], `rear panel R5NCRE${dimensionCode(currentHeight)}${dimensionCode(currentWidth)}`),
        ])

        if (disposed || version !== loadVersion) return

        const nextAssembly = new THREE.Group()
        nextAssembly.name = `CQE N ${currentHeight}x${currentWidth}x${currentDepth}`

        const roofBase = cloneScene(roofTemplate, `R5NKTB${dimensionCode(currentWidth)}${dimensionCode(currentDepth)} (крыша+основание)`)
        const uprights = cloneScene(frameTemplate, `R5NKMN${dimensionCode(currentHeight)} (4 стойки)`)
        const door = cloneScene(doorTemplate, `R5NCPE${dimensionCode(currentHeight)}${dimensionCode(currentWidth)} (дверь)`)
        const rear = cloneScene(rearTemplate, `R5NCRE${dimensionCode(currentHeight)}${dimensionCode(currentWidth)} (задняя панель)`)

        // Все четыре исходные модели нормализуются по общей системе координат:
        // низ корпуса = Y 0, центр ширины = X 0, а стойки задают фактические габариты рамы.
        centerXZ(roofBase)
        centerXZ(uprights)
        centerXZ(door)
        centerXZ(rear)

        nextAssembly.add(roofBase)
        nextAssembly.add(uprights)

        const frameBox = getWorldBox(nextAssembly)
        moveDoorToFront(door, frameBox)
        moveRearToBack(rear, frameBox)

        nextAssembly.add(door)
        nextAssembly.add(rear)

        // Центрируем уже собранный шкаф относительно сцены.
        const finalBox = getWorldBox(nextAssembly)
        nextAssembly.position.x -= (finalBox.min.x + finalBox.max.x) / 2
        nextAssembly.position.z -= (finalBox.min.z + finalBox.max.z) / 2
        nextAssembly.position.y -= finalBox.min.y
        nextAssembly.updateMatrixWorld(true)

        const finalSize = getWorldBox(nextAssembly).getSize(new THREE.Vector3())
        const maxDimension = Math.max(finalSize.x, finalSize.y, finalSize.z)
        const cameraDistance = Math.max(maxDimension * 2.4, 3.5)
        camera.position.set(cameraDistance, cameraDistance * 0.78, cameraDistance)
        controls.target.set(0, finalSize.y * 0.5, 0)
        controls.update()

        if (assembly) scene.remove(assembly)
        assembly = nextAssembly
        scene.add(assembly)

        console.log('[DKC] CQE N assembly loaded', {
          dimensions: `${currentHeight}x${currentWidth}x${currentDepth}`,
          components: {
            roofBase: `R5NKTB${dimensionCode(currentWidth)}${dimensionCode(currentDepth)}`,
            uprights: `R5NKMN${dimensionCode(currentHeight)}`,
            door: `R5NCPE${dimensionCode(currentHeight)}${dimensionCode(currentWidth)}`,
            rear: `R5NCRE${dimensionCode(currentHeight)}${dimensionCode(currentWidth)}`,
          },
          railCount: parametersRef.current.railCount,
        })
      } catch (error) {
        if (!disposed && version === loadVersion) {
          console.error('[DKC] CQE N assembly loading failed', error)
        }
      }
    }

    const scheduleAssembly = () => {
      if (applyTimer) clearTimeout(applyTimer)
      applyTimer = setTimeout(() => {
        applyTimer = null
        void applyAssembly()
      }, 250)
    }

    applyAssemblyRef.current = scheduleAssembly
    scheduleAssembly()

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
      loadVersion += 1
      applyAssemblyRef.current = null
      if (applyTimer) clearTimeout(applyTimer)
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={containerRef} className="cad-scene" />
}
