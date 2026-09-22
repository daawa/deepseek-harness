# Agent Note: Code-block folding

Status: implemented

English | [中文](2026-09-22-code-block-folding.zh.md)

## Problem

Long code blocks occupy reading space even when the reader wants only surrounding prose. The shared renderer also serves document previews and Mermaid source views, so hiding source must work with their layout overrides without breaking copying or content refs.

## Decision

`CodeBlock` owns a default-expanded banner toggle with required localized collapse/expand labels. Folding is component-local viewing state, not a session event or setting. The content wrapper stays mounted and carries `hidden`; its scoped `display: none !important` rule overrides consumer scrollport display rules. Copy remains available and reads the complete supplied source.

This extends the shared renderer without changing the [document-preview scrollport ownership](2026-09-09-sidebar-and-preview-interaction-polish.md) or the [Mermaid source switch](2026-09-17-assistant-markdown-mermaid-diagrams.md).

## Alternatives considered

**Unmount folded source.** Unmounting discards highlighted DOM and detaches the owner's content ref. Keeping the wrapper retains those identities through streaming growth and settlement.

**Rely on the browser's hidden stylesheet or ordinary selector specificity.** Author display rules override the browser default, and consumer scrollport selectors can override an ordinary component rule. The important declaration is limited to this component's hidden content.

## Consequences

Folding saves visible space, not DOM memory or highlighting work. Headerless blocks have no fold control. Component tests cover source copying and fold-state retention during streaming; recorded-session browser cases cover localized keyboard controls, actual visibility under sidebar styles, and copying while folded. DOM fixtures include streaming math fences because they still render as source before settlement.
