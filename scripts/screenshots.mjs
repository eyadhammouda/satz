// Writes the README screenshots to docs/, light and dark, all on the macOS Sonoma wallpaper:
// three desktop shots in a Safari window (home, a new sentence, a test) and three iPhones side by side.
// The framing is cutaway's (https://github.com/half144/cutaway): its frame command for the windows,
// and its phone drawing for the row of phones.
// Needs cutaway in ~/.cutaway (or CUTAWAY_DIR) and Node 22. Run with: npm run screenshots
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { build, preview } from 'vite'

const CUTAWAY_DIR = process.env.CUTAWAY_DIR ?? join(homedir(), '.cutaway')
const cutaway = (path) => import(pathToFileURL(join(CUTAWAY_DIR, path)).href)
const { createCanvas, loadImage } = await cutaway('node_modules/@napi-rs/canvas/index.js')
const { backgrounds } = await cutaway('src/render/wallpapers.mjs')
const { createDeviceFrame, deviceLayout, drawDeviceBody, drawScreen } = await cutaway('src/render/device.mjs')
const { mobileDevice } = await cutaway('src/plan.mjs')

const PORT = 4175
const NOW = new Date(2026, 9, 5, 15, 0)
const URL = 'https://satz-app.vercel.app'
const WALLPAPER = 'sonoma'
const PHONE = mobileDevice('iPhone 15 Pro')
// The page between the iPhone's status bar and home indicator.
const PHONE_VIEWPORT = {
  width: PHONE.screen.width,
  height: PHONE.screen.height - PHONE.insets.top - PHONE.insets.bottom,
}

// A learner a few weeks in: 300 sentences learned, one lesson done today.
const DAY = 86_400_000
const stored = JSON.stringify({
  version: 2,
  course: 2,
  next: 300,
  cards: Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [
      i,
      {
        due: NOW.getTime() + (i < 260 ? (i % 20) * DAY : -DAY),
        stability: 8,
        difficulty: 5,
        elapsed_days: 3,
        scheduled_days: 8,
        learning_steps: 0,
        reps: 4,
        lapses: 0,
        state: 2,
        last_review: NOW.getTime() - 3 * DAY,
        introduced: NOW.getTime() - 14 * DAY,
      },
    ]),
  ),
  lesson: null,
  accepted: {},
  extra: {},
  reviews: [],
  history: [{ started: NOW.getTime() - 3 * 3_600_000, ended: NOW.getTime() - 2 * 3_600_000, activeMs: 22 * 60_000, introduced: 12, reviewed: 41, firstTryCorrect: 33 }],
})
// What to type for the test card, so one word shows as wrong.
const wrong = (german) => german.replace(/^(\S+)/, (first) => (first === 'Ich' ? 'Du' : 'Ich'))

const screens = {
  home: async () => {},
  // A new sentence, shown with its audio before it is tested.
  intro: async (page) => {
    await page.getByRole('button', { name: /lesson/ }).click()
    await page.getByText('New sentence').waitFor()
  },
  // A test with one wrong word marked.
  test: async (page) => {
    await page.getByRole('button', { name: /lesson/ }).click()
    await page.getByText('Review').waitFor()
    const english = await page.locator('main > p').nth(1).textContent()
    const german = await page.evaluate(async (en) => {
      const rows = await (await fetch('/sentences/000.json')).json()
      return rows.find((r) => r[2] === en)?.[1] ?? ''
    }, english)
    await page.getByPlaceholder('Type the German').fill(wrong(german))
    await page.keyboard.press('Enter')
    await page.getByRole('status').waitFor()
  },
}

// A first lesson starts with a new sentence; the others open with reviews.
const FRESH = new Set(['intro'])

async function screenshot(browser, { scheme, phone, screen }) {
  const context = await browser.newContext({
    colorScheme: scheme,
    ...(phone
      ? { viewport: PHONE_VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 }),
  })
  const page = await context.newPage()
  await page.clock.install({ time: NOW })
  if (!FRESH.has(screen)) await page.addInitScript((data) => localStorage.setItem('satz.v2', data), stored)
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve()
  })
  await page.goto(`http://localhost:${PORT}`)
  await page.getByRole('button', { name: /lesson/ }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('button[disabled]'))
  await screens[screen](page)
  await page.waitForTimeout(300)
  const png = await page.screenshot()
  await context.close()
  return png
}

// A Safari window on the wallpaper, by cutaway's frame command.
function frameWindow(input, output) {
  execFileSync(
    process.execPath,
    [join(CUTAWAY_DIR, 'src/cli.mjs'), 'frame', input, '--output', output, '--url', URL, '--preset', WALLPAPER],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
}

// Phones side by side on one wallpaper, each drawn like cutaway's single phone.
async function phoneRow(pngs, output) {
  const layout = deviceLayout(PHONE, PHONE_VIEWPORT)
  const scale = 2
  const phoneWidth = layout.body.width * scale
  const phoneHeight = layout.body.height * scale
  const gap = Math.round(phoneWidth * 0.14)
  const border = Math.round(phoneHeight * 0.07)
  const width = pngs.length * phoneWidth + (pngs.length - 1) * gap + border * 2
  const height = phoneHeight + border * 2

  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  const wallpaper = await loadImage(await readFile(backgrounds[WALLPAPER]))
  const cover = Math.max(width / wallpaper.width, height / wallpaper.height)
  context.drawImage(
    wallpaper,
    (width - wallpaper.width * cover) / 2,
    (height - wallpaper.height * cover) / 2,
    wallpaper.width * cover,
    wallpaper.height * cover,
  )

  for (const [i, png] of pngs.entries()) {
    const x = border + i * (phoneWidth + gap)
    const { window, frame } = createDeviceFrame(phoneWidth, phoneHeight, PHONE_VIEWPORT, 0, layout)
    const shift = (box) => ({ ...box, x: box.x + x, y: box.y + border })
    const placed = shift(window)
    // A soft shadow under each phone, like cutaway's.
    context.save()
    context.shadowColor = '#00000059'
    context.shadowBlur = phoneHeight * 0.03
    context.shadowOffsetY = phoneHeight * 0.015
    context.fillStyle = '#000'
    context.beginPath()
    context.roundRect(placed.x, placed.y, placed.width, placed.height, placed.radius)
    context.fill()
    context.restore()
    drawDeviceBody(context, placed, layout)
    drawScreen(context, {
      source: await loadImage(png),
      frame: { ...shift(frame), screen: shift(frame.screen) },
      device: layout,
    })
  }
  await writeFile(output, await canvas.encode('png'))
}

await build({ logLevel: 'warn' })
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' })
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
const raw = await mkdtemp(join(tmpdir(), 'satz-shots-'))
try {
  for (const scheme of ['light', 'dark']) {
    for (const screen of ['home', 'intro', 'test']) {
      const input = join(raw, `${screen}-${scheme}.png`)
      await writeFile(input, await screenshot(browser, { scheme, phone: false, screen }))
      frameWindow(input, `docs/desktop-${screen}-${scheme}.png`)
    }
    const phones = []
    for (const screen of ['home', 'intro', 'test']) phones.push(await screenshot(browser, { scheme, phone: true, screen }))
    await phoneRow(phones, `docs/phones-${scheme}.png`)
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
  await rm(raw, { recursive: true, force: true })
}
console.log('Wrote 3 desktop shots and a row of phones to docs/, light and dark')
