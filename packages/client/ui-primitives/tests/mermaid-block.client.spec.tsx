// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MermaidBlock } from '../src/markdown/MermaidBlock.tsx'

// Mermaid needs SVG layout APIs jsdom does not implement, so the render call is
// stubbed and the block's state machine (loading → done/failed) is what the
// test pins, not Mermaid's own drawing. The loader itself stays real, so the
// block still waits for the module before rendering, as it does in the browser.
vi.mock('../src/markdown/mermaid.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/markdown/mermaid.ts')>()
  return {
    ...original,
    ensureMermaid: vi.fn(original.ensureMermaid),
    mermaidLoadState: vi.fn(original.mermaidLoadState),
    renderMermaid: vi.fn(),
  }
})
import { mermaidLoadState, renderMermaid } from '../src/markdown/mermaid.ts'

const renderMermaidMock = vi.mocked(renderMermaid)

// resetAllMocks restores each `vi.fn(impl)` wrapper to its captured original,
// so a test that forces a load state cannot leak it into the next one.
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('MermaidBlock', () => {
  it('renders the diagram SVG once Mermaid resolves', async () => {
    renderMermaidMock.mockResolvedValue({ svg: '<svg data-testid="diagram"><text>flowchart</text></svg>', diagramType: 'flowchart' })
    const { container } = render(
      <MermaidBlock source="graph TD; A-->B;" copyLabel="Copy" copiedLabel="Copied" errorLabel="Could not render" />,
    )
    await waitFor(() => {
      expect(container.querySelector('.md-mermaid-block svg')).not.toBeNull()
    })
    expect(renderMermaidMock).toHaveBeenCalledWith('graph TD; A-->B;')
    expect(container.textContent).toContain('flowchart')
  })

  it('falls back to the labeled source block when rendering fails', async () => {
    renderMermaidMock.mockRejectedValue(new Error('parse error'))
    const { container } = render(
      <MermaidBlock source="not a diagram" copyLabel="Copy" copiedLabel="Copied" errorLabel="Could not render this diagram" />,
    )
    await waitFor(() => {
      expect(screen.getByText('Could not render this diagram')).toBeTruthy()
    })
    // The source stays visible and copyable through the ordinary CodeBlock.
    expect(container.querySelector('.md-code-block')).not.toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('not a diagram')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
  })

  it('omits the error caption when no error label is provided, but keeps the source fallback', async () => {
    renderMermaidMock.mockRejectedValue(new Error('parse error'))
    const { container } = render(
      <MermaidBlock source="not a diagram" copyLabel="Copy" copiedLabel="Copied" />,
    )
    await waitFor(() => {
      expect(container.querySelector('.md-code-block')).not.toBeNull()
    })
    expect(container.querySelector('pre')?.textContent).toContain('not a diagram')
  })

  it('falls back to the source block when the Mermaid chunk never loads', () => {
    vi.mocked(mermaidLoadState).mockReturnValue('failed')
    const { container } = render(
      <MermaidBlock source="not a diagram" copyLabel="Copy" copiedLabel="Copied" errorLabel="Could not load diagram" />,
    )
    expect(screen.getByText('Could not load diagram')).toBeTruthy()
    expect(container.querySelector('.md-code-block')).not.toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('not a diagram')
    expect(renderMermaidMock).not.toHaveBeenCalled()
  })

  it('renders a distinct source only once', async () => {
    renderMermaidMock.mockResolvedValue({ svg: '<svg></svg>', diagramType: 'flowchart' })
    const { rerender } = render(
      <MermaidBlock source="graph TD; A-->B;" copyLabel="Copy" copiedLabel="Copied" />,
    )
    await waitFor(() => {
      expect(renderMermaidMock).toHaveBeenCalledTimes(1)
    })
    // A re-render with the same source must not re-run Mermaid.
    rerender(<MermaidBlock source="graph TD; A-->B;" copyLabel="Copy" copiedLabel="Copied" />)
    await waitFor(() => {
      expect(renderMermaidMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('toolbar', () => {
    const toolbar = { source: 'Source', zoomOut: 'Zoom out', zoomIn: 'Zoom in', resetZoom: 'Reset zoom', save: 'Save diagram' }

    async function renderWithToolbar(svg = '<svg viewBox="0 0 100 40"><text>diagram</text></svg>') {
      renderMermaidMock.mockResolvedValue({ svg, diagramType: 'flowchart' })
      const rendered = render(
        <MermaidBlock source="graph TD; A-->B;" copyLabel="Copy" copiedLabel="Copied" toolbar={toolbar} />,
      )
      await waitFor(() => {
        expect(rendered.container.querySelector('.md-mermaid-block svg')).not.toBeNull()
      })
      return rendered
    }

    it('renders the zoom/save toolbar only when labels are provided', async () => {
      const { container } = await renderWithToolbar()
      expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Save diagram' })).toBeTruthy()
      expect(container.textContent).toContain('100%')
    })

    it('omits the toolbar when no labels are provided', async () => {
      renderMermaidMock.mockResolvedValue({ svg: '<svg><text>diagram</text></svg>', diagramType: 'flowchart' })
      const { container } = render(
        <MermaidBlock source="graph TD; A-->B;" copyLabel="Copy" copiedLabel="Copied" />,
      )
      await waitFor(() => {
        expect(container.querySelector('.md-mermaid-block svg')).not.toBeNull()
      })
      expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull()
      expect(screen.queryByRole('switch')).toBeNull()
    })

    it.each(['Source', '源码'])('toggles %s without losing the diagram or zoom', async (label) => {
      renderMermaidMock.mockResolvedValue({ svg: '<svg role="img" aria-label="diagram"><text>diagram</text></svg>', diagramType: 'flowchart' })
      const source = 'graph TD\n  A["<b>literal</b>"] --> B\n\n'
      const { container } = render(
        <MermaidBlock source={source} copyLabel="Copy" copiedLabel="Copied" toolbar={{ ...toolbar, source: label }} />,
      )
      const diagram = await screen.findByRole('img', { name: 'diagram' })
      const toggle = screen.getByRole('switch', { name: label, checked: false })
      expect(container.querySelector('pre')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      expect(screen.queryByRole('img', { name: 'diagram' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Save diagram' })).toBeNull()
      expect(container.querySelector('pre')?.textContent).toBe(source)
      expect(container.querySelector('pre b')).toBeNull()
      expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      expect(screen.getByRole('img', { name: 'diagram' })).toBe(diagram)
      expect(container.querySelector('pre')).toBeNull()
      expect(screen.getByText('125%')).toBeTruthy()
      expect(renderMermaidMock).toHaveBeenCalledTimes(1)
    })

    it('copies the original source including trailing blank lines', async () => {
      const source = 'graph TD\n  A --> B\n\n'
      const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
      const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
      try {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
        renderMermaidMock.mockResolvedValue({ svg: '<svg><text>diagram</text></svg>', diagramType: 'flowchart' })
        render(<MermaidBlock source={source} copyLabel="Copy" copiedLabel="Copied" toolbar={toolbar} />)
        fireEvent.click(await screen.findByRole('switch', { name: 'Source' }))
        vi.useFakeTimers()
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })) })
        expect(writeText).toHaveBeenCalledWith(source)
        expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
        await act(async () => { await vi.runOnlyPendingTimersAsync() })
      } finally {
        cleanup()
        vi.useRealTimers()
        if (descriptor === undefined) Reflect.deleteProperty(navigator, 'clipboard')
        else Object.defineProperty(navigator, 'clipboard', descriptor)
      }
    })

    it('zooms in and out with the buttons and resets to 100%', async () => {
      const { container } = await renderWithToolbar()
      // The diagram div carries the inline scale transform (its class is a
      // hashed CSS-module name, so select the element by that style hook).
      const diagram = () => container.querySelector('.md-mermaid-block div[style*="scale"]') as HTMLElement
      expect(diagram().style.transform).toBe('scale(1)')

      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      await waitFor(() => {
        expect(diagram().style.transform).toBe('scale(1.25)')
      })
      expect(container.textContent).toContain('125%')

      fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
      await waitFor(() => {
        expect(diagram().style.transform).toBe('scale(1)')
      })

      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }))
      await waitFor(() => {
        expect(diagram().style.transform).toBe('scale(1)')
      })
    })

    it('disables zoom-out at the floor and zoom-in at the ceiling', async () => {
      await renderWithToolbar()
      const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement
      const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement
      // Drive to the ceiling (1.25^n >= 4 at n=7).
      for (let i = 0; i < 8; i += 1) fireEvent.click(zoomIn)
      await waitFor(() => {
        expect(zoomIn.disabled).toBe(true)
      })
      // Drive to the floor.
      for (let i = 0; i < 16; i += 1) fireEvent.click(zoomOut)
      await waitFor(() => {
        expect(zoomOut.disabled).toBe(true)
      })
    })

    it('downloads valid SVG XML with multiline HTML labels', async () => {
      const { container } = await renderWithToolbar(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><foreignObject width="100" height="40"><div><p>First &amp; &lt;label&gt;<br>Second</p></div></foreignObject></svg>',
      )
      const click = vi.fn()
      const create = vi.fn<(blob: Blob) => string>(() => 'blob:mock')
      const revoke = vi.fn<(url: string) => void>()
      const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
      const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click)
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Save diagram' }))
        expect(create).toHaveBeenCalledTimes(1)
        expect(click).toHaveBeenCalledTimes(1)
        expect(revoke).toHaveBeenCalledWith('blob:mock')
        const [blob] = create.mock.calls[0]!
        const text = await blob.text()
        expect(blob.type).toBe('image/svg+xml')
        expect(text).toContain('<?xml version="1.0"')
        const saved = new DOMParser().parseFromString(text, 'image/svg+xml')
        expect(saved.querySelector('parsererror')).toBeNull()
        expect(saved.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg')
        expect(saved.documentElement.getAttribute('viewBox')).toBe('0 0 100 40')
        const label = saved.querySelector('foreignObject p')
        expect(label?.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
        expect(label?.textContent).toBe('First & <label>Second')
        expect(label?.querySelectorAll('br')).toHaveLength(1)
        expect(container.querySelector('.md-mermaid-block svg foreignObject p')?.textContent).toBe(label?.textContent)
      } finally {
        if (createDescriptor === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
        else Object.defineProperty(URL, 'createObjectURL', createDescriptor)
        if (revokeDescriptor === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
        else Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor)
        anchorClick.mockRestore()
      }
    })
  })
})
