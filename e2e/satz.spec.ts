import { expect, test, type Page } from '@playwright/test'

const STARTERS = 9

// 2026-10-05 15:00 local time.
const DAY_ONE = new Date(2026, 9, 5, 15, 0)
const DAY_TWO = new Date(2026, 9, 6, 15, 0)

/** Fails the test on any console warning or error. */
function watchConsole(page: Page) {
  const problems: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error') problems.push(msg.text())
  })
  page.on('pageerror', (err) => problems.push(err.message))
  return problems
}

async function open(page: Page, at = DAY_ONE) {
  await page.clock.setFixedTime(at)
  await page.goto('/')
}

async function stored(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('satz.v1') ?? 'null'))
}

test('first launch seeds nine sentences and offers practice', async ({ page }) => {
  const problems = watchConsole(page)
  await open(page)
  await expect(page.getByRole('heading', { name: 'All done for today' })).toBeVisible()
  await expect(page.getByRole('button', { name: "Practise today's sentences (9)" })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start review' })).toHaveCount(0)
  await expect(page.getByText('9 sentences')).toBeVisible()
  await expect(page.getByText('9 of 15 added today')).toBeVisible()

  await page.getByRole('tab', { name: 'Library' }).click()
  await expect(page.locator('main li')).toHaveCount(STARTERS)
  await expect(page.locator('main li').first()).toContainText('Ich werde es selbst tun')
  await expect(page.locator('main li').first()).toContainText('Tomorrow')

  const data = await stored(page)
  expect(data.version).toBe(1)
  expect(data.sentences).toHaveLength(STARTERS)
  expect(data.sentences[0]).toMatchObject({ createdDay: '2026-10-05', box: 0, dueDay: '2026-10-06' })
  expect(problems).toEqual([])
})

test('adding sentences takes only the keyboard and has no daily limit', async ({ page }) => {
  const problems = watchConsole(page)
  await open(page)
  await page.getByRole('tab', { name: 'Add' }).click()
  const german = page.getByLabel('German')
  await expect(german).toBeFocused()

  for (let i = 1; i <= 20; i++) {
    await page.keyboard.type(`Satz Nummer ${i}`)
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('English')).toBeFocused()
    await page.keyboard.type(`Sentence number ${i}`)
    await page.keyboard.press('Enter')
    await expect(german).toBeFocused()
    await expect(german).toHaveValue('')
  }

  const list = page.locator('main li')
  await expect(list).toHaveCount(STARTERS + 20)
  await expect(list.first()).toContainText('Satz Nummer 20')
  await expect(page.getByText(`Added today (${STARTERS + 20})`)).toBeVisible()

  await page.getByRole('button', { name: 'Delete "Satz Nummer 20"' }).click()
  await expect(list).toHaveCount(STARTERS + 19)

  await page.getByRole('tab', { name: 'Today' }).click()
  await expect(page.getByText('28 added today')).toBeVisible()
  expect(problems).toEqual([])
})

test('empty fields and duplicates are refused', async ({ page }) => {
  await open(page)
  await page.getByRole('tab', { name: 'Add' }).click()
  await expect(page.getByLabel('German')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('German')).toHaveAttribute('aria-invalid', 'true')

  await page.keyboard.type('Ich bin mir ziemlich sicher.')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('English')).toBeFocused()
  await page.keyboard.type('I am pretty sure')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Already in your library')).toBeVisible()
  expect((await stored(page)).sentences).toHaveLength(STARTERS)
})

