import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { CodeBlock } from './CodeBlock.tsx'
import { Switch } from '../Switch.tsx'
import { ensureMermaid, mermaidLoadState, renderMermaid, subscribeMermaidLoaded } from './mermaid.ts'
import type { MermaidToolbarLabels } from './mermaid-labels.ts'
import { IconDownloadOutlineRegular, IconMinusOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular } from '../icons/index.tsx'
import css from './MermaidBlock.module.css'

export interface MermaidBlockProps {
  /** The Mermaid diagram source (fence body), rendered once settled. */
  source: string
  /** Copy-button idle label for the source view and error fallback. */
  copyLabel: string
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel: string
  /**
   * Caption shown above the source block when the diagram fails to render.
   * Optional: a feature that does not localize it still gets the source
   * fallback, just without the explanatory caption.
   */
  errorLabel?: string | undefined
  /**
   * Diagram/source and zoom/save toolbar chrome. Absent, the diagram renders without the
   * toolbar; present, every control is labeled.
   */
  toolbar?: MermaidToolbarLabels | undefined
}

/** One settled render outcome: the SVG markup, or the failure to produce it. */
type Outcome =
  | { status: 'rendering' }
  | { status: 'done'; svg: string }
  | { status: 'failed' }

/** Zoom bounds and the multiplicative step the toolbar applies. */
const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_STEP = 1.25

/**
 * Render one settled ```mermaid fence as a diagram. Mermaid loads lazily on
 * first use; while it imports, a placeholder holds the block's place. A
 * source that fails to parse or render — or a Mermaid chunk that never
 * loads — falls back to its ordinary code block (fully labeled and
 * copyable), so the diagram text is never lost; an optional localized
 * caption explains the failure when the feature provides one. The SVG is
 * Mermaid's own sanitized output under
 * `securityLevel: 'strict'`, injected through the same
 * `dangerouslySetInnerHTML` trust path as shiki's and KaTeX's generated
 * markup.
 *
 * When the feature supplies `toolbar` labels, a successfully rendered diagram
 * carries a zoom/save toolbar: zoom scales the SVG with a CSS transform
 * inside a scrollable viewport (so an enlarged diagram pans by scrolling),
 * reset returns to 100%, and save downloads XML-serialized SVG, preserving
 * XHTML label namespaces and line breaks. The Source switch shows copyable
 * Mermaid code without discarding the diagram or its zoom and scroll state.
 * Results from disposed effects are ignored, including source replacement
 * and React effect replay.
 */
export function MermaidBlock({ source, copyLabel, copiedLabel, errorLabel, toolbar }: MermaidBlockProps) {
  // Kick the lazy import; the snapshot moves off `loading` when it settles.
  ensureMermaid()
  const loadState = useSyncExternalStore(subscribeMermaidLoaded, mermaidLoadState, mermaidLoadState)
  const [outcome, setOutcome] = useState<Outcome>({ status: 'rendering' })
  const [zoom, setZoom] = useState(1)
  const [showSource, setShowSource] = useState(false)
  const diagramRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (loadState !== 'ready') return
    let cancelled = false
    setOutcome({ status: 'rendering' })
    renderMermaid(source).then(
      (result) => {
        if (cancelled) return
        setOutcome({ status: 'done', svg: result.svg })
      },
      () => {
        if (cancelled) return
        setOutcome({ status: 'failed' })
      },
    )
    return () => { cancelled = true }
  }, [loadState, source])

  const zoomBy = useCallback((factor: number) => {
    setZoom(current => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor)))
  }, [])
  const resetZoom = useCallback(() => { setZoom(1) }, [])

  const save = useCallback(() => {
    const svg = diagramRef.current?.querySelector('svg')
    if (svg === null || svg === undefined) return
    // HTML serialization leaves void elements such as <br> invalid in SVG XML.
    const markup = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'diagram.svg'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [])

  const body = useMemo(() => {
    if (outcome.status === 'done') {
      return (
        <div className={css.diagramWrap}>
          {toolbar !== undefined && (
            <div className={css.toolbar}>
              {!showSource && <>
                <button type="button" className={css.toolButton} aria-label={toolbar.zoomOut} title={toolbar.zoomOut}
                  onClick={() => { zoomBy(1 / ZOOM_STEP) }} disabled={zoom <= ZOOM_MIN}>
                  <IconMinusOutlineRegular size={16} />
                </button>
                <span className={css.zoomValue}>{Math.round(zoom * 100)}%</span>
                <button type="button" className={css.toolButton} aria-label={toolbar.zoomIn} title={toolbar.zoomIn}
                  onClick={() => { zoomBy(ZOOM_STEP) }} disabled={zoom >= ZOOM_MAX}>
                  <IconPlusOutlineRegular size={16} />
                </button>
                <button type="button" className={css.toolButton} aria-label={toolbar.resetZoom} title={toolbar.resetZoom}
                  onClick={resetZoom} disabled={zoom === 1}>
                  <IconRefreshOutlineRegular size={16} />
                </button>
                <button type="button" className={css.toolButton} aria-label={toolbar.save} title={toolbar.save}
                  onClick={save}>
                  <IconDownloadOutlineRegular size={16} />
                </button>
              </>}
              <label className={css.sourceSwitch}>
                <span>{toolbar.source}</span>
                <Switch checked={showSource} onChange={setShowSource} label={toolbar.source} />
              </label>
            </div>
          )}
          {showSource && <CodeBlock
            className={css.source}
            code={`${source}\n`}
            lang="mermaid"
            copyLabel={copyLabel}
            copiedLabel={copiedLabel}
          />}
          <div className={css.viewport} hidden={showSource}>
            <div
              ref={diagramRef}
              className={css.diagram}
              style={{ transform: `scale(${zoom})` }}
              dangerouslySetInnerHTML={{ __html: outcome.svg }}
            />
          </div>
        </div>
      )
    }
    if (outcome.status === 'failed' || loadState === 'failed') {
      return (
        <div className={css.fallback}>
          {errorLabel !== undefined && <div className={css.errorCaption}>{errorLabel}</div>}
          <CodeBlock
            code={source}
            lang="mermaid"
            copyLabel={copyLabel}
            copiedLabel={copiedLabel}
          />
        </div>
      )
    }
    return <div className={css.loading} aria-hidden="true" />
  }, [outcome, loadState, source, copyLabel, copiedLabel, errorLabel, toolbar, zoom,
    showSource, zoomBy, resetZoom, save])

  return <div className={clsx(css.block, 'md-mermaid-block')}>{body}</div>
}
