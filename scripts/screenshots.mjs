// Builds the app, fills it with Austrian example sentences, and writes the README screenshots to docs/.
// Phone shots are plain. The desktop shot sits in a MacBook frame on a gradient, in the style of Screen Studio.
// Run with: npm run screenshots
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { build, preview } from 'vite'

const TODAY = '2026-10-05'
const NOW = new Date(2026, 9, 5, 15, 0)
const PORT = 4175
const BASE = `http://localhost:${PORT}`

// [german, english, box, days until due]. A due day of 0 or less is due today.
const SENTENCES = [
  ['Kannst du mir bitte die Paradeiser geben?', 'Can you pass me the tomatoes, please?', 2, -1],
  ['Grüß Gott, ich hätte gern eine Melange', 'Hello, I would like a melange', 1, 0],
  ['Servus, wie geht es dir heute?', 'Hi, how are you today?', 3, 0],
  ['Heute Nachmittag machen wir eine Jause', "We'll have a snack this afternoon", 0, 0],
  ['Im Jänner fahren wir nach Kitzbühel', "In January we're going to Kitzbühel", 2, 0],
  ['Das Sackerl ist leider zu klein', 'The bag is unfortunately too small', 1, 0],
  ['Wir treffen uns am Abend beim Heurigen', "We'll meet at the wine tavern this evening", 4, 0],
  ['Die Marillenknödel schmecken herrlich', 'The apricot dumplings taste wonderful', 0, 0],
  ['Ich nehme die Bim zum Westbahnhof', "I'll take the tram to Westbahnhof", 2, 0],
  ['Magst du noch ein Stück Sachertorte?', 'Would you like another piece of Sacher torte?', 1, 0],
  ['Gestern war es in Wien ziemlich windig', 'Yesterday it was quite windy in Vienna', 3, 0],
  ['Am Wochenende gehen wir auf den Kahlenberg', "At the weekend we're hiking up the Kahlenberg", 0, 0],
  ['Der Topfenstrudel ist noch warm', 'The quark strudel is still warm', 3, 2],
  ['Baba, bis morgen!', 'Bye, see you tomorrow!', 4, 6],
]
// The first review card, answered with the everyday German word instead of the Austrian one.
const WRONG_ANSWER = 'Kannst du mir bitte die Tomaten geben?'

const addDays = (days) => {
  const date = new Date(Date.UTC(2026, 9, 5) + days * 86_400_000)
  return date.toISOString().slice(0, 10)
}

const data = {
  version: 1,
  sentences: SENTENCES.map(([german, english, box, due], index) => ({
    id: `demo-${index}`,
    german,
    english,
    createdDay: addDays(-30 + index),
    box,
    dueDay: addDays(due),
    lastReviewedDay: addDays(-3),
    correct: box,
    missed: index % 3,
  })),
}

async function openApp(browser, { width, height, scale, scheme }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: scheme })
  const page = await context.newPage()
  await page.clock.setFixedTime(NOW)
  await page.addInitScript((stored) => localStorage.setItem('satz.v1', stored), JSON.stringify(data))
  await page.goto(BASE)
  await page.getByRole('tab', { name: 'Today' }).waitFor()
  return { context, page }
}

async function showWrongAnswer(page) {
  await page.getByRole('button', { name: 'Start review' }).click()
  await page.keyboard.type(WRONG_ANSWER)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /Got it/ }).waitFor()
  // Let the card fade-in finish.
  await page.waitForTimeout(300)
}

async function phoneShots(browser, scheme) {
  const { context, page } = await openApp(browser, { width: 390, height: 844, scale: 2, scheme })
  await page.screenshot({ path: `docs/today-${scheme}.png` })
  await page.getByRole('tab', { name: 'Library' }).click()
  await page.screenshot({ path: `docs/library-${scheme}.png` })
  await page.getByRole('tab', { name: 'Today' }).click()
  await showWrongAnswer(page)
  await page.screenshot({ path: `docs/review-${scheme}.png` })
  await context.close()
}

// The screen of a 14" MacBook in CSS pixels: a menu bar, a browser toolbar, then the app.
const SCREEN = { width: 1512, height: 982, menuBar: 32, toolbar: 48 }

async function desktopShot(browser, scheme) {
  const appHeight = SCREEN.height - SCREEN.menuBar - SCREEN.toolbar
  const { context, page } = await openApp(browser, { width: SCREEN.width, height: appHeight, scale: 2, scheme })
  await showWrongAnswer(page)
  const app = (await page.screenshot()).toString('base64')
  await context.close()

  const frame = await browser.newContext({ viewport: { width: 1600, height: 1060 }, deviceScaleFactor: 1.5 })
  const canvas = await frame.newPage()
  await canvas.setContent(macbook(app, scheme, appHeight))
  await canvas.locator('img').evaluate((img) => img.decode())
  await canvas.screenshot({ path: `docs/desktop-${scheme}.png` })
  await frame.close()
}

