# Decisions

- 2026-09-17 — Visuals are driven by a beat list anchored to exact phrases of the
  story (`visuals.js`), not by the eight chapter markers. Sets crossfade; numeric
  parameters ease. Chapter markers remain only for the HUD and era navigation.
- 2026-09-17 — Generated narration is committed (`audio/*.mp3`,
  `narration-data.js`) so the site is self-contained; the ElevenLabs response
  cache (`audio/.cache/`) is not. Segments 6 and 7 of the current narration were
  produced by `eleven_v3` with improvised speech and are flagged `unstable` by
  `scripts/generate-elevenlabs.js --plan`; regenerate them with `--only=6,7
  --model=eleven_multilingual_v2 --chunk-limit=4200`.
- 2026-09-17 — Hosted as a plain nginx container (non-root, port 8080), no
  build step; assets are cache-busted with `?v=` query strings.
