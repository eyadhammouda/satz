# Satz

A private, single-user web app that teaches German through sentences in one-hour lessons. The owner opens it, presses "Start today's lesson" and studies. The app chooses every sentence; the learner adds nothing.

Live: https://satz-app.vercel.app (Vercel project `satz`, team `eyadsahers-projects`). Repo: https://github.com/eyadhammouda/satz (public).

## How it behaves

- **Home** (`src/screens/Home.tsx`): one button. It reads "Start today's lesson", or "Continue lesson, mm:ss left" when an hour is unfinished on the same study day. Also shows stats (learned, new today, minutes today), Export, Import, Sign out, and the Tatoeba credit.
- **Lesson** (`src/screens/Lesson.tsx`): a full-screen loop with a 60-minute bar and countdown.
  - **New sentence card:** English, German and audio (played automatically). The learner says it aloud twice, then Enter.
  - **Test card:** English shown. The learner types the German, Enter checks it.
  - **After checking:** the correct sentence is shown with a word diff and played aloud. Enter continues. "I was right" (2) accepts the typed answer for good; "I guessed" (1) fails a lucky pass.
  - **Listen variant:** mature reviews (interval of 21 days or more) alternate with dictation, where the learner types what they hear.
- **The hour** (`src/lib/timer.ts`) counts active study only. Every key press or tap pings the clock. Gaps longer than 2 minutes, hidden tabs and closing the lesson do not count. When the hour is up, the current card finishes and the summary shows. A lesson left unfinished on an earlier study day is closed and a fresh hour starts. Several lessons a day are fine.
- **Study day** (`src/lib/day.ts`): runs 04:00 to 04:00 local time.

## Learning method (`src/lib/lesson.ts`, see `nextStep`)

Based on research into the testing effect, the production effect, spacing, and FSRS benchmarks. Constants are at the top of the file.
- New sentences are shown before testing, never guessed. Their FSRS learning steps are 1m then 10m, and relearning is 10m. At most 6 are being learned at once.
- Due learning cards always come first. Due reviews are ordered by lowest FSRS retrievability.
- New cards start after a 10-minute warm-up when reviews are due, then follow every 3 reviews. They stop at 45 minutes, or earlier if due reviews would not fit in the remaining time, so backlogs clear first. The soft cap is 25 new per lesson, the hard cap 40.
- The last minutes give each sentence learned this lesson a "final" pass, which only reschedules a miss. With nothing left to do, more final passes follow.
- Grading is binary: pass is FSRS Good, miss is Again. The scheduler is `ts-fsrs` with retention 0.9 and fuzz on.
- Checking (`src/lib/check.ts`, `checkAnswer`):
  - **exact:** matches after normalisation.
  - **close:** differs only in case, ae/oe/ue/ss for umlauts, or commas. Counts as a pass.
  - **wrong:** anything else. Answers are checked against the sentence, its Tatoeba alternatives, and answers the learner accepted.
- A 30-day simulation at about 30s per card gives about 25 new sentences on day 1, settling at about 16 a day as reviews grow, with no backlog.

## Data

- **Course:** `public/sentences/NNN.json`, 40 chunks of 500, easiest first, plus `index.json`. Each row is `[tatoebaId, german, english, author, alternatives?]`. `src/lib/course.ts` lazy-loads chunks. The file is built by `scripts/build-sentences.py` from Tatoeba exports:
  - Filters: native German authors only, 3 to 10 words, no names (the Tom/Maria sentences), no dark topics, no rare words.
  - Ranking: by word frequency (hermitdave FrequencyWords).
  - Rebuilding reorders sentences, which would break stored progress (it keys on course position). Don't rebuild for a live learner without a migration.
- **Progress:** localStorage key `satz.v2`, type `Progress` in `lesson.ts`, parsed and validated in `src/lib/progress.ts`. It holds cards keyed by course position, `next` (the next position to introduce), the open lesson, history and accepted answers. Export/Import write and read this JSON.
- **Licence:** sentences are CC BY 2.0 FR. Keep the Tatoeba credit in the UI and README, and keep ids and authors in the data.

## Server (Vercel)

- `middleware.ts` locks everything behind a signed session cookie. Only `/login`, the icons and `/api/auth/*` are public.
- `api/auth/*` is Google OAuth with PKCE, state and nonce, using `jose` (HS256 session, 60 days). Only `ALLOWED_EMAIL` gets in.
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
