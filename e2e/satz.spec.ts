import { expect, test, type Page } from '@playwright/test'

// 2026-10-06 18:00 local time.
const START = new Date(2026, 9, 6, 18, 0)
const MIN = 60_000

/** Fails the test on any console warning or error. */
function watchConsole(page: Page) {
  const problems: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error') problems.push(msg.text())
  })
  page.on('pageerror', (err) => problems.push(err.message))
  return problems
}

/** Records what would be read aloud, instead of playing it. */
async function fakeVoice(page: Page) {
  await page.addInitScript(() => {
    const played: string[] = []
    Object.assign(window, { played })
    HTMLMediaElement.prototype.play = function () {
      played.push(new URL(this.src).searchParams.get('text') ?? '')
      return Promise.resolve()
    }
  })
}

const played = (page: Page) => page.evaluate(() => (window as unknown as { played: string[] }).played)

async function open(page: Page, at = START) {
  await fakeVoice(page)
  await page.clock.install({ time: at })
  await page.goto('/')
  await expect(page.getByRole('button', { name: "Start today's lesson" })).toBeEnabled()
}

/** Waits for a new sentence on screen, then moves past it. */
async function next(page: Page) {
  await expect(page.getByText('New sentence')).toBeVisible()
  const german = await page.locator('main p[lang="de"]').first().textContent()
  await page.keyboard.press('Enter')
  await expect(page.locator('main p[lang="de"]').first()).not.toHaveText(german!)
}

/** Shows two new sentences, then lets a minute pass so the first one is tested. */
async function toFirstTest(page: Page) {
  await page.getByRole('button', { name: "Start today's lesson" }).click()
  await next(page)
  await expect(page.getByText('New sentence')).toBeVisible()
  await page.clock.fastForward(MIN)
  await page.keyboard.press('Enter')
  await expect(page.getByPlaceholder('Type the German')).toBeFocused()
}

const progress = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('satz.v2') ?? 'null'))

/** The course, as the app loads it. */
async function course(page: Page): Promise<{ german: string; english: string; alternatives: string[] }[]> {
  return page.evaluate(async () => {
    const rows = (await (await fetch('/sentences/000.json')).json()) as [number, string, string, string, string[]?][]
    return rows.map(([, german, english, , alternatives]) => ({ german, english, alternatives: alternatives ?? [] }))
  })
}

/** Answers the card on screen correctly. Works for new sentences and tests. */
async function answerCorrectly(page: Page, byEnglish: Map<string, string>) {
  const label = page.locator('main > p').first()
  await expect(label).toBeVisible()
  if ((await label.textContent()) === 'New sentence') {
    await page.keyboard.press('Enter')
    return 'intro'
  }
  const english = (await page.locator('main > p').nth(1).textContent())!
  await page.getByPlaceholder('Type the German').fill(byEnglish.get(english)!)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Correct')
  await page.keyboard.press('Enter')
  return 'test'
}

test('home shows one button and no library or add tabs', async ({ page }) => {
  const problems = watchConsole(page)
  await open(page)
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByText('Learned')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tatoeba' })).toHaveAttribute('href', 'https://tatoeba.org')
  expect(problems).toEqual([])
})

test('a new sentence is shown with audio, then tested about a minute later', async ({ page }) => {
  const problems = watchConsole(page)
  await open(page)
  const sentences = await course(page)
  await page.getByRole('button', { name: "Start today's lesson" }).click()

  await expect(page.getByText('New sentence')).toBeVisible()
  await expect(page.getByText(sentences[0].german, { exact: true })).toBeVisible()
  await expect(page.getByText(sentences[0].english, { exact: true })).toBeVisible()
  await expect.poll(async () => (await played(page)).at(-1)).toBe(sentences[0].german)
  await expect(page.getByRole('timer')).toHaveText('60:00')

  // Next card is the second new sentence, then the first comes back as a test once a minute has passed.
  await page.keyboard.press('Enter')
  await expect(page.getByText(sentences[1].german, { exact: true })).toBeVisible()
  await page.clock.fastForward(MIN)
  await page.keyboard.press('Enter')
  await expect(page.getByText('Say it, then type it')).toBeVisible()
  await expect(page.getByText(sentences[0].english, { exact: true })).toBeVisible()

  const input = page.getByPlaceholder('Type the German')
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('lang', 'de')
  await expect(input).toHaveAttribute('autocomplete', 'off')
  await input.fill(sentences[0].german)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Correct')
  await expect(input).toHaveAttribute('readonly', '')

  const p = await progress(page)
  expect(p.next).toBe(2)
  expect(Object.keys(p.cards)).toEqual(['0', '1'])
  expect(problems).toEqual([])
})

test('a wrong answer is marked word by word and comes back soon', async ({ page }) => {
  await open(page)
  const sentences = await course(page)
  await page.getByRole('button', { name: "Start today's lesson" }).click()
  await page.keyboard.press('Enter')
  await expect(page.getByText(sentences[1].german, { exact: true })).toBeVisible()
  await page.clock.fastForward(MIN)
  await page.keyboard.press('Enter')

  const words = sentences[0].german.replace(/[.!?]$/, '').split(' ')
  const wrong = ['Xyz', ...words.slice(1)].join(' ')
  await page.getByPlaceholder('Type the German').fill(wrong)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Not quite')
  await expect(page.locator('.text-destructive')).toHaveText('wrong: Xyz')
  await expect(page.locator('.underline').first()).toContainText(words[0])
  await page.keyboard.press('Enter')

  const card = (await progress(page)).cards['0']
  expect(card.lapses + card.reps).toBeGreaterThan(0)
  expect(card.due - START.getTime()).toBeLessThan(5 * MIN)
})

