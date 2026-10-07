# Satz

A private, single-user web app that teaches German through sentences in 30-minute lessons. The owner opens it, presses "Start today's lesson" and studies. The app chooses every sentence; the learner adds nothing.

Live: https://satz-app.vercel.app (Vercel project `satz`, team `eyadsahers-projects`). Repo: https://github.com/eyadhammouda/satz (public).

## How it behaves

- **Progress** (`src/screens/Progress.tsx`, numbers from `src/lib/stats.ts`): words learned, share remembered now (FSRS retrievability), days in a row, minutes over 14 days, memory strength bands, reviews coming up, first-try accuracy, and the memory model's status. Opened from "See progress" on Home.
- **Home** (`src/screens/Home.tsx`): one button. It reads "Start today's lesson", or "Continue lesson, mm:ss left" when a lesson is unfinished. Also shows stats (learned, new today, minutes today), Export, Import, Sign out, and the Tatoeba credit.
- **Lesson** (`src/screens/Lesson.tsx`): a full-screen loop with a 30-minute bar and countdown.
  - **New sentence card:** English, German with its new word underlined, a dictionary note for that word (base form with der/die/das, form, meaning), and audio played twice a second apart. The learner says it aloud twice, then Enter.
  - **Test card:** English shown. The learner types the German, Enter checks it.
  - **After checking:** the correct sentence is shown with a word diff and played aloud, with a prompt to say it once more. Enter continues. "I was right" (2) accepts the typed answer for good; "I guessed" (1) fails a lucky pass.
  - **Listen variant:** mature reviews (interval of 21 days or more) alternate with dictation, where the learner types what they hear.
- **The lesson clock** (`src/lib/timer.ts`, `LESSON_MS` = 30 minutes) counts active study only. Every key press or tap pings the clock. Gaps longer than 2 minutes, hidden tabs and closing the lesson do not count. When time is up, the current card finishes and the summary shows. An unfinished lesson always carries on with the time it has left, even on a later day. Several lessons a day are fine.
- **Study day** (`src/lib/day.ts`): runs 04:00 to 04:00 local time.

## Learning method (`src/lib/lesson.ts`, see `nextStep`)

Based on research into the testing effect, the production effect, spacing, and FSRS benchmarks. Constants are at the top of the file.
- New sentences are shown before testing, never guessed. Their FSRS learning steps are 1m then 10m, and relearning is 10m. At most 6 are being learned at once.
- Due learning cards always come first. Due reviews are ordered by lowest FSRS retrievability.
- New cards start after a 5-minute warm-up when reviews are due, then follow every 3 reviews. They stop at 20 minutes (so the 10-minute step fits), or earlier if due reviews would not fit in the remaining time, so backlogs clear first. The soft cap is 15 new per lesson, the hard cap 22.
- The last minutes give each sentence learned this lesson a "final" pass, which only reschedules a miss. With nothing left to do, more final passes follow.
- Grading is binary: pass is FSRS Good, miss is Again. The scheduler is `ts-fsrs` with retention 0.9 and fuzz on.
- Checking (`src/lib/check.ts`, `checkAnswer`):
  - **exact:** matches after normalisation.
  - **close:** differs only in case, ae/oe/ue/ss for umlauts, or commas. Counts as a pass.
  - **wrong:** anything else. Answers are checked against the sentence, its Tatoeba alternatives, and answers the learner accepted.
- **Personal memory model:** every graded answer is logged in `progress.reviews` ([position, time, 1 or 3]). Once there are 200, and then every 300 more and at most weekly (`src/lib/model.ts`), the app posts them to `api/optimize.ts`, which fits the 21 FSRS parameters with the official FSRS optimizer (`@open-spaced-repetition/binding`, Rust, about half a second). The fit is kept in `progress.model` only if it predicts the learner's answers better than the defaults (lower log loss), and `schedulerFor(progress)` uses it for all scheduling.
- A one-year simulation at 25 to 35 seconds per card gives about 15 new sentences on day 1, and about 1,500 to 2,000 sentences (the same number of new words) after a year, with no backlog.

## Data

