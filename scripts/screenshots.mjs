// Writes the README screenshots to docs/: a desktop and a phone shot, light and dark.
// Each one is a plain screenshot of the app, framed by cutaway (https://github.com/half144/cutaway)
// in a Safari window or an iPhone on a macOS wallpaper.
// Needs cutaway in ~/.cutaway (or CUTAWAY_DIR) and Node 22. Run with: npm run screenshots
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { build, preview } from 'vite'

const CUTAWAY = join(process.env.CUTAWAY_DIR ?? join(homedir(), '.cutaway'), 'src/cli.mjs')
const PORT = 4175
const NOW = new Date(2026, 9, 5, 15, 0)
const URL = 'https://satz-app.vercel.app'
const WALLPAPER = 'sonoma'

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

async function screenshot(browser, { scheme, phone, path, show }) {
  const context = await browser.newContext({
    colorScheme: scheme,
    ...(phone
      ? // The page between the iPhone's status bar and home indicator, as cutaway expects.
        { viewport: { width: 393, height: 764 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 }),
  })
  const page = await context.newPage()
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((data) => localStorage.setItem('satz.v1', data), stored)
  await page.goto(`http://localhost:${PORT}`)
  await page.getByRole('tab', { name: 'Today' }).waitFor()
  await show(page)
  await page.waitForTimeout(300)
  await page.screenshot({ path })
  await context.close()
}

// Review with a wrong answer, so the marked word shows.
async function review(page) {
  await page.getByRole('button', { name: 'Start review' }).click()
  await page.keyboard.type(WRONG_ANSWER)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /Got it/ }).waitFor()
}

async function library(page) {
  await page.getByRole('tab', { name: 'Library' }).click()
}

function frame(input, output, { scheme, phone }) {
  const args = [CUTAWAY, 'frame', input, '--output', output, '--url', URL, '--preset', WALLPAPER]
  if (phone) args.push('--device', 'iPhone 15 Pro')
  execFileSync(process.execPath, args, { stdio: 'inherit' })
}

await build({ logLevel: 'warn' })
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' })
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
const raw = await mkdtemp(join(tmpdir(), 'satz-shots-'))
try {
  for (const scheme of ['light', 'dark']) {
    const shots = [
      { name: `desktop-${scheme}`, phone: false, show: review },
      { name: `phone-${scheme}`, phone: true, show: library },
    ]
    for (const { name, phone, show } of shots) {
      const input = join(raw, `${name}.png`)
      await screenshot(browser, { scheme, phone, path: input, show })
      frame(input, `docs/${name}.png`, { scheme, phone })
    }
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
  await rm(raw, { recursive: true, force: true })
}
console.log('Wrote docs/desktop-{light,dark}.png and docs/phone-{light,dark}.png')
