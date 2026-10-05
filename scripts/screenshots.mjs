// Writes the README screenshots to docs/, light and dark, all on the macOS Sonoma wallpaper:
// three desktop shots in a Safari window (Today, Review, Library) and three iPhones side by side.
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

// [german, english, days until due]
const SENTENCES = [
  ['Servus!', 'Hi!', 0],
  ['Grüß Gott', 'Hello', 0],
  ['Baba!', 'Bye!', 0],
  ['Eine Melange, bitte', 'A melange, please', 0],
  ['Wo ist die Bim?', 'Where is the tram?', 0],
  ['Das Sackerl, bitte', 'The bag, please', 0],
  ['Ich hab Hunger', "I'm hungry", 1],
  ['Bis morgen!', 'See you tomorrow!', 3],
]
// The first review card, answered in standard German instead of Austrian.
const WRONG_ANSWER = 'Hallo!'

const day = (offset) => new Date(Date.UTC(2026, 9, 5) + offset * 86_400_000).toISOString().slice(0, 10)
const stored = JSON.stringify({
  version: 1,
  sentences: SENTENCES.map(([german, english, due], i) => ({
    id: `demo-${i}`,
    german,
    english,
    createdDay: day(-20 + i),
    box: 2,
    dueDay: day(due),
    lastReviewedDay: day(-3),
    correct: 2,
    missed: 0,
  })),
})

const screens = {
  today: async () => {},
  // Review with a wrong answer, so the marked word shows.
  review: async (page) => {
    await page.getByRole('button', { name: 'Start review' }).click()
    await page.keyboard.type(WRONG_ANSWER)
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: /Got it/ }).waitFor()
  },
  library: async (page) => {
    await page.getByRole('tab', { name: 'Library' }).click()
  },
  // Typing a new sentence, with the listen button in the field.
  add: async (page) => {
    await page.getByRole('tab', { name: 'Add' }).click()
    await page.getByLabel('German').fill('Gemma auf an Kaffee?')
    await page.getByLabel('English').fill('Shall we go for a coffee?')
    await page.getByLabel('German').focus()
  },
}

async function screenshot(browser, { scheme, phone, screen }) {
  const context = await browser.newContext({
    colorScheme: scheme,
    ...(phone
      ? { viewport: PHONE_VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 }),
  })
  const page = await context.newPage()
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((data) => localStorage.setItem('satz.v1', data), stored)
  await page.goto(`http://localhost:${PORT}`)
  await page.getByRole('tab', { name: 'Today' }).waitFor()
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
    for (const screen of ['today', 'review', 'library']) {
      const input = join(raw, `${screen}-${scheme}.png`)
      await writeFile(input, await screenshot(browser, { scheme, phone: false, screen }))
      frameWindow(input, `docs/desktop-${screen}-${scheme}.png`)
    }
    const phones = []
    for (const screen of ['today', 'review', 'add']) phones.push(await screenshot(browser, { scheme, phone: true, screen }))
    await phoneRow(phones, `docs/phones-${scheme}.png`)
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
  await rm(raw, { recursive: true, force: true })
}
console.log('Wrote 3 desktop shots and a row of phones to docs/, light and dark')