test('practice mode leaves every box and dueDay unchanged', async ({ page }) => {
  await open(page)
  const before = await stored(page)
  await page.getByRole('button', { name: "Practise today's sentences (9)" }).click()
  await expect(page.getByText('1 of 9')).toBeVisible()
  const input = page.getByPlaceholder('Type the German')
  await expect(input).toBeFocused()

  for (let i = 0; i < STARTERS; i++) {
    await page.keyboard.type('falsch')
    await page.keyboard.press('Enter')
    await expect(input).toHaveAttribute('readonly', '')
    await page.keyboard.press('2')
  }
  await expect(page.getByText('First try correct')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  expect(await stored(page)).toEqual(before)
})

test('next study day: due sentences, grading and repeats', async ({ page }) => {
  const problems = watchConsole(page)
  await open(page)
  await open(page, DAY_TWO)
  await expect(page.getByText('due', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading')).toContainText('9')
  await page.getByRole('button', { name: 'Start review' }).click()

  const input = page.getByPlaceholder('Type the German')
  await expect(input).toHaveAttribute('lang', 'de')
  await expect(input).toHaveAttribute('autocomplete', 'off')
  await expect(input).toHaveAttribute('autocorrect', 'off')
  await expect(input).toHaveAttribute('autocapitalize', 'off')
  await expect(input).toHaveAttribute('spellcheck', 'false')

  const englishToGerman = Object.fromEntries(
    (await stored(page)).sentences.map((s: { english: string; german: string }) => [s.english, s.german]),
  )
  const prompt = page.locator('main > p').first()

  // First card: exact answer.
  const firstEnglish = (await prompt.textContent())!
  await page.keyboard.type(englishToGerman[firstEnglish])
  await page.keyboard.press('Enter')
  await expect(page.getByText('Correct', { exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByText('2 of 9')).toBeVisible()

  // Second card: wrong answer, graded Missed.
  const missedEnglish = (await prompt.textContent())!
  await page.keyboard.type('ganz falsch')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /Missed/ })).toBeVisible()
  await page.keyboard.press('1')

  // Remaining cards: reveal with an empty answer, then Got it.
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: /Got it/ })).toBeVisible()
    await page.keyboard.press('2')
  }

  // The missed sentence comes back at the end of the session.
  await expect(prompt).toHaveText(missedEnglish)
  await page.keyboard.type(englishToGerman[missedEnglish])
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')

  await expect(page.getByText('Reviewed')).toBeVisible()
  await expect(page.locator('dd').nth(0)).toHaveText('9')
  await expect(page.locator('dd').nth(1)).toHaveText('8')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'All done for today' })).toBeVisible()

  const byEnglish = Object.fromEntries(
    (await stored(page)).sentences.map((s: { english: string }) => [s.english, s]),
  )
  expect(byEnglish[firstEnglish]).toMatchObject({ box: 1, dueDay: '2026-10-09', correct: 1, lastReviewedDay: '2026-10-06' })
  expect(byEnglish[missedEnglish]).toMatchObject({ box: 0, dueDay: '2026-10-07', missed: 1, correct: 0 })
  expect(problems).toEqual([])
})

test('closing a review keeps the grades already given', async ({ page }) => {
  await open(page)
  await open(page, DAY_TWO)
  await page.getByRole('button', { name: 'Start review' }).click()
  await page.keyboard.press('Enter')
  await page.keyboard.press('2')
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('heading')).toContainText('8')
})

test('a lowercase answer is not exact and the wrong word is marked', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('satz.v1')!)
    data.sentences = data.sentences.filter((s: { german: string }) => s.german === 'Lass mich mal sehen')
    localStorage.setItem('satz.v1', JSON.stringify(data))
  })
  await page.reload()
  await page.getByRole('button', { name: "Practise today's sentences (1)" }).click()
  await page.keyboard.type('lass mich mal sehen')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Correct', { exact: true })).toHaveCount(0)
  await expect(page.locator('.text-destructive')).toHaveText('wrong: lass')
  await expect(page.locator('.underline')).toHaveText('missing: Lass')
  await expect(page.getByRole('button', { name: /Missed/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Got it/ })).toBeVisible()
})

test('studyDay at 02:00 belongs to the previous calendar date', async ({ page }) => {
  await open(page, new Date(2026, 9, 6, 2, 0))
  const data = await stored(page)
  expect(data.sentences[0].createdDay).toBe('2026-10-05')
  expect(data.sentences[0].dueDay).toBe('2026-10-06')
})

test('library search, edit and delete', async ({ page }) => {
  await open(page)
  await page.getByRole('tab', { name: 'Library' }).click()
  await page.getByRole('searchbox', { name: 'Search' }).fill('schnee')
  await expect(page.locator('main li')).toHaveCount(1)
  await page.getByRole('searchbox', { name: 'Search' }).fill('LINZ')
  await expect(page.locator('main li')).toHaveCount(1)

  const before = (await stored(page)).sentences.find((s: { german: string }) => s.german.includes('Linz'))
  await page.locator('main li button').first().click() // the row, not its Listen button
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('German').fill('In Linz hat es gestern geschneit')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toHaveCount(0)
  const after = (await stored(page)).sentences.find((s: { id: string }) => s.id === before.id)
  expect(after).toEqual({ ...before, german: 'In Linz hat es gestern geschneit' })

  await page.locator('main li button').first().click() // the row, not its Listen button
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('searchbox', { name: 'Search' }).fill('')
  await expect(page.locator('main li')).toHaveCount(STARTERS - 1)
})