test('capitals and umlauts typed out pass, and the right spelling is shown', async ({ page }) => {
  await open(page)
  const sentences = await course(page)
  await toFirstTest(page)
  const typed = sentences[0].german.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  await page.getByPlaceholder('Type the German').fill(typed)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText(/^Correct/)
})

test('"I was right" accepts my answer from then on', async ({ page }) => {
  await open(page)
  await toFirstTest(page)
  await page.getByPlaceholder('Type the German').fill('Das bin ich gewesen')
  await page.keyboard.press('Enter')
  await page.keyboard.press('2')
  expect((await progress(page)).accepted['0']).toEqual(['Das bin ich gewesen'])
})

test('a whole hour: many new sentences, every one tested, then a summary', async ({ page }) => {
  test.setTimeout(240_000)
  const problems = watchConsole(page)
  await open(page)
  const byEnglish = new Map((await course(page)).map((s) => [s.english, s.german]))
  await page.getByRole('button', { name: "Start today's lesson" }).click()

  let cards = 0
  while (cards < 400) {
    if (await page.getByText('Lesson done').isVisible()) break
    await answerCorrectly(page, byEnglish)
    // About 25 seconds per card, so the hour runs out on the lesson's own clock.
    await page.clock.fastForward(25_000)
    cards++
  }
  await expect(page.getByText('Lesson done')).toBeVisible()
  const p = await progress(page)
  expect(p.lesson).toBeNull()
  expect(p.history).toHaveLength(1)
  expect(p.history[0].introduced).toBeGreaterThanOrEqual(20)
  expect(p.history[0].activeMs).toBeGreaterThanOrEqual(59 * MIN)
  for (const card of Object.values(p.cards) as { reps: number }[]) expect(card.reps).toBeGreaterThanOrEqual(1)

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: "Start today's lesson" })).toBeVisible()
  await expect(page.getByText('Minutes today')).toBeVisible()
  expect(problems).toEqual([])
})

test('the clock pauses when away, and a lesson resumes where it stopped', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: "Start today's lesson" }).click()
  await next(page)
  await page.clock.fastForward(30_000)
  await next(page)
  // Walk away for 20 minutes without touching anything.
  await page.clock.fastForward(20 * MIN)
  await expect(page.getByRole('timer')).toHaveText('Paused')
  await page.getByRole('button', { name: 'Close' }).click()

  const button = page.getByRole('button', { name: /^Continue lesson/ })
  await expect(button).toBeVisible()
  const left = Number((await button.textContent())!.match(/(\d+):\d\d left/)![1])
  // Only the active minutes count, not the 20 away.
  expect(left).toBeGreaterThanOrEqual(56)
  await button.click()
  await expect(page.getByRole('timer')).not.toHaveText('Paused')
  expect((await progress(page)).next).toBe(2)
})

test('a second lesson the same day is allowed after the first one ends', async ({ page }) => {
  await open(page)
  const byEnglish = new Map((await course(page)).map((s) => [s.english, s.german]))
  // A finished lesson earlier today.
  await page.evaluate((started) => {
    localStorage.setItem(
      'satz.v2',
      JSON.stringify({
        version: 2,
        next: 0,
        cards: {},
        lesson: null,
        accepted: {},
        history: [{ started, ended: started + 3_600_000, activeMs: 3_600_000, introduced: 0, reviewed: 0, firstTryCorrect: 0 }],
      }),
    )
  }, START.getTime() - 5 * 3_600_000)
  await page.reload()
  await expect(page.getByText('Minutes today')).toBeVisible()
  await expect(page.locator('dd').nth(2)).toHaveText('60')
  await page.getByRole('button', { name: "Start today's lesson" }).click()
  await answerCorrectly(page, byEnglish)
  expect((await progress(page)).lesson).not.toBeNull()
})

test('progress survives reload, and export then import restores it', async ({ page, browser }) => {
  await open(page)
  await page.getByRole('button', { name: "Start today's lesson" }).click()
  await next(page)
  await next(page)
  await page.getByRole('button', { name: 'Close' }).click()
  await page.reload()
  await expect(page.locator('dd').first()).toHaveText('2')
  const original = await progress(page)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('satz-progress-2026-10-06.json')
  const path = test.info().outputPath('progress.json')
  await download.saveAs(path)

  const fresh = await browser.newContext()
  const other = await fresh.newPage()
  await other.clock.install({ time: START })
  await other.goto('/')
  const chooserPromise = other.waitForEvent('filechooser')
  await other.getByRole('button', { name: 'Import' }).click()
  await (await chooserPromise).setFiles(path)
  await expect(other.getByText('Progress restored')).toBeVisible()
  await expect(other.locator('dd').first()).toHaveText('2')
  expect(await progress(other)).toEqual(original)
  await fresh.close()
})

test('usable at 360px wide in dark mode', async ({ page }) => {
  const problems = watchConsole(page)
  await page.setViewportSize({ width: 360, height: 740 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await open(page)
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).not.toBe('rgb(255, 255, 255)')
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(await overflow()).toBeLessThanOrEqual(0)
  await toFirstTest(page)
  expect(await overflow()).toBeLessThanOrEqual(0)
  await page.getByPlaceholder('Type the German').fill('Ich bin mir nicht so sicher wie du denkst')
  await page.keyboard.press('Enter')
  expect(await overflow()).toBeLessThanOrEqual(0)
  const height = await page.getByRole('button', { name: /Continue/ }).evaluate((el) => el.getBoundingClientRect().height)
  expect(height).toBeGreaterThanOrEqual(44)
  expect(problems).toEqual([])
})
