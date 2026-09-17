/** Recorded assistant Markdown retains its diagram when readers inspect and copy the source. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, parseSeedFixture, readPersistedEvents, realizeSeedFixture,
  renderSeedFixture, seedSession, selectedSessionFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/mermaid-source', import.meta.url))
const MODE = webSnapshotMode()
const CASES = [
  { locale: 'en-US', name: 'en', source: 'Source', zoomIn: 'Zoom in', copy: 'Copy', copied: 'Copied' },
  { locale: 'zh-CN', name: 'zh', source: '源码', zoomIn: '放大', copy: '复制', copied: '复制成功' },
]

describe.skipIf(MODE === 'record').each(CASES)('web e2e: Mermaid source ($name)', (labels) => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionId: SessionId
  let seed: ReturnType<typeof parseSeedFixture>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const fixture = await readFile(await selectedSessionFixture(join(SNAPSHOT_DIR, 'session.jsonl')), 'utf8')
    sessionId = await seedSession(scaffold, fixture, 'mermaid-source')
    seed = parseSeedFixture(realizeSeedFixture(scaffold, fixture, sessionId))
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: labels.locale, timezoneId: 'Asia/Shanghai' })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: scaffold.baseUrl })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  })

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('switches with the keyboard, copies source, and restores the rendered diagram', async () => {
    onTestFailed(() => saveFailureShot(page, `web-mermaid-source-${labels.name}`))
    await page.getByRole('treeitem').first().click()
    await page.getByRole('treeitem').nth(1).click()
    const block = page.locator('.md-mermaid-block')
    const svg = block.locator('svg.flowchart')
    await svg.waitFor({ state: 'visible' })
    // ELK emits a subgraphs group; a silent fallback to Dagre must not pass.
    expect(await svg.locator('g.subgraphs').count()).toBe(1)
    const diagramId = await svg.getAttribute('id')
    await block.getByRole('button', { name: labels.zoomIn, exact: true }).click()
    const viewport = svg.locator('..').locator('..')
    const scrollLeft = await viewport.evaluate((element) => { element.scrollLeft = 20; return element.scrollLeft })
    expect(scrollLeft).toBeGreaterThan(0)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, `diagram.${labels.name}.expected.md`),
      await captureStableAria(page, '.md-mermaid-block', scaffold.workspaceCwd), MODE)

    const toggle = block.getByRole('switch', { name: labels.source, exact: true })
    expect(await toggle.getAttribute('aria-checked')).toBe('false')
    await toggle.focus()
    await toggle.press('Space')
    await block.locator('pre').waitFor({ state: 'visible' })
    expect(await toggle.getAttribute('aria-checked')).toBe('true')
    expect(await svg.isVisible()).toBe(false)
    expect(await block.getByRole('button', { name: labels.zoomIn, exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, `source.${labels.name}.expected.md`),
      await captureStableAria(page, '.md-mermaid-block', scaffold.workspaceCwd), MODE)
    const source = await block.locator('pre').textContent()
    await block.getByRole('button', { name: labels.copy, exact: true }).click()
    await block.getByRole('button', { name: labels.copied, exact: true }).waitFor()
    expect(await page.evaluate(async () => navigator.clipboard.readText())).toBe(source)

    await toggle.focus()
    await toggle.press('Enter')
    await svg.waitFor({ state: 'visible' })
    expect(await toggle.getAttribute('aria-checked')).toBe('false')
    expect(await svg.getAttribute('id')).toBe(diagramId)
    expect(await viewport.evaluate(element => element.scrollLeft)).toBe(scrollLeft)
    expect(await block.locator('pre').count()).toBe(0)
    expect(await block.getByText('125%', { exact: true }).count()).toBe(1)
    const persisted = await readPersistedEvents(scaffold, sessionId)
    // Opening a cold seed appends its acknowledgement; switching views adds no events.
    expect(persisted.slice(seed.events.length)).toMatchObject([{ type: 'session/end-seed', data: {} }])
    expect(renderSeedFixture(seed.headerLine, persisted.slice(0, seed.events.length)))
      .toBe(renderSeedFixture(seed.headerLine, seed.events))
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})

afterAll(async () => {
  if (MODE === 'record') return
  await assertFixtureInventory(SNAPSHOT_DIR, [
    'session.v3.jsonl', 'diagram.en.expected.md', 'source.en.expected.md',
    'diagram.zh.expected.md', 'source.zh.expected.md',
  ])
})
