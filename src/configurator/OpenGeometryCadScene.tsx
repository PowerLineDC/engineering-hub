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

type CadMeshTemplate = {
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
}

type DkcManifest = Record<string, string>

const STEP_ROOT = '/library/dkc/Osnovnyye_elementy_korpusa_CQE_N/Osnovnie_elementi_korpusa_CQE%20N'
const PLINTH_STEP_ROOT = `${STEP_ROOT}/R5NFPB_R5NBP/%D0%A3%D0%B3%D0%BB%D1%8B%20%D1%86%D0%BE%D0%BA%D0%BE%D0%BB%D1%8F%20R5NBP`
const BODY_STEP_ROOT = `${STEP_ROOT}/R5NKTB`

function plinthStepUrl(plinthHeight: number) {
  const article = plinthHeight === 200 ? 'R5NBP02B.STEP' : 'R5NBP01B.STEP'
  return `${PLINTH_STEP_ROOT}/${article}`
}

function cabinetArticle(width: number, depth: number) {
  return `R5NKTB${width / 100}${depth / 100}(H=2000) изм`
}

function cabinetStepUrl(width: number, depth: number) {
  return `${BODY_STEP_ROOT}/${cabinetArticle(width, depth).replaceAll(' ', '%20')}.STEP`
}

function glbKeyFromStepUrl(stepUrl: string) {
  const pathname = new URL(stepUrl, window.location.origin).pathname
  const filename = decodeURIComponent(pathname.split('/').pop() ?? '')
  return filename.replace(/\.step$/i, '')
}

const gltfLoader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
gltfLoader.setDRACOLoader(dracoLoader)
gltfLoader.setMeshoptDecoder(MeshoptDecoder)

const glbCache = new Map<string, Promise<CadMeshTemplate>>()
let manifestPromise: Promise<DkcManifest> | null = null

async function loadDkcManifest(): Promise<DkcManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch('/models/dkc/manifest.json', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error(`DKC GLB manifest unavailable: HTTP ${response.status}`)
      const contentType = response.headers.get('content-type') ?? ''
      const text = await response.text()
      if (!contentType.includes('json') && text.trimStart().startsWith('<')) {
        throw new Error('DKC GLB manifest is missing: server returned HTML instead of JSON')
      }
      return JSON.parse(text) as DkcManifest
    })
  }
  return manifestPromise
}

async function loadGlbTemplate(stepUrl: string, label: string): Promise<CadMeshTemplate> {
  const key = glbKeyFromStepUrl(stepUrl)
  const cached = glbCache.get(key)
  if (cached) {
    console.log('[GLB cache] hit', label, key)
    return cached
  }

  const loading = (async () => {
    const manifest = await loadDkcManifest()
    const glbUrl = manifest[key]
    if (!glbUrl) {
      throw new Error(`${label}: no generated GLB in manifest for ${key}`)
    }

    console.log('[GLB cache] loading Draco GLB', label, glbUrl)
    const response = await fetch(glbUrl, { cache: 'force-cache' })
    if (!response.ok) throw new Error(`${label}: GLB HTTP ${response.status} at ${glbUrl}`)
    const buffer = await response.arrayBuffer()
    const magic = new Uint8Array(buffer, 0, 4)
    if (magic[0] !== 0x67 || magic[1] !== 0x6c || magic[2] !== 0x54 || magic[3] !== 0x46) {
      const text = new TextDecoder().decode(buffer.slice(0, 80))
      throw new Error(`${label}: expected GLB but received ${response.headers.get('content-type') ?? 'unknown'}: ${text}`)
    }

    const gltf = await new Promise<THREE.GLTF>((resolve, reject) => {
      gltfLoader.parse(buffer, '', resolve, reject)
    })
    let sourceMesh: THREE.Mesh | null = null

    gltf.scene.traverse((object) => {
      if (!sourceMesh && object instanceof THREE.Mesh) sourceMesh = object
    })

    if (!sourceMesh) throw new Error(`${label}: GLB contains no mesh`)

    const geometry = sourceMesh.geometry.clone()
    const sourceMaterial = Array.isArray(sourceMesh.material) ? sourceMesh.material[0] : sourceMesh.material
    const material = sourceMaterial instanceof THREE.MeshStandardMaterial
      ? sourceMaterial.clone()
      : new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.15, roughness: 0.7 })

    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    console.log('[GLB cache] ready', label, glbUrl)
    return { geometry, material }
  })()

  glbCache.set(key, loading)
  try {
    return await loading
  } catch (error) {
    glbCache.delete(key)
    throw error
  }
}