test('listen is one click away in add, library, edit and review', async ({ page }) => {
  const problems = watchConsole(page)
  // Record what would play. The preview server has no /api/speak, so after the first
  // sentence the app falls back to the browser voice: record both.
  await page.addInitScript(() => {
    const played: string[] = []
    Object.assign(window, { played })
    HTMLMediaElement.prototype.play = function () {
      played.push(new URL(this.src).searchParams.get('text') ?? '')
      return Promise.resolve()
    }
    const fakeVoice = { lang: 'de-DE', localService: true, name: 'Test', voiceURI: 'test', default: true }
    speechSynthesis.getVoices = () => [fakeVoice as SpeechSynthesisVoice]
    // The real setter only accepts real voices.
    Object.defineProperty(SpeechSynthesisUtterance.prototype, 'voice', { set() {}, get: () => null })
    speechSynthesis.speak = (utterance) => {
      played.push(utterance.text)
    }
  })
  await open(page)
  const spoken = () => page.evaluate(() => (window as unknown as { played: string[] }).played)
  const listened = async (text: string) => {
    await expect.poll(async () => (await spoken()).at(-1)).toBe(text)
  }

  // While typing: the German field keeps focus after listening.
  await page.getByRole('tab', { name: 'Add' }).click()
  const german = page.getByLabel('German')
  const fieldListen = page.locator('form').getByRole('button', { name: 'Listen' })
  await expect(fieldListen).toHaveCount(0)
  await german.fill('Wie geht es dir')
  await german.focus()
  await fieldListen.click()
  await listened('Wie geht es dir')
  await expect(german).toBeFocused()

  // Added today rows.
  await page.keyboard.press('Enter')
  await page.keyboard.type('How are you')
  await page.keyboard.press('Enter')
  await page.locator('main li').first().getByRole('button', { name: 'Listen' }).click()
  await listened('Wie geht es dir')

  // Library rows play without opening the dialog.
  await page.getByRole('tab', { name: 'Library' }).click()
  const row = page.locator('main li').filter({ hasText: 'Linz' })
  const text = (await row.locator('[lang="de"]').textContent()) ?? ''
  await row.getByRole('button', { name: 'Listen' }).click()
  await listened(text)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The edit dialog reads the text as it is being edited.
  await row.locator('button').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('German').fill('In Linz schneit es')
  await dialog.getByRole('button', { name: 'Listen' }).click()
  await listened('In Linz schneit es')
  await page.keyboard.press('Escape')

  // Review answers.
  await page.getByRole('tab', { name: 'Today' }).click()
  await page.getByRole('button', { name: /Practise/ }).click()
  await page.keyboard.press('Enter')
  const answer = (await page.locator('main p[lang="de"]').first().textContent()) ?? ''
  await page.getByRole('button', { name: 'Listen' }).click()
  await listened(answer)
  expect(problems).toEqual([])
})

test('an emptied library stays empty after reload', async ({ page }) => {
  await open(page)
  await page.evaluate(() => localStorage.setItem('satz.v1', JSON.stringify({ version: 1, sentences: [] })))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Add your first sentences' })).toBeVisible()
  await page.getByRole('button', { name: 'Add sentences' }).click()
  await expect(page.getByLabel('German')).toBeFocused()
})

test('unreadable storage starts with the seed and does not crash', async ({ page }) => {
  await page.clock.setFixedTime(DAY_ONE)
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('satz.v1', '{not json')
      sessionStorage.setItem('seeded', '1')
    }
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: "Practise today's sentences (9)" })).toBeVisible()
})

test('data survives reload, and export then import restores everything', async ({ page, browser }) => {
  await open(page)
  await page.getByRole('tab', { name: 'Add' }).click()
  await expect(page.getByLabel('German')).toBeFocused()
  await page.keyboard.type('Das ist neu')
  await page.keyboard.press('Enter')
  await page.keyboard.type('This is new')
  await page.keyboard.press('Enter')
  await page.reload()
  await page.getByRole('tab', { name: 'Library' }).click()
  await expect(page.locator('main li')).toHaveCount(STARTERS + 1)
  const original = await stored(page)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('satz-backup-2026-10-05.json')
  const path = test.info().outputPath('backup.json')
  await download.saveAs(path)

  const fresh = await browser.newContext()
  const other = await fresh.newPage()
  await other.clock.setFixedTime(DAY_ONE)
  await other.goto('/')
  await other.evaluate(() => localStorage.setItem('satz.v1', JSON.stringify({ version: 1, sentences: [] })))
  await other.reload()
  await other.getByRole('tab', { name: 'Library' }).click()
  const chooserPromise = other.waitForEvent('filechooser')
  await other.getByRole('button', { name: 'Import' }).click()
  await (await chooserPromise).setFiles(path)
  await expect(other.getByText('10 sentences imported')).toBeVisible()
  await expect(other.locator('main li')).toHaveCount(STARTERS + 1)

  const restored = await stored(other)
  const sort = (list: { id: string }[]) => [...list].sort((a, b) => a.id.localeCompare(b.id))
  expect(sort(restored.sentences)).toEqual(sort(original.sentences))
  await fresh.close()
})

test('usable at 360px wide in dark mode', async ({ page }) => {
  const problems = watchConsole(page)
  await page.setViewportSize({ width: 360, height: 740 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await open(page)
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).not.toBe('rgb(255, 255, 255)')
  for (const tab of ['Today', 'Add', 'Library']) {
    await page.getByRole('tab', { name: tab }).click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  }
  await page.getByRole('tab', { name: 'Today' }).click()
  await page.getByRole('button', { name: /Practise/ }).click()
  await page.keyboard.type('Ich bin mir nicht so sicher wie du denkst')
  await page.keyboard.press('Enter')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const minHeight = await page.getByRole('button', { name: /Got it/ }).evaluate((el) => el.getBoundingClientRect().height)
  expect(minHeight).toBeGreaterThanOrEqual(44)
  expect(problems).toEqual([])
})
