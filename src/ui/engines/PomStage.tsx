import { useEffect, useRef } from 'react'
import type { PomPose } from '../../rules/vitals'
import { loadEngine } from '../../lib/engines'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useReadableEngine } from './useReadableEngine'
import { throttleStage } from './stageThrottle'

interface Disposable { dispose?: () => void }
interface StageObject {
  geometry?: Disposable
  material?: Disposable & Record<string, unknown> | Array<Disposable & Record<string, unknown>>
}
interface StageScene { traverse: (fn: (obj: StageObject) => void) => void }
type PomStageElement = HTMLElement & { _scene?: StageScene }

// Texture-bearing slots a StillRoom voxel material can carry (README-dashboard "Pom"):
// any of these left undisposed on repeated Today↔Board mounts leaks GPU textures (I2).
const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap',
  'displacementMap', 'envMap', 'lightMap', 'specularMap',
] as const

function disposeMaterial(mat: Disposable & Record<string, unknown>): void {
  for (const slot of TEXTURE_SLOTS) {
    const tex = mat[slot] as Disposable | undefined
    tex?.dispose?.()
  }
  mat.dispose?.()
}

/**
 * pom-stage.js (generated, never hand-edited) builds a fresh THREE.Scene per attach but its
 * disconnectedCallback only cancels the render loop — every geometry, material and texture in
 * that scene is left for the shared WebGLRenderer to track forever (Review I2: 10 Today↔Board
 * round trips took PomStage.shared.info.memory from 42→462 geometries, 10→100 textures). Dispose
 * them ourselves on unmount by walking the element's `_scene`.
 */
function disposeStage(el: PomStageElement | null): void {
  const scene = el?._scene
  if (!scene) return
  scene.traverse(obj => {
    obj.geometry?.dispose?.()
    const mat = obj.material
    if (Array.isArray(mat)) mat.forEach(disposeMaterial)
    else if (mat) disposeMaterial(mat)
  })
}

/** One <pom-stage> (three.js voxel Pom). The engine loads three.js itself, lazily, from /engines/vendor/three. */
export function PomStage({ form, pose, label }: { form: number; pose: PomPose; label: string }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const ref = useRef<PomStageElement | null>(null)
  const readable = useReadableEngine<PomStageElement>('pom-stage', ref)
  useEffect(() => {
    // Capture the element now: by the time this cleanup runs (a later, passive-effect flush),
    // React has already nulled out `ref.current` during the synchronous unmount commit.
    const el = ref.current
    let live = true
    let undo = () => {}
    // perf P2: once the engine is defined, at most 30 fps and asleep when hidden, idle or with reduced motion
    loadEngine('pom-stage').then(() => { if (live && el) undo = throttleStage(el, () => reducedRef.current) }).catch(() => {})
    return () => { live = false; undo(); disposeStage(el) }
  }, [])
  return (
    <pom-stage
      ref={readable}
      who="pom"
      form={String(form)}
      pose={pose}
      zoom="1.05"
      background="transparent"
      autorotate={reduced ? undefined : ''}
      role="img"
      aria-label={label}
    />
  )
}
