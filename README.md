# Satz

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/desktop-test-dark.png">
    <img src="docs/desktop-test-light.png" alt="A review in Safari, marking the one wrong word" width="820">
  </picture>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/desktop-home-dark.png">
    <img src="docs/desktop-home-light.png" alt="Home in Safari: one button to start today's lesson" width="405">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/desktop-intro-dark.png">
    <img src="docs/desktop-intro-light.png" alt="A new sentence, shown with its English and audio" width="405">
  </picture>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/phones-dark.png">
    <img src="docs/phones-light.png" alt="Three iPhones: home, a new sentence, and a review" width="820">
  </picture>
</p>

Satz teaches German one sentence at a time, in one-hour lessons. Press one button and study. The app chooses the sentences, reads them aloud in an Austrian voice, and brings each one back just before you would forget it.

Live at [satz-app.vercel.app](https://satz-app.vercel.app). Private: only the owner can sign in.

## How a lesson works

- **New sentences** come from a course of 20,000, easiest first. You see the English, the German and hear it, then say it aloud.
- **Tests** show the English. Say the German, type it, and the answer is checked word by word. Typed umlauts (ae, oe, ue, ss) and capital slips still pass.
- **Repeats** follow the research on spaced retrieval: a new sentence is tested after about 1 minute and 10 minutes, then scheduled by [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) over days and weeks.
- **One hour:** reviews come first, new sentences mix in after about 10 minutes and stop at 45, and the last minutes go over what you learned. The clock only counts active study and pauses when you step away. Start another hour whenever you like.

Progress stays in your browser. Use Export now and then to keep a backup.

## Run it

```sh
npm install
npm run dev
```

## Test

```sh
npm test
npm run test:e2e
```

## Sentences

```sh
python3 scripts/build-sentences.py
```

Rebuilds `public/sentences/` from the latest [Tatoeba](https://tatoeba.org) exports.

## Screenshots

```sh
npm run screenshots
```

Needs Node 22 and [cutaway](https://github.com/half144/cutaway) in `~/.cutaway`.

## Credits

Sentences and translations are from [Tatoeba](https://tatoeba.org), licensed [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/). Each sentence keeps its Tatoeba id and author in `public/sentences/`. Difficulty uses the [FrequencyWords](https://github.com/hermitdave/FrequencyWords) German list (CC BY-SA 4.0) at build time only.

## License

Code: MIT. Sentence data: CC BY 2.0 FR, as above.
