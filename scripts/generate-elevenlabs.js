"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const AUDIO_DIR = path.join(ROOT, "audio");
const CACHE_DIR = path.join(AUDIO_DIR, ".cache");
const API_BASE = "https://api.elevenlabs.io";
loadDotEnv(path.join(ROOT, ".env"));
const apiKey = process.env.ELEVENLABS_API_KEY;
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : true];
}));

if (!apiKey) fail("Set ELEVENLABS_API_KEY in your environment before running this script.");

function fail(message) { console.error(`ElevenLabs: ${message}`); process.exit(1); }
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16); }

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

async function request(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { "xi-api-key": apiKey, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail.slice(0, 600)}`);
  }
  return response.json();
}

async function listVoices() {
  let data = await request("/v2/voices?page_size=100&sort=name&sort_direction=asc");
  if (!data.voices?.length) {
    const legacy = await request("/v1/voices");
    data = { voices: legacy.voices || [] };
  }
  const rows = data.voices.map((voice) => ({
    name: voice.name,
    voice_id: voice.voice_id,
    category: voice.category,
    labels: voice.labels || {},
    languages: (voice.verified_languages || []).map((item) => `${item.locale || item.language}${item.accent ? ` (${item.accent})` : ""}`).join(", ")
  }));
  if (!rows.length) {
    console.log("No voices are attached to this ElevenLabs account. Add a licensed voice from Voice Library, then rerun this command.");
    return;
  }
  console.table(rows);
}

function loadStory() {
  const source = fs.readFileSync(path.join(ROOT, "story-data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: "story-data.js" });
  return sandbox.window.STORY_TEXT;
}

function splitStory(text, limit = 4200) {
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (/\s/.test(text[cursor] || "")) cursor++;
    if (cursor >= text.length) break;
    const ceiling = Math.min(text.length, cursor + limit);
    let end = ceiling;
    if (ceiling < text.length) {
      const candidate = text.slice(cursor, ceiling);
      const sentenceMatches = [...candidate.matchAll(/[.!?]["')\]]*\s+/g)];
      const lastSentence = sentenceMatches.at(-1);
      if (lastSentence && lastSentence.index > limit * .58) end = cursor + lastSentence.index + lastSentence[0].length;
      else {
        const whitespace = candidate.lastIndexOf(" ");
        if (whitespace > limit * .58) end = cursor + whitespace + 1;
      }
    }
    const rawChunk = text.slice(cursor, end);
    const trimmed = rawChunk.trimEnd();
    chunks.push({ text: trimmed, charStart: cursor, charEnd: cursor + trimmed.length });
    cursor = end;
  }
  return chunks;
}

function wordTable(text) {
  return [...text.matchAll(/\S+/g)].map((match, index) => ({ index, text: match[0], start: match.index, end: match.index + match[0].length }));
}

/* eleven_v3 reads [square brackets] as audio tags. Blank them without changing character offsets. */
function speakableText(text) { return text.replace(/\[([^\]]*)\]/g, (match) => ` ${match.slice(1, -1)} `); }

/* Flags segments whose alignment cannot be a faithful reading: single words held for many seconds, long holes, or an implausible pace. */
function timingProblems(wordTimings) {
  const problems = [];
  for (let i = 0; i < wordTimings.length; i++) {
    const item = wordTimings[i], next = wordTimings[i + 1];
    if (item.end - item.start > 4) problems.push(`word ${item.wordIndex} is held for ${(item.end - item.start).toFixed(1)}s`);
    if (next && next.start - item.end > 4) problems.push(`${(next.start - item.end).toFixed(1)}s hole after word ${item.wordIndex}`);
  }
  const span = (wordTimings.at(-1)?.end || 0) - (wordTimings[0]?.start || 0);
  const pace = wordTimings.length / Math.max(1, span);
  if (pace < 1.7 || pace > 4) problems.push(`pace ${pace.toFixed(2)} words/s`);
  return problems;
}

function timingForChunk(chunk, alignment, globalWords) {
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const wordsInChunk = globalWords.filter((word) => word.start >= chunk.charStart && word.start < chunk.charEnd);
  return wordsInChunk.map((word) => {
    const localStart = Math.min(starts.length - 1, word.start - chunk.charStart);
    const localEnd = Math.min(ends.length - 1, word.end - chunk.charStart - 1);
    return { wordIndex: word.index, start: starts[localStart] ?? 0, end: ends[localEnd] ?? starts[localStart] ?? 0 };
  });
}

async function generate() {
  const voiceId = String(args.get("voice") || process.env.ELEVENLABS_VOICE_ID || "");
  if (!voiceId) fail("Set ELEVENLABS_VOICE_ID or pass --voice=<voice_id>. Run with --list-voices to inspect available voices.");
  const modelId = String(args.get("model") || process.env.ELEVENLABS_MODEL_ID || "eleven_v3");
  const text = loadStory();
  const globalWords = wordTable(text);
  const chunks = splitStory(text, Number(args.get("chunk-limit")) || (modelId === "eleven_v3" ? 4200 : 8500));
  const only = new Set(String(args.get("only") || "").split(",").filter(Boolean).map((n) => Number(n) - 1));
  const existing = fs.existsSync(path.join(AUDIO_DIR, "narration.json")) ? JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, "narration.json"), "utf8")) : null;
  if (only.size && !existing) fail("--only needs an existing audio/narration.json to keep the other segments.");
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  if (args.has("plan")) {
    const plan = chunks.map((chunk, index) => {
      const signature = hash(JSON.stringify({ voiceId, modelId, text: chunk.text, speed: .94, stability: .48, similarity: .78, style: .18 }));
      const audioName = `narration-${String(index).padStart(2, "0")}.mp3`;
      const cached = fs.existsSync(path.join(CACHE_DIR, `${signature}.json`)) && fs.existsSync(path.join(AUDIO_DIR, audioName));
      const problems = existing?.segments[index] ? timingProblems(existing.segments[index].wordTimings) : [];
      return { segment: `${index + 1}/${chunks.length}`, characters: chunk.text.length, status: problems.length ? "unstable" : cached ? "cached" : "needed", note: problems[0] || "" };
    });
    console.table(plan);
    const remainingCharacters = plan.filter((item) => item.status === "needed").reduce((sum, item) => sum + item.characters, 0);
    console.log(`${remainingCharacters} characters still require generation; ${plan.length - plan.filter((item) => item.status === "needed").length} of ${plan.length} segments are cached.`);
    const unstable = plan.filter((item) => item.status === "unstable").map((item) => item.segment.split("/")[0]);
    if (unstable.length) console.log(`Unstable timings in segment(s) ${unstable.join(", ")}. Regenerate them with: node scripts/generate-elevenlabs.js --only=${unstable.join(",")} --model=eleven_multilingual_v2 --chunk-limit=4200`);
    return;
  }

  let voiceName = voiceId;
  try {
    const voices = await request(`/v2/voices?voice_ids=${encodeURIComponent(voiceId)}&page_size=1`);
    voiceName = voices.voices?.[0]?.name || voiceId;
  } catch { /* Voice name is optional metadata. */ }

  const segments = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const signature = hash(JSON.stringify({ voiceId, modelId, text: chunk.text, speed: .94, stability: .48, similarity: .78, style: .18 }));
    const audioName = `narration-${String(index).padStart(2, "0")}.mp3`;
    const audioPath = path.join(AUDIO_DIR, audioName);
    const cachePath = path.join(CACHE_DIR, `${signature}.json`);
    let result;

    if (only.size && !only.has(index)) {
      const kept = existing.segments[index];
      if (!kept || kept.file !== `audio/${audioName}`) fail(`Segment ${index + 1} is missing from audio/narration.json; run without --only.`);
      segments.push(kept); console.log(`[${index + 1}/${chunks.length}] kept ${audioName}`);
      continue;
    }
    if (!only.has(index) && fs.existsSync(cachePath) && fs.existsSync(audioPath)) {
      result = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      console.log(`[${index + 1}/${chunks.length}] cached ${audioName}`);
    } else {
      console.log(`[${index + 1}/${chunks.length}] generating ${chunk.text.length} characters…`);
      const continuity = modelId === "eleven_v3" ? {} : {
        previous_text: index ? chunks[index - 1].text.slice(-700) : undefined,
        next_text: chunks[index + 1]?.text.slice(0, 700)
      };
      result = await request(`/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
        method: "POST",
        body: JSON.stringify({
          text: speakableText(chunk.text),
          model_id: modelId,
          ...continuity,
          apply_text_normalization: "auto",
          voice_settings: { stability: .48, similarity_boost: .78, style: .18, use_speaker_boost: true, speed: .94 }
        })
      });
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      fs.writeFileSync(audioPath, Buffer.from(result.audio_base64, "base64"));
      fs.writeFileSync(cachePath, JSON.stringify(result));
    }

    const alignment = result.alignment || result.normalized_alignment;
    if (!alignment?.character_start_times_seconds?.length) fail(`No timing alignment returned for segment ${index + 1}.`);
    const wordTimings = timingForChunk(chunk, alignment, globalWords);
    const duration = alignment.character_end_times_seconds.at(-1) || wordTimings.at(-1)?.end || 0;
    const problems = timingProblems(wordTimings);
    if (problems.length) console.warn(`  ! segment ${index + 1} looks unstable (${problems.slice(0, 3).join("; ")}). Regenerate it with --only=${index + 1}, ideally with --model=eleven_multilingual_v2 --chunk-limit=4200.`);
    segments.push({ file: `audio/${audioName}`, startWord: wordTimings[0]?.wordIndex ?? 0, endWord: wordTimings.at(-1)?.wordIndex ?? 0, duration, wordTimings });
  }

  const manifest = { provider: "ElevenLabs", voiceId, voiceName, modelId: only.size ? existing.modelId : modelId, wordCount: globalWords.length, generatedAt: new Date().toISOString(), segments };
  fs.writeFileSync(path.join(ROOT, "narration-data.js"), `window.ELEVENLABS_NARRATION=${JSON.stringify(manifest)};\n`);
  fs.writeFileSync(path.join(AUDIO_DIR, "narration.json"), JSON.stringify(manifest, null, 2));
  console.log(`Complete: ${segments.length} segments, ${globalWords.length} aligned words, voice “${voiceName}”.`);
}

(async () => {
  try { if (args.has("list-voices")) await listVoices(); else await generate(); }
  catch (error) { fail(error.message); }
})();
