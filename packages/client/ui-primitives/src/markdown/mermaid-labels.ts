/**
 * Localized chrome for one rendered Mermaid diagram's source/zoom/save toolbar. This
 * lives in its own leaf module so the markdown label contract in
 * `render.tsx` and the block that consumes it name one type without either
 * importing the other.
 */

/** Every toolbar control carries a localized accessible label. */
export interface MermaidToolbarLabels {
  /** Visible and accessible label for the source-view switch. */
  source: string
  /** Accessible label for the zoom-out button. */
  zoomOut: string
  /** Accessible label for the zoom-in button. */
  zoomIn: string
  /** Accessible label for the reset-to-100% button. */
  resetZoom: string
  /** Accessible label for the save-SVG button. */
  save: string
}
