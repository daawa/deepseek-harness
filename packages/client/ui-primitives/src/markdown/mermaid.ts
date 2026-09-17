/**
 * Lazy Mermaid loader and renderer. The `mermaid` package is heavy and needs
 * a live DOM, so it loads behind a dynamic import the first time a settled
 * ```mermaid fence renders; a session with no diagrams pays neither the
 * module nor its initialization. Rendering is asynchronous and yields an SVG
 * string, which the caller injects exactly as it does shiki's and KaTeX's
 * generated markup — Mermaid output under `securityLevel: 'strict'` is a
 * sanitized SVG vocabulary with no raw user HTML.
 *
 * ELK layouts register lazily alongside Mermaid; diagrams using Mermaid's
 * shared layout selection default to ELK's layered algorithm.
 * The singleton initializes once with `startOnLoad: false` (this module
 * drives rendering explicitly), `securityLevel: 'strict'` (assistant output
 * is untrusted), and `suppressErrorRendering: true`: Mermaid otherwise leaves
 * its own error diagram in `document.body`, attached to an id this module
 * never reuses, so the caller's source-block fallback would be joined by a
 * stray error graphic on every failed draft. A unique id per render keeps
 * Mermaid's ID-scoped SVG styles and fragment references from colliding
 * across diagrams.
 */

import type { RenderResult } from 'mermaid'

type MermaidModule = typeof import('mermaid')

/** Whether the module can render now, is still importing, or failed to import. */
export type MermaidLoadState = 'loading' | 'ready' | 'failed'

let loading: Promise<void> | undefined
let ready: MermaidModule | undefined
let failed = false
let sequence = 0

const subscribers = new Set<() => void>()

/**
 * Subscribe to Mermaid load completion; the listener fires when the module
 * finishes importing and initializing, so a caller that rendered a loading
 * placeholder can re-render. Uses the `useSyncExternalStore` subscribe
 * signature; pair it with {@link mermaidLoadState} as the snapshot. Returns
 * an unsubscribe function.
 * @param listener - invoked (no args) when the load state changes.
 * @returns a disposer that removes the listener.
 */
export function subscribeMermaidLoaded(listener: () => void): () => void {
  subscribers.add(listener)
  return () => { subscribers.delete(listener) }
}

/**
 * The current load state, for a `useSyncExternalStore` snapshot.
 * @returns `ready` once rendering is possible, `failed` when the import
 * rejected, and `loading` in every other case.
 */
export function mermaidLoadState(): MermaidLoadState {
  if (ready !== undefined) return 'ready'
  return failed ? 'failed' : 'loading'
}

/**
 * Begin loading Mermaid if it is not already ready, in flight, or failed.
 * Idempotent. A failed import is not retried: every later call reports
 * `false`, so each diagram settles into its source-block fallback instead of
 * restarting a rejected chunk fetch on every render.
 * @returns whether Mermaid is ready to render now.
 */
export function ensureMermaid(): boolean {
  if (ready !== undefined) return true
  if (failed) return false
  // The rejection handler absorbs the chunk-import error: the state is what
  // callers act on, and a rejected `loading` promise nobody awaits would
  // surface as an unhandled rejection.
  loading ??= Promise.all([import('mermaid'), import('@mermaid-js/layout-elk')]).then(
    ([mod, elk]) => {
      mod.default.registerLayoutLoaders(elk.default)
      mod.default.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, layout: 'elk' })
      ready = mod
      for (const listener of subscribers) listener()
    },
    () => {
      failed = true
      for (const listener of subscribers) listener()
    },
  )
  return false
}

/**
 * Render one diagram source to SVG. Mermaid must be ready (see
 * {@link ensureMermaid}); the caller gates on that before invoking.
 * @param source - The Mermaid diagram source (fence body).
 * @returns Mermaid's render result: the SVG string and its bind functions.
 */
export async function renderMermaid(source: string): Promise<RenderResult> {
  // ensureMermaid settled `ready` before any caller reaches here.
  const mermaid = (ready as MermaidModule).default
  sequence += 1
  return mermaid.render(`dsh-mermaid-${sequence}`, source)
}
