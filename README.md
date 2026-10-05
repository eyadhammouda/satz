# Satz

A quiet web app for memorising German sentences. See the English, type the German from memory, and let spaced review bring each sentence back before you forget it.

Live at [satz-app.vercel.app](https://satz-app.vercel.app).

## Run it

```sh
npm install
npm run dev
```

## How it works

- **Add** sentences as you watch. German, Enter, English, Enter.
- **Today** shows what is due. A correct answer pushes a sentence further out (1, 3, 7, 14, 30, then 60 days). A miss brings it back tomorrow.
- **Library** holds everything, with search, edit, export and import.

Your sentences stay in your browser. There is no account and no server. Use Export now and then to keep a backup.

## Test

```sh
npm test
npm run test:e2e
```

## License

MIT
