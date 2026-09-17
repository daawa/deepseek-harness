# Agent Note: Assistant-Markdown Mermaid diagrams

Status: implemented

English | [中文](2026-09-17-assistant-markdown-mermaid-diagrams.zh.md)

## Problem

Assistant replies that contain ` ```mermaid ` fences rendered as ordinary syntax-highlighted code, so a diagram the model authored arrived as its source text rather than the picture. The Web GUI's markdown pipeline had no Mermaid stage at all: the only special-cased fence language was `math` (promoted to display TeX), and raw HTML was deliberately literal, so even a pre-rendered SVG could not pass through.

## Decision

A settled ` ```mermaid ` fence now renders as a diagram. The change sits in the Cordis-free [ui-primitives markdown pipeline](../../../../packages/client/ui-primitives/src/markdown/render.tsx) as a sibling to the existing `math` arm: `renderCode()` routes a settled `mermaid` fence to a new [`MermaidBlock`](../../../../packages/client/ui-primitives/src/markdown/MermaidBlock.tsx) instead of the generic `CodeBlock`. While the reply streams, the fence stays an ordinary highlighted source fence — the same "TeX stays literal until settle" rule — so incomplete diagram source never flashes render errors.

Mermaid loads lazily. The [`mermaid.ts`](../../../../packages/client/ui-primitives/src/markdown/mermaid.ts) loader keeps the heavy module behind a dynamic `import('mermaid')`, initializes it once with `startOnLoad: false`, `securityLevel: 'strict'` (assistant output is untrusted), and `suppressErrorRendering: true`, and renders to an SVG string under a unique per-render id so ID-scoped styles and fragment references cannot collide across diagrams. Error rendering is suppressed because Mermaid otherwise leaves its own error diagram in `document.body` under an id this module never reuses, so the source-block fallback would be joined by a stray error graphic on every malformed fence. A session with no diagrams pays neither the module nor its initialization. The first render notifies subscribers through a `useSyncExternalStore` snapshot, mirroring the lazy-shiki-grammar pattern in [`highlight.ts`](../../../../packages/client/ui-primitives/src/markdown/highlight.ts).

A diagram that fails to parse or render — or a Mermaid chunk that never loads — falls back to its ordinary, fully labeled source `CodeBlock`, so the diagram text is never lost. A rejected chunk import is recorded as a terminal load state instead of being retried, so it does not restart on every render, and the rejection is absorbed rather than surfacing as an unhandled rejection. An optional localized caption (`MarkdownLabels.mermaid.error`) explains the failure above the source block; the field is optional, so the five feature packages that build `MarkdownLabels` are not broken by a newly required prop, and each can opt into the caption when it localizes it. The SVG is Mermaid's own sanitized output, injected through the same `dangerouslySetInnerHTML` trust path the renderer already uses for shiki's and KaTeX's generated markup.

A successfully rendered diagram carries an optional zoom/save toolbar when the feature supplies `MarkdownLabels.mermaid.toolbar` (a second optional group, so providers of the error caption alone are likewise unbroken). Zoom scales the SVG with a CSS transform from 25% to 400% inside a scrollable viewport, so an enlarged diagram pans by scrolling; reset returns to 100%; save serializes the live SVG (with Mermaid's embedded styles) to an `.svg` download. The chat surface wires these labels through the shared common-namespace dictionary (`markdown.mermaid.*`), so the main conversation view gets the toolbar. Zoom and pan are transient viewing state — they are not persisted, and nothing about them enters the session log, per the web-layer purity rule.

## Alternatives considered

**A Conversation-Node renderer.** A `ConversationNodeDefinition` plus a keyed chat-node renderer renders *session events* as chat nodes; a Mermaid fence is inline assistant-markdown content, not an event, so the markdown `renderCode` arm is the correct layer. The node route would also scatter diagram handling away from the one markdown pipeline every chat surface shares.

**Rendering during streaming.** Re-running Mermaid on each chunk would throw a parse error on every incomplete intermediate source and restart the layout each time. Holding the fence as a source block until the settled pass matches the established math-fence behavior and renders the diagram exactly once.

**A required `mermaid` label group.** Making the error caption mandatory would force all five `MarkdownLabels` builders to change in the same PR and fail their typecheck until they did. An optional field delivers the caption where localized without that coupling; the source fallback already conveys the failure.

**Bundling Mermaid eagerly.** Mermaid is large and needs a live DOM; importing it at boot would tax every session for a feature most replies never use. The dynamic import confines that cost to the first diagram.

**A pan-zoom library for the toolbar.** A dedicated library (as the documentation website's Mermaid viewer uses) would add a direct dependency and gesture machinery for a control that CSS `transform: scale()` plus a scrollable viewport covers with no new dependency. The library route remains available if free-form drag-panning is later wanted; scroll-panning already handles enlarged diagrams.

**Persisting zoom per diagram.** Zoom is transient viewing state like a code block's scroll position; persisting it would add durable state for no durable need and would put presentation-only data near the session log, which the web-layer purity rule forbids.

## Consequences

The Web GUI renders Mermaid diagrams the model authors, at the cost of one heavy optional dependency (`mermaid`, a browser-only `devDependencies` entry inlined into the client bundle) loaded on first use. jsdom cannot run Mermaid's SVG layout (`getBBox` is unimplemented), so component tests stub the loader module and pin the block's state machine — loading, done, failed — rather than Mermaid's own rendering; real rendering is covered by the browser smoke path. The settled-only rule means a diagram appears at finalize, not progressively. The optional error caption means a feature that has not localized it shows the source fallback without explanatory prose. The zoom/save toolbar appears only where a feature supplies its labels (today the chat view, through the common namespace); a feature that does not gets the bare diagram. Zoom needs no new dependency and no persisted state.
