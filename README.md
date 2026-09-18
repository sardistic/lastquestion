# The Last Question — an illustrated reading

Isaac Asimov's *The Last Question*, read aloud with a synchronised transcript and a
canvas animation that follows the text beat by beat.

Static site: `index.html`, `styles.css`, `script.js` (playback, narration sync,
transcript, reader), `visuals.js` (beat engine and illustrated scene sets),
`story-data.js` (text), `narration-data.js` + `audio/*.mp3` (generated narration).

- Open `index.html` directly, or serve the directory with any static server.
- `?word=N` jumps to a word index; `?era=N` to a chapter.
- Narration generation: see `NARRATION.md`.

## Production

Built as an nginx container (`Dockerfile`, `nginx.conf`, listens on 8080) and
deployed behind the house reverse proxy. Bump the `?v=` cache-buster on the
asset tags in `index.html` when shipping changes to CSS/JS.
