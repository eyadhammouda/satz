# Satz

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/desktop-dark.png">
    <img src="docs/desktop-light.png" alt="Satz on a MacBook, marking Tomaten where the Austrian answer is Paradeiser" width="820">
  </picture>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/today-dark.png">
    <img src="docs/today-light.png" alt="Today screen with 12 sentences due" width="260">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/review-dark.png">
    <img src="docs/review-light.png" alt="Review screen marking a wrong word" width="260">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/library-dark.png">
    <img src="docs/library-light.png" alt="Library with every sentence, when it is due, and a listen button" width="260">
  </picture>
</p>

Servus! Satz is a quiet web app for memorising German sentences, the Austrian way. See the English, type the German from memory, hear it read aloud in an Austrian voice, and let spaced review bring each sentence back before you forget it. Paradeiser, not Tomaten.

Live at [satz-app.vercel.app](https://satz-app.vercel.app). Private: only the owner can sign in.

## Run it

```sh
npm install
npm run dev
```

## How it works

- **Add** sentences as you watch. German, Enter, English, Enter.
- **Today** shows what is due. A correct answer pushes a sentence further out (1, 3, 7, 14, 30, then 60 days). A miss brings it back tomorrow.
- **Library** holds everything, with search, edit, export and import.
- **Listen** to any sentence with one click: while you type it, in the library, and after each answer.

Your sentences stay in your browser. Use Export now and then to keep a backup.

The live site is private. Sign-in uses Google and lets in one email address, set in Vercel as `ALLOWED_EMAIL`. Sentences are read aloud by Chris, an Austrian ElevenLabs voice (set `ELEVENLABS_VOICE_ID` to pick another), and fall back to the browser's German voice when that is not available.

## Test

```sh
npm test
npm run test:e2e
```

## Screenshots

```sh
npm run screenshots
```

Fills the app with Austrian example sentences and writes every image in `docs/`, including the MacBook shot.

## License

MIT