- **Course (version 2):** `public/sentences/NNN.json`, chunks of 500, plus `index.json` (`version`, `total`, `chunk`). Each row is `[tatoebaId, german, english, author, newWord, alternatives?]`. `src/lib/course.ts` lazy-loads chunks. Built by `scripts/build-sentences.py` from Tatoeba exports:
  - Filters: native German authors only, 3 to 10 words, no names (the Tom/Maria sentences), no dark topics, no rare words, common volunteer mistakes ("dass ist").
  - English: prefers translations by native English speakers, avoiding archaic words.
  - Order ("i+1"): each sentence adds exactly one unknown word, the most frequent available first (hermitdave FrequencyWords), with near-identical neighbours kept apart. About 14,000 sentences, each teaching one word.
  - Changing the order is a new course version: bump `VERSION` in the script and `COURSE_VERSION` in `lesson.ts`, and add a migration like `migrateFromCourse1`.
- **Word notes:** `public/sentences/glosses.json`, `{ newWord: [base form with article, form, meaning] }`, built by `scripts/build-glosses.py` from English Wiktionary via kaikki.org (CC BY-SA 4.0). Covers about 91% of new words; a small hand list fixes the commonest words, where Wiktionary's first sense is a grammar note.
- **Migration from course 1** (the earlier difficulty-ordered course): `public/sentences/legacy-v1.json` maps each course 1 position to its new position, or -1 with the sentence text. `migrateFromCourse1` in `progress.ts` keeps every learned card and its schedule: at the new position if the sentence exists there, otherwise as an "extra" at a negative position (stored in `progress.extra`, served by `getSentence`). An open lesson keeps its clock. It runs on load (`useProgress`) and on Import.
- **Progress:** localStorage key `satz.v2`, type `Progress` in `lesson.ts`, parsed and validated in `src/lib/progress.ts`. It holds the course version, cards keyed by course position (negative for extras), `next` (positions already in `cards` are skipped), the open lesson, history, accepted answers, extras and the review log. Export/Import write and read this JSON.
- **Licence:** sentences are CC BY 2.0 FR. Keep the Tatoeba credit in the UI and README, and keep ids and authors in the data.

## Server (Vercel)

- `middleware.ts` locks everything behind a signed session cookie. Only `/login`, the icons and `/api/auth/*` are public.
- `api/auth/*` is Google OAuth with PKCE, state and nonce, using `jose` (HS256 session, 60 days). Only `ALLOWED_EMAIL` gets in.
- `api/optimize.ts` fits FSRS parameters to the posted review log (session required, 200 to 100,000 reviews).
- `api/speak.ts` is ElevenLabs text to speech. It uses model `eleven_v4`, the Austrian voice "Chris" by default (`ELEVENLABS_VOICE_ID` to override), and caches each sentence for a year. The browser voice is the fallback (`src/hooks/useGermanVoice.ts`).
- Environment variables (production): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL`, `SESSION_SECRET`, `ELEVENLABS_API_KEY`. None are in the repo; never commit secrets or the owner's email.

## Stack and commands

- Vite, React 19, TypeScript, Tailwind 4, shadcn/ui (radix), lucide icons, sonner. No router or state library.
- `npm run dev`, `npm test` (Vitest: lib, api, middleware), `npm run test:e2e` (Playwright on a production build, with a fake clock), `npm run lint` (oxlint), `npm run build`, `npm run screenshots` (README images, needs Node 22 and cutaway in `~/.cutaway`).
- Local Playwright: the cached Chromium may not match the Playwright version. Set `PW_CHROMIUM_PATH` to a Chromium binary under `~/Library/Caches/ms-playwright`.

## Working rules for this repo

- Design: quiet, Apple-like. One narrow column (560px max), system font, neutral greys, destructive red only for errors. Motion follows Emil Kowalski's rules: short ease-out, press scale, nothing on keyboard actions.
- No em or en dashes anywhere (code, docs, UI, commits).
- No co-author trailers on commits. Commit as `116634909+eyadhammouda@users.noreply.github.com`, never the work email.
- `main` is protected: work on a branch, open a PR, and merge (squash) once CI is green, then deploy (`vercel deploy --prod`). The owner wants this done without asking. Vercel is not linked to GitHub, so deploys are manual.
- npm on this machine goes through a company Artifactory. `package-lock.json` must only contain `https://registry.npmjs.org/` URLs, and CI fails otherwise. After installing, fix any new `resolved` lines by hand.
