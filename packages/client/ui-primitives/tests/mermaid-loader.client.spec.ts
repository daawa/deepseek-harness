// @vitest-environment jsdom
/** Lazy renderer setup registers ELK before any diagram can render. */
import { afterEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  initialize: vi.fn(),
  registerLayoutLoaders: vi.fn(),
  render: vi.fn().mockResolvedValue({ svg: '<svg/>', diagramType: 'flowchart' }),
}))
vi.mock('mermaid', () => ({ default: api }))

// Fresh module instances isolate the singleton loader's terminal states.
afterEach(() => {
  vi.doUnmock('@mermaid-js/layout-elk')
  vi.resetModules()
  vi.clearAllMocks()
})

it('loads once, registers ELK, and renders with unique diagram ids', async () => {
  const loader = await import('../src/markdown/mermaid.ts')
  const notified = vi.fn()
  const off = loader.subscribeMermaidLoaded(notified)
  try {
    expect(loader.mermaidLoadState()).toBe('loading')
    await new Promise<void>((resolve) => {
      const stop = loader.subscribeMermaidLoaded(() => { stop(); resolve() })
      expect(loader.ensureMermaid()).toBe(false)
      expect(loader.ensureMermaid()).toBe(false)
    })
    expect(loader.mermaidLoadState()).toBe('ready')
    expect(loader.ensureMermaid()).toBe(true)
    expect(notified).toHaveBeenCalledTimes(1)
    expect(api.registerLayoutLoaders).toHaveBeenCalledExactlyOnceWith(
      (await import('@mermaid-js/layout-elk')).default,
    )
    expect(api.initialize).toHaveBeenCalledExactlyOnceWith({
      startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, layout: 'elk',
    })
    expect(api.registerLayoutLoaders.mock.invocationCallOrder[0]).toBeLessThan(api.initialize.mock.invocationCallOrder[0]!)
    const source = 'graph TD; A-->B'
    expect(await loader.renderMermaid(source)).toEqual({ svg: '<svg/>', diagramType: 'flowchart' })
    await loader.renderMermaid(source)
    expect(api.render).toHaveBeenNthCalledWith(1, 'dsh-mermaid-1', source)
    expect(api.render).toHaveBeenNthCalledWith(2, 'dsh-mermaid-2', source)
  } finally {
    off()
  }
})

it('reports a failed ELK import without initializing Mermaid or retrying', async () => {
  const importElk = vi.fn(() => { throw new Error('ELK chunk unavailable') })
  vi.doMock('@mermaid-js/layout-elk', importElk)
  const loader = await import('../src/markdown/mermaid.ts')
  await new Promise<void>((resolve) => {
    const off = loader.subscribeMermaidLoaded(() => { off(); resolve() })
    loader.ensureMermaid()
  })
  expect(loader.mermaidLoadState()).toBe('failed')
  expect(loader.ensureMermaid()).toBe(false)
  expect(importElk).toHaveBeenCalledTimes(1)
  expect(api.initialize).not.toHaveBeenCalled()
  expect(api.registerLayoutLoaders).not.toHaveBeenCalled()
})
