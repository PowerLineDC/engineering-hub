import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OpenGeometry } from 'opengeometry'
import { importSTEP, setOC } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import wasmUrl from 'opengeometry/opengeometry_bg.wasm?url'
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url'

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

let openGeometryReady: Promise<void> | null = null
let openCascadeReady: Promise<void> | null = null
const stepCache = new Map<string, Promise<CadMeshTemplate>>()

function initOpenGeometry() {
  if (!openGeometryReady) {
    openGeometryReady = OpenGeometry.create({ wasmURL: wasmUrl }).then(() => {
      console.log('[OpenGeometry] WASM initialized')
    })
  }
  return openGeometryReady
}

async function initializeOpenCascade() {
  if (!openCascadeReady) {
    const init = initOpenCascade as unknown as (options: {
      locateFile: () => string
    }) => Promise<any>

    openCascadeReady = init({
      locateFile: () => opencascadeWasm,
    }).then((oc) => {
      setOC(oc)
      console.log('[OpenCascade] WASM initialized for STEP import')
    })
  }
  return openCascadeReady
}

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

async function loadStepTemplate(url: string, label: string): Promise<CadMeshTemplate> {
  const cached = stepCache.get(url)
  if (cached) {
    console.log('[CAD cache] hit', label, url)
    return cached
  }

  const loading = (async () => {
    console.log('[CAD cache] loading STEP', label, url)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`${label} STEP request failed: ${response.status} ${response.statusText}`)
    }

    const blob = await response.blob()
    const shape = await importSTEP(blob)
    const data = shape.mesh({ tolerance: 0.05, angularTolerance: 30 })
    const geometry = new THREE.BufferGeometry()

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(data.vertices, 3),
    )
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(data.normals, 3),
    )
    geometry.setIndex(data.triangles)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    const material = new THREE.MeshStandardMaterial({
      color: 0x777777,
      metalness: 0.15,
      roughness: 0.7,
    })

    console.log('[CAD cache] ready', label, url)
    return { geometry, material }
  })()

  stepCache.set(url, loading)

  try {
    return await loading
  } catch (error) {
    stepCache.delete(url)
    throw error
  }
}

function createMesh(template: CadMeshTemplate, name: string) {
  const mesh = new THREE.Mesh(template.geometry, template.material)
  mesh.name = name
  // DKC STEP dimensions are in millimetres; the configurator scene uses
  // 1 scene unit = 100 mm.
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
        await Promise.all([initOpenGeometry(), initializeOpenCascade()])
        if (disposed || version !== loadVersion) return

        const plinthUrl = plinthStepUrl(currentPlinthHeight)
        const cabinetUrl = cabinetStepUrl(currentWidth, currentDepth)

        const [plinthTemplate, cabinetTemplate] = await Promise.all([
          loadStepTemplate(plinthUrl, `plinth ${currentPlinthHeight}`),
          loadStepTemplate(cabinetUrl, `cabinet ${currentWidth}x${currentDepth}`),
        ])

        if (disposed || version !== loadVersion) return

        if (importedPlinth) scene.remove(importedPlinth)
        if (importedCabinet) scene.remove(importedCabinet)

        importedPlinth = createMesh(
          plinthTemplate,
          currentPlinthHeight === 200 ? 'R5NBP02B' : 'R5NBP01B',
        )
        scene.add(importedPlinth)

        const plinthBox = new THREE.Box3().setFromObject(importedPlinth)
        importedPlinth.position.x -= (plinthBox.min.x + plinthBox.max.x) / 2
        importedPlinth.position.z -= (plinthBox.min.z + plinthBox.max.z) / 2
        importedPlinth.position.y -= plinthBox.min.y

        importedCabinet = createMesh(
          cabinetTemplate,
          cabinetArticle(currentWidth, currentDepth),
        )
        scene.add(importedCabinet)

        const cabinetBox = new THREE.Box3().setFromObject(importedCabinet)
        importedCabinet.position.x -= (cabinetBox.min.x + cabinetBox.max.x) / 2
        importedCabinet.position.z -= (cabinetBox.min.z + cabinetBox.max.z) / 2
        importedCabinet.position.y += plinthBox.max.y - cabinetBox.min.y

        console.log('[DKC] Cabinet assembly loaded', {
          width: currentWidth,
          depth: currentDepth,
          plinthHeight: currentPlinthHeight,
          railCount: parametersRef.current.railCount,
          cabinetArticle: cabinetArticle(currentWidth, currentDepth),
          cabinetSource: cabinetUrl,
        })
      } catch (error) {
        if (!disposed && version === loadVersion) {
          console.error('[DKC] Cabinet assembly loading failed', error)
        }
      }
    }

    applyAssemblyRef.current = () => {
      void applyAssembly()
    }

    void applyAssembly()

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
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={containerRef} className="cad-scene" />
}
