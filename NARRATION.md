# ElevenLabs narration

The API key is used only by the local generation script. It is never sent to the browser or written into generated files.

1. Copy `.env.example` to `.env` and enter `ELEVENLABS_API_KEY`. The `.env` file is ignored by Git.
2. List the studio-quality voices available to the account:

   ```powershell
   node scripts/generate-elevenlabs.js --list-voices
   ```

3. Copy the chosen licensed British male voice ID into `ELEVENLABS_VOICE_ID` in `.env`.
4. Generate the narration:

   ```powershell
   node scripts/generate-elevenlabs.js
   ```

To inspect segment sizes and see which interrupted segments are already cached without making a paid API call, run:

```powershell
node scripts/generate-elevenlabs.js --plan
```

The default model is `eleven_v3` for expressive delivery. Set `ELEVENLABS_MODEL_ID=eleven_multilingual_v2` for the most stable long-form delivery.

Generation produces MP3 sections under `audio/`, a readable `audio/narration.json`, and the browser-ready `narration-data.js`. Completed calls are cached by voice, model, text, and voice settings so an interrupted rerun does not regenerate unchanged sections.

When generated narration is present, the interface uses it automatically and synchronizes every highlighted word from ElevenLabs character timings. Browser speech remains the fallback when generated narration is absent or does not match the current story text.

## Repairing an unstable segment

`eleven_v3` occasionally improvises speech that is not in the text or reads `[bracketed]` words as audio tags; the word highlight then drifts for the rest of that segment. `--plan` marks such segments as `unstable`. Regenerate only those segments, keeping the others and their cache, with the steadier model and the same chunk boundaries:

```powershell
node scripts/generate-elevenlabs.js --only=6,7 --model=eleven_multilingual_v2 --chunk-limit=4200
```

The manifest is rewritten with the repaired segments in place; the browser picks it up on reload.