function createMesh(template: CadMeshTemplate, name: string) {
  const mesh = new THREE.Mesh(template.geometry, template.material)
  mesh.name = name
  mesh.scale.setScalar(0.01)
  return mesh
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
    let importedPlinth: THREE.Mesh | null = null
    let importedCabinet: THREE.Mesh | null = null
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
    controls.target.set(0, 1.5, 0)
    controls.update()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2))
    const directional = new THREE.DirectionalLight(0xffffff, 2)
    directional.position.set(5, 10, 7)
    scene.add(directional)
    scene.add(new THREE.GridHelper(12, 24, 0x444444, 0x222222))

    const applyAssembly = async () => {
      const version = ++loadVersion
      const { width: currentWidth, depth: currentDepth, plinthHeight: currentPlinthHeight } = parametersRef.current
      try {
        const plinthUrl = plinthStepUrl(currentPlinthHeight)
        const cabinetUrl = cabinetStepUrl(currentWidth, currentDepth)
        const [plinthTemplate, cabinetTemplate] = await Promise.all([
          loadGlbTemplate(plinthUrl, `plinth ${currentPlinthHeight}`),
          loadGlbTemplate(cabinetUrl, `cabinet ${currentWidth}x${currentDepth}`),
        ])
        if (disposed || version !== loadVersion) return
        if (importedPlinth) scene.remove(importedPlinth)
        if (importedCabinet) scene.remove(importedCabinet)
        importedPlinth = createMesh(plinthTemplate, currentPlinthHeight === 200 ? 'R5NBP02B' : 'R5NBP01B')
        scene.add(importedPlinth)
        const plinthBox = new THREE.Box3().setFromObject(importedPlinth)
        importedPlinth.position.x -= (plinthBox.min.x + plinthBox.max.x) / 2
        importedPlinth.position.z -= (plinthBox.min.z + plinthBox.max.z) / 2
        importedPlinth.position.y -= plinthBox.min.y
        importedCabinet = createMesh(cabinetTemplate, cabinetArticle(currentWidth, currentDepth))
        scene.add(importedCabinet)
        const cabinetBox = new THREE.Box3().setFromObject(importedCabinet)
        importedCabinet.position.x -= (cabinetBox.min.x + cabinetBox.max.x) / 2
        importedCabinet.position.z -= (cabinetBox.min.z + cabinetBox.max.z) / 2
        importedCabinet.position.y += plinthBox.max.y - cabinetBox.min.y
        console.log('[DKC] Cabinet assembly loaded from GLB', {
          width: currentWidth, depth: currentDepth, plinthHeight: currentPlinthHeight,
          railCount: parametersRef.current.railCount,
          cabinetArticle: cabinetArticle(currentWidth, currentDepth),
          plinthSource: manifest[glbKeyFromStepUrl(plinthUrl)] ?? 'manifest',
          cabinetSource: manifest[glbKeyFromStepUrl(cabinetUrl)] ?? 'manifest',
        })
      } catch (error) {
        if (!disposed && version === loadVersion) console.error('[DKC] Cabinet assembly loading failed', error)
      }
    }

    const scheduleAssembly = () => {
      if (applyTimer) clearTimeout(applyTimer)
      applyTimer = setTimeout(() => { applyTimer = null; void applyAssembly() }, 250)
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
    const animate = () => { frame = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera) }
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