function macbook(appPng, scheme, appHeight) {
  const dark = scheme === 'dark'
  const background = dark
    ? 'radial-gradient(120% 90% at 20% 10%, #3b2a4f 0%, transparent 60%), radial-gradient(100% 80% at 90% 90%, #1f3b4d 0%, transparent 55%), #121218'
    : 'radial-gradient(120% 90% at 15% 10%, #ffd9c7 0%, transparent 60%), radial-gradient(100% 80% at 90% 95%, #cfd8ff 0%, transparent 55%), #f3eef6'
  const chrome = dark ? '#2a2a2c' : '#f6f6f6'
  const chromeLine = dark ? '#000' : '#dcdcdc'
  const urlBar = dark ? '#3a3a3c' : '#e9e9eb'
  const urlText = dark ? '#d8d8dc' : '#3c3c43'
  const menuBar = dark ? '#1c1c1e' : '#ececee'
  const menuText = dark ? '#e5e5ea' : '#1c1c1e'
  const { width, height, menuBar: menuHeight, toolbar } = SCREEN
  const bezel = 20
  const lidWidth = width + bezel * 2
  const scale = 1260 / (lidWidth * 1.14)

  return `<!doctype html>
<html><head><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    position: relative; overflow: hidden; background: ${background};
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  }
  /* The unscaled device is wider than the page, so centre it by position, not by layout. */
  .device {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(${scale});
    display: flex; flex-direction: column; align-items: center;
  }
  .lid {
    width: ${lidWidth}px; padding: ${bezel}px ${bezel}px ${bezel + 6}px;
    background: #0b0b0c; border-radius: 34px 34px 6px 6px;
    box-shadow: inset 0 0 0 2px #2c2c2e, 0 40px 120px rgba(20, 10, 40, ${dark ? 0.6 : 0.28});
    position: relative;
  }
  .screen { width: ${width}px; height: ${height}px; border-radius: 12px 12px 0 0; overflow: hidden; position: relative; }
  .notch {
    position: absolute; top: 0; left: 50%; transform: translateX(-50%);
    width: 210px; height: ${menuHeight}px; background: #0b0b0c; border-radius: 0 0 14px 14px; z-index: 2;
  }
  .menu {
    height: ${menuHeight}px; background: ${menuBar}; color: ${menuText};
    display: flex; align-items: center; justify-content: space-between; padding: 0 22px;
    font-size: 14px; font-weight: 500;
  }
  .menu span + span { margin-left: 22px; font-weight: 400; }
  .toolbar {
    height: ${toolbar}px; background: ${chrome}; border-bottom: 1px solid ${chromeLine};
    display: flex; align-items: center; padding: 0 18px; position: relative;
  }
  .lights { display: flex; gap: 9px; }
  .lights i { width: 13px; height: 13px; border-radius: 50%; display: block; }
  .url {
    position: absolute; left: 50%; transform: translateX(-50%); width: 420px; height: 30px;
    border-radius: 8px; background: ${urlBar}; color: ${urlText};
    display: grid; place-items: center; font-size: 14px;
  }
  .screen img { display: block; width: ${width}px; height: ${appHeight}px; }
  .base {
    width: ${lidWidth * 1.14}px; height: 24px; margin-top: -1px;
    background: linear-gradient(#e2e3e6, #b9bbc0 70%, #8e9096);
    border-radius: 2px 2px 22px 22px / 2px 2px 14px 14px; position: relative;
    box-shadow: 0 30px 60px rgba(20, 10, 40, ${dark ? 0.55 : 0.22});
  }
  .base::before {
    content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
    width: 240px; height: 10px; background: linear-gradient(#a9abb0, #c9cbd0); border-radius: 0 0 12px 12px;
  }
</style></head><body>
  <div class="device">
    <div class="lid">
      <div class="screen">
        <div class="notch"></div>
        <div class="menu">
          <div><span>Safari</span><span>File</span><span>Edit</span><span>View</span><span>History</span></div>
          <div>Mon 5 Oct  15:00</div>
        </div>
        <div class="toolbar">
          <div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
          <div class="url">satz-app.vercel.app</div>
        </div>
        <img src="data:image/png;base64,${appPng}" alt="">
      </div>
    </div>
    <div class="base"></div>
  </div>
</body></html>`
}

await build({ logLevel: 'warn' })
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' })
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
try {
  for (const scheme of ['light', 'dark']) {
    await phoneShots(browser, scheme)
    await desktopShot(browser, scheme)
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
const written = ['today', 'review', 'library', 'desktop'].flatMap((n) => [`docs/${n}-light.png`, `docs/${n}-dark.png`])
await Promise.all(written.map((f) => readFile(f)))
console.log(`Wrote ${written.length} screenshots to docs/`)
