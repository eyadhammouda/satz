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

/**
 * Records what would be read aloud, instead of playing it. The preview server has no /api/speak,
 * so a stand-in for Audio "plays" each sentence at once without loading anything.
 */
async function fakeVoice(page: Page) {
  await page.addInitScript(() => {
    const played: string[] = []
    class FakeAudio extends EventTarget {
      constructor(public src: string) {
        super()
      }
      play() {
        played.push(new URL(this.src, location.href).searchParams.get('text') ?? '')
        setTimeout(() => this.dispatchEvent(new Event('ended')), 0)
        return Promise.resolve()
      }
      pause() {}
    }
    Object.assign(window, { played, Audio: FakeAudio })
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
    const rows = (await (await fetch('/sentences/000.json')).json()) as [number, string, string, string, string, string[]?][]
    return rows.map(([, german, english, , , alternatives]) => ({ german, english, alternatives: alternatives ?? [] }))
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
  await expect(page.getByRole('timer')).toHaveText('30:00')

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

test('a new sentence plays twice, a second apart, and the listen button cuts in', async ({ page }) => {
  await open(page)
  const sentences = await course(page)
  await page.getByRole('button', { name: "Start today's lesson" }).click()
  await expect(page.getByText(sentences[0].german, { exact: true })).toBeVisible()
  await expect.poll(() => played(page)).toEqual([sentences[0].german])
  await page.clock.runFor(500)
  expect(await played(page)).toEqual([sentences[0].german])
  await page.clock.runFor(600)
  await expect.poll(() => played(page)).toEqual([sentences[0].german, sentences[0].german])
  await page.clock.runFor(3000)
  expect(await played(page)).toHaveLength(2)

  // On the next sentence, a click on listen during the pause replaces the waiting repeat.
  await page.getByRole('button', { name: /I said it/ }).click()
  await expect(page.getByText(sentences[1].german, { exact: true })).toBeVisible()
  await page.clock.runFor(100)
  await expect.poll(async () => (await played(page)).length).toBe(3)
  await page.getByRole('button', { name: 'Listen' }).click()
  await page.clock.runFor(100)
  await page.clock.runFor(3000)
  // The automatic reading, then the click. The waiting repeat was dropped.
  await expect.poll(async () => (await played(page)).slice(2)).toEqual([sentences[1].german, sentences[1].german])
  await page.clock.runFor(3000)
  expect(await played(page)).toHaveLength(4)
})

test('a wrong answer is marked word by word and comes back soon', async ({ page }) => {
  await open(page)
  const sentences = await course(page)
  await toFirstTest(page)

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

test('a whole lesson: many new sentences, every one tested, then a summary', async ({ page }) => {
  test.setTimeout(240_000)
  const problems = watchConsole(page)
  await open(page)
  const byEnglish = new Map((await course(page)).map((s) => [s.english, s.german]))
  await page.getByRole('button', { name: "Start today's lesson" }).click()

  let cards = 0
  while (cards < 400) {
    if (await page.getByText('Lesson done').isVisible()) break
    await answerCorrectly(page, byEnglish)
    // About 25 seconds per card, so the lesson runs out on its own clock.
    await page.clock.fastForward(25_000)
    cards++
  }
  await expect(page.getByText('Lesson done')).toBeVisible()
  const p = await progress(page)
  expect(p.lesson).toBeNull()
  expect(p.history).toHaveLength(1)
  expect(p.history[0].introduced).toBeGreaterThanOrEqual(10)
  expect(p.history[0].activeMs).toBeGreaterThanOrEqual(29 * MIN)
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
  expect(left).toBeGreaterThanOrEqual(26)
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
        course: 2,
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

test('a new sentence shows its new word underlined', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: "Start today's lesson" }).click()
  await expect(page.getByText('New sentence')).toBeVisible()
  const word = await page.evaluate(async () => (await (await fetch('/sentences/000.json')).json())[0][4] as string)
  await expect(page.locator('main p[lang="de"] .underline')).toHaveText(new RegExp(`^${word}$`, 'i'))
})

test('progress from the first course moves over, keeping an open lesson and its time', async ({ page }) => {
  await fakeVoice(page)
  await page.clock.install({ time: START })
  const legacy = await (await page.request.get('/sentences/legacy-v1.json')).json()
  // Course 1 positions 0 and 1 learned, and a lesson open with 19 minutes used: 41 of the old 60 left.
  const card = { due: START.getTime() + 86_400_000, stability: 3, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 2, lapses: 0, state: 2, last_review: START.getTime() - 60_000, introduced: START.getTime() - 20 * MIN }
  const old = {
    version: 2,
    next: 2,
    cards: { 0: card, 1: card },
    lesson: { started: START.getTime() - 25 * MIN, clock: { activeMs: 19 * MIN, lastActive: null }, introduced: [0, 1], firstTry: { 0: true, 1: true }, passes: {}, sinceNew: 0 },
    history: [],
    accepted: {},
  }
  await page.addInitScript((data) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('satz.v2', data)
      sessionStorage.setItem('seeded', '1')
    }
  }, JSON.stringify(old))
  // Opened the next morning: the lesson still carries on.
  await page.clock.setSystemTime(START.getTime() + 15 * 3_600_000)
  await page.goto('/')
  await expect(page.getByRole('button', { name: /^Continue lesson/ })).toContainText('11:00 left')
  await expect(page.locator('dd').first()).toHaveText('2')
  const p = await progress(page)
  expect(p.course).toBe(2)
  const keys = Object.keys(p.cards).map(Number)
  // Each kept sentence sits at its new position, or as an extra if the new course does not have it.
  for (const [i, row] of legacy.slice(0, 2).entries()) {
    const target = row[0] >= 0 ? row[0] : keys.find((k) => k < 0 && p.extra[k].tatoebaId === row[1])
    expect(keys, `course 1 sentence ${i}`).toContain(target)
  }
  expect(p.lesson.clock.activeMs).toBe(19 * MIN)
})

test('a new word shows its dictionary note', async ({ page }) => {
  await open(page)
  const [word, note] = await page.evaluate(async () => {
    const rows = await (await fetch('/sentences/000.json')).json()
    const glosses = await (await fetch('/sentences/glosses.json')).json()
    return [rows[0][4], glosses[rows[0][4]]] as [string, [string, string, string]]
  })
  expect(note, `a note for ${word}`).toBeTruthy()
  await page.getByRole('button', { name: "Start today's lesson" }).click()
  await expect(page.getByText(`: ${note[2]}`, { exact: false })).toBeVisible()
})

test('the progress page shows words learned, minutes and the memory model', async ({ page }) => {
  const problems = watchConsole(page)
  await open(page)
  await page.getByRole('button', { name: "Start today's lesson" }).click()
  await next(page)
  await next(page)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText(/tuned to your memory after 200 answers/)).toBeVisible()
  await page.getByRole('button', { name: 'See progress' }).click()
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible()
  await expect(page.locator('dd').first()).toHaveText('2')
  await expect(page.getByRole('img', { name: /Minutes studied/ })).toBeVisible()
  await expect(page.getByText('Your memory model')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('button', { name: /lesson/ })).toBeVisible()
  expect(problems).toEqual([])
})

test('after enough answers, reviews are tuned to a fitted model', async ({ page }) => {
  await fakeVoice(page)
  await page.clock.install({ time: START })
  // The preview server has no /api/optimize, so answer it here.
  let posted: { reviews: unknown[] } | null = null
  await page.route('**/api/optimize', async (route) => {
    posted = route.request().postDataJSON()
    await route.fulfill({ json: { parameters: Array.from({ length: 21 }, (_, i) => [0.2, 1.2, 3, 16, 7, 0.5, 1.6, 0.01, 1.5, 0.15, 1, 1.9, 0.11, 0.3, 2.3, 0.2, 3, 0.5, 0.6, 0.2, 0.1][i]), logLoss: 0.3, defaultLogLoss: 0.4, reviews: 250 } })
  })
  const reviews = Array.from({ length: 250 }, (_, i) => [i % 50, START.getTime() - (250 - i) * 3_600_000, i % 7 === 0 ? 1 : 3])
  await page.addInitScript((data) => localStorage.setItem('satz.v2', data), JSON.stringify({ version: 2, course: 2, next: 0, cards: {}, lesson: null, history: [], accepted: {}, extra: {}, reviews }))
  await page.goto('/')
  await expect(page.getByText(/tuned to your memory, from 250 answers, 25% more accurate/)).toBeVisible()
  expect(posted!.reviews).toHaveLength(250)
  expect((await progress(page)).model.parameters).toHaveLength(21)
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
