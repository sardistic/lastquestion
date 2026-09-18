(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const raw = window.STORY_TEXT || "";
  const wordMatches = [...raw.matchAll(/\S+/g)];
  const words = wordMatches.map((m) => m[0]);
  const wordStarts = wordMatches.map((m) => m.index);
  const WORDS_PER_SECOND = 3.6;

  const canvas = $("#world");
  const ctx = canvas.getContext("2d", { alpha: false });
  const progressEl = $("#storyProgress");
  const chapterEl = $(".chapter");
  const readerEl = $("#reader");
  const readerTextEl = $("#readerText");
  const eraMarksEl = $("#eraMarks");
  const playButton = $("#playToggle");
  const narrationButton = $("#narrationToggle");
  const voiceSelect = $("#voiceSelect");
  const rateSelect = $("#rateSelect");
  const storyLineEl = $("#storyLine");
  const wordCounterEl = $("#wordCounter");
  const timeCounterEl = $("#timeCounter");
  const viewModeEl = $("#viewMode");
  const visuals = window.LQ_VISUALS;

  function indexOfPhrase(phrase) {
    const charIndex = raw.indexOf(phrase);
    if (charIndex < 0) return -1;
    let low = 0, high = wordStarts.length - 1;
    while (low < high) { const mid = (low + high) >> 1; if (wordStarts[mid] < charIndex) low = mid + 1; else high = mid; }
    return low;
  }

  function nthIndexOfPhrase(phrase, occurrence) {
    let charIndex = -1;
    for (let i = 0; i <= occurrence; i++) { charIndex = raw.indexOf(phrase, charIndex + 1); if (charIndex < 0) return -1; }
    let low = 0, high = wordStarts.length - 1;
    while (low < high) { const mid = (low + high) >> 1; if (wordStarts[mid] < charIndex) low = mid + 1; else high = mid; }
    return low;
  }

  const markerPhrases = [
    "The last question was asked for the first time", "Alexander Adell and Bertram Lupov", "Jerrodd, Jerrodine",
    "VJ-23X of Lameth", "Zee Prime's mind", "Man considered with himself",
    "The stars and Galaxies died", "Matter and energy had ended"
  ];
  const markerWords = markerPhrases.map((phrase) => Math.max(0, indexOfPhrase(phrase)));
  markerWords[0] = 0;

  const scenes = [
    { number: "00", eyebrow: "MAY 21, 2061 · THE FIRST ASKING", title: "THE QUESTION<br>BEGINS", copy: "Humanity steps into the light. Above an ordinary world, a solar station quietly changes the scale of every possible future." },
    { number: "01", eyebrow: "MULTIVAC / SOLAR EARTH", title: "FOREVER<br>IS NOT FOREVER", copy: "Two attendants cross the buried body of Multivac. Above them, humanity has captured the energy of the sun." },
    { number: "02", eyebrow: "MICROVAC / DESTINATION X-23", title: "LEAVING<br>HOME", copy: "A family watches Earth recede and a new world swell in the glass. The question becomes an inheritance." },
    { number: "03", eyebrow: "GALACTIC AC / FULL UNIVERSE", title: "TOO MANY<br>STARS", copy: "Immortal humanity fills galaxies faster than it can name them. Even abundance begins to resemble an ending." },
    { number: "04", eyebrow: "UNIVERSAL AC / THE ORIGINAL GALAXY", title: "WHERE WE<br>BEGAN", copy: "Bodies sleep while minds drift freely. Humanity searches the galaxies for the first sun and finds only its remains." },
    { number: "05", eyebrow: "COSMIC AC / DIMMING GALAXIES", title: "ONE VOICE<br>WAITING", copy: "Every human mind has become Man. Around it, the final useful stars spend their last stored light." },
    { number: "06", eyebrow: "TEN TRILLION YEARS / NEAR ZERO", title: "THE FINAL<br>STAR", copy: "One consciousness remains beside one dark stellar remnant. It asks once more, then lets go of itself." },
    { number: "07", eyebrow: "AC / CHAOS / THE ANSWER", title: "NO ONE LEFT<br>TO TELL", copy: "With space and time gone, AC completes the oldest calculation and answers in the only way still possible." }
  ];

  let width = 0, height = 0, renderScale = 1;
  let position = 0, scene = 0, previousScene = -1, previousWord = -1;
  let lastTime = performance.now(), playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dragging = false, progressScrubbing = false, dragX = 0, pointerX = .5, pointerY = .5, readerOpen = false;
  let currentSpan = null, readerRenderedWord = -1;
  let storyWindowStart = -1, storyWindowEnd = -1, storyCurrentSpan = null;
  let storyWindowSpans = [];
  let narrationEnabled = false, speechGeneration = 0, narrationTimer = 0;
  let narrationSyncBlockedUntil = 0;
  let availableVoices = [];
  const PREMIUM_VOICE_VALUE = "elevenlabs";
  const premiumNarration = window.ELEVENLABS_NARRATION?.wordCount === words.length ? window.ELEVENLABS_NARRATION : null;
  const premiumSegmentOffsets = [];
  let premiumDuration = 0;
  if (premiumNarration) {
    for (const segment of premiumNarration.segments) {
      premiumSegmentOffsets.push(premiumDuration);
      premiumDuration += segment.duration || 0;
    }
  }
  const narrationAudio = new Audio();
  narrationAudio.preload = "auto";
  let audioSegmentIndex = -1;
  const readerSpans = [];

  function noise(n) { return ((Math.sin(n * 91.345) * 47453.5453) % 1 + 1) % 1; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pad(n) { return String(Math.max(0, Math.floor(n))).padStart(2, "0"); }
  function timecode(seconds) { return `${pad(seconds / 60)}:${pad(seconds % 60)}`; }

  function buildReader() {
    const fragment = document.createDocumentFragment();
    let wordIndex = 0;
    for (const match of raw.matchAll(/\S+|\s+/g)) {
      if (/^\s+$/.test(match[0])) fragment.appendChild(document.createTextNode(match[0]));
      else {
        const span = document.createElement("span");
        span.className = "word"; span.textContent = match[0]; span.dataset.index = wordIndex;
        span.addEventListener("click", () => seek(Number(span.dataset.index)));
        readerSpans.push(span); fragment.appendChild(span); wordIndex++;
      }
    }
    readerTextEl.appendChild(fragment);
  }

  function buildEraMarks() {
    markerWords.forEach((mark, i) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "era-mark"; button.dataset.era = scenes[i].number;
      button.style.left = `${mark / (words.length - 1) * 100}%`;
      button.setAttribute("aria-label", `Jump to ${scenes[i].title.replace("<br>", " ")}`);
      button.addEventListener("click", () => seek(mark)); eraMarksEl.appendChild(button);
    });
  }

  function sceneForWord(wordIndex) {
    let result = 0;
    for (let i = 1; i < markerWords.length; i++) if (wordIndex >= markerWords[i]) result = i;
    return result;
  }

  function seek(wordIndex) {
    position = clamp(wordIndex, 0, words.length - 1); previousWord = -1;
    updateNarrative(true);
    if (narrationEnabled) restartNarrationSoon();
  }

  function loadVoices() {
    let savedVoice = "";
    try { savedVoice = localStorage.getItem("last-question-voice") || ""; } catch { /* Storage may be unavailable for local files. */ }
    const previous = voiceSelect.value || savedVoice || (premiumNarration ? PREMIUM_VOICE_VALUE : "");
    availableVoices = "speechSynthesis" in window
      ? speechSynthesis.getVoices().filter((voice) => /^en([-_]|$)/i.test(voice.lang)).sort((a, b) => voiceScore(b) - voiceScore(a))
      : [];
    voiceSelect.replaceChildren();
    if (premiumNarration) voiceSelect.add(new Option(`ELEVENLABS · ${premiumNarration.voiceName || "NARRATOR"}`, PREMIUM_VOICE_VALUE));
    availableVoices.forEach((voice) => voiceSelect.add(new Option(`SYSTEM · ${voice.name} · ${voice.lang}`, voice.voiceURI)));
    if (!voiceSelect.options.length) {
      narrationButton.disabled = true; narrationButton.textContent = "NO VOICE"; return;
    }
    voiceSelect.disabled = false;
    voiceSelect.value = [...voiceSelect.options].some((option) => option.value === previous)
      ? previous
      : (premiumNarration ? PREMIUM_VOICE_VALUE : voiceSelect.options[0].value);
  }

  function voiceScore(voice) {
    const name = voice.name.toLowerCase(), lang = voice.lang.toLowerCase();
    let score = 0;
    if (/natural|neural|premium|enhanced/.test(name)) score += 40;
    if (/online/.test(name)) score += 12;
    if (/en-gb|en_gb/.test(lang)) score += 20;
    if (/ryan/.test(name)) score += 100;
    else if (/guy|christopher|daniel|oliver|george|arthur|david|male/.test(name)) score += 60;
    else if (/google uk english male/.test(name)) score += 75;
    if (/zira|jenny|sonia|samantha|ava|female|aria|susan|hazel/.test(name)) score -= 80;
    return score;
  }

  function chosenVoice() {
    if (voiceSelect.value && voiceSelect.value !== PREMIUM_VOICE_VALUE) return availableVoices.find((voice) => voice.voiceURI === voiceSelect.value) || null;
    return availableVoices[0] || null;
  }

  function usingPremiumVoice() {
    return Boolean(premiumNarration && voiceSelect.value === PREMIUM_VOICE_VALUE);
  }

  function stopNarration(updateButton = true) {
    speechGeneration++; clearTimeout(narrationTimer);
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    narrationAudio.pause();
    if (updateButton) {
      narrationEnabled = false; narrationButton.classList.remove("is-on"); narrationButton.textContent = "VOICE OFF";
      narrationButton.setAttribute("aria-label", "Start narration");
    }
  }

  function restartNarrationSoon() {
    if (!narrationEnabled) return;
    clearTimeout(narrationTimer);
    narrationAudio.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    if (usingPremiumVoice()) {
      narrationAudio.pause();
      narrationSyncBlockedUntil = performance.now() + 600;
      narrationTimer = setTimeout(() => startPremiumNarration(Math.floor(position)), 80);
      return;
    }
    if (!("speechSynthesis" in window)) return;
    const generation = ++speechGeneration; clearTimeout(narrationTimer); speechSynthesis.cancel();
    narrationTimer = setTimeout(() => speakFrom(Math.floor(position), generation), 140);
  }

  function speakFrom(start, generation) {
    if (!narrationEnabled || generation !== speechGeneration || start >= words.length) return;
    narrationButton.textContent = "SYSTEM ON";
    let end = Math.min(words.length, start + 105);
    for (let i = start + 36; i < end; i++) {
      if (/[.!?][\"')]*$/.test(words[i])) { end = i + 1; break; }
    }
    const chunk = words.slice(start, end);
    const offsets = []; let cursor = 0;
    chunk.forEach((word) => { offsets.push(cursor); cursor += word.length + 1; });
    const utterance = new SpeechSynthesisUtterance(chunk.join(" "));
    utterance.rate = Number(rateSelect.value) || .94; utterance.pitch = .96; utterance.volume = .94;
    const voice = chosenVoice(); if (voice) utterance.voice = voice;
    utterance.onboundary = (event) => {
      if (!narrationEnabled || generation !== speechGeneration) return;
      let low = 0, high = offsets.length - 1;
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (offsets[mid] <= event.charIndex) low = mid; else high = mid - 1; }
      position = start + low;
    };
    utterance.onend = () => {
      if (!narrationEnabled || generation !== speechGeneration) return;
      if (end >= words.length) stopNarration(true); else speakFrom(end, generation);
    };
    utterance.onerror = (event) => { if (!/canceled|interrupted/.test(event.error || "")) stopNarration(true); };
    speechSynthesis.speak(utterance);
    if (!playing) speechSynthesis.pause();
  }

  function toggleNarration() {
    if (narrationEnabled) { stopNarration(true); return; }
    if (!usingPremiumVoice() && !("speechSynthesis" in window)) return;
    narrationEnabled = true; playing = true; narrationButton.classList.add("is-on"); narrationButton.textContent = "VOICE ON";
    narrationButton.setAttribute("aria-label", "Stop narration"); playButton.textContent = "Ⅱ";
    restartNarrationSoon();
  }

  function segmentIndexForWord(wordIndex) {
    if (!premiumNarration) return -1;
    const direct = premiumNarration.segments.findIndex((segment) => wordIndex >= segment.startWord && wordIndex <= segment.endWord);
    return direct >= 0 ? direct : clamp(premiumNarration.segments.findIndex((segment) => wordIndex < segment.startWord), 0, premiumNarration.segments.length - 1);
  }

  function timingIndexAt(segment, time) {
    const timings = segment.wordTimings;
    let low = 0, high = timings.length - 1;
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (timings[mid].start <= time) low = mid; else high = mid - 1; }
    return low;
  }

  function premiumTimeAtWord(wordIndex) {
    if (!premiumNarration) return wordIndex / WORDS_PER_SECOND;
    const segmentIndex = segmentIndexForWord(wordIndex);
    const segment = premiumNarration.segments[segmentIndex];
    const localIndex = clamp(wordIndex - segment.startWord, 0, segment.wordTimings.length - 1);
    return premiumSegmentOffsets[segmentIndex] + (segment.wordTimings[localIndex]?.start || 0);
  }

  function startPremiumNarration(wordIndex) {
    if (!usingPremiumVoice() || !narrationEnabled) return;
    const nextIndex = segmentIndexForWord(wordIndex);
    const segment = premiumNarration.segments[nextIndex];
    if (!segment) { stopNarration(true); return; }
    const timing = segment.wordTimings.find((item) => item.wordIndex >= wordIndex) || segment.wordTimings[0];
    const startPlayback = () => {
      try { narrationAudio.currentTime = timing?.start || 0; } catch { /* Metadata may still be settling. */ }
      narrationSyncBlockedUntil = performance.now() + 120;
      narrationAudio.playbackRate = (Number(rateSelect.value) || .94) / .94;
      if (playing) narrationAudio.play().catch(() => stopNarration(true));
    };
    if (nextIndex !== audioSegmentIndex) {
      audioSegmentIndex = nextIndex; narrationAudio.src = segment.file;
      if (narrationAudio.readyState >= 1) startPlayback(); else narrationAudio.addEventListener("loadedmetadata", startPlayback, { once: true });
      narrationAudio.load();
    } else startPlayback();
    narrationButton.textContent = "11LABS ON";
  }

  function syncPremiumPosition() {
    if (!usingPremiumVoice() || !narrationEnabled || audioSegmentIndex < 0 || dragging || progressScrubbing || performance.now() < narrationSyncBlockedUntil) return;
    const segment = premiumNarration.segments[audioSegmentIndex];
    const timing = segment.wordTimings[timingIndexAt(segment, narrationAudio.currentTime)];
    if (timing && timing.wordIndex !== Math.floor(position)) position = timing.wordIndex;
  }

  function rebuildStoryWindow(wi, force = false) {
    const needsWindow = force || storyWindowStart < 0 || wi < storyWindowStart || wi >= storyWindowEnd - 6;
    if (!needsWindow) return;
    const visibleWords = width >= 1200 ? 52 : width >= 700 ? 40 : 28;
    // Start the window at the beginning of the current sentence so the highlight never teleports mid-thought.
    let sentenceStart = Math.max(0, wi - 4);
    for (let i = wi - 1; i >= Math.max(0, wi - 22); i--) { if (/[.!?]["’)']*$/.test(words[i])) { sentenceStart = i + 1; break; } }
    storyWindowStart = clamp(Math.min(sentenceStart, wi - 2), 0, Math.max(0, words.length - visibleWords));
    storyWindowEnd = Math.min(words.length, storyWindowStart + visibleWords);
    storyWindowSpans = [];
    const fragment = document.createDocumentFragment();
    for (let i = storyWindowStart; i < storyWindowEnd; i++) {
      if (i > storyWindowStart) fragment.appendChild(document.createTextNode(" "));
      const span = document.createElement("span");
      span.className = "context-word";
      span.textContent = words[i];
      storyWindowSpans.push(span);
      fragment.appendChild(span);
    }
    storyLineEl.replaceChildren(fragment);
    storyCurrentSpan = null;
  }

  function updateStoryWindow(wi, force = false) {
    rebuildStoryWindow(wi, force);
    storyCurrentSpan?.classList.remove("is-current");
    const localIndex = wi - storyWindowStart;
    storyCurrentSpan = storyWindowSpans[localIndex] || null;
    storyCurrentSpan?.classList.add("is-current");
    for (let i = 0; i < storyWindowSpans.length; i++) storyWindowSpans[i].classList.toggle("is-spoken", i < localIndex);
  }

  function followReader(wi, force = false) {
    if (!readerOpen || !currentSpan) return;
    const top = currentSpan.offsetTop;
    const viewportTop = readerTextEl.scrollTop;
    const viewportHeight = readerTextEl.clientHeight;
    const aboveReadingBand = top < viewportTop + viewportHeight * .28;
    const belowReadingBand = top > viewportTop + viewportHeight * .62;
    if (force || aboveReadingBand || belowReadingBand) {
      readerTextEl.scrollTop = Math.max(0, top - viewportHeight * .4);
    }
  }

  function updateReaderHighlight(wi, force = false) {
    currentSpan?.classList.remove("is-current");
    if (readerRenderedWord >= 0 && !force) {
      const from = Math.min(readerRenderedWord, wi), to = Math.max(readerRenderedWord, wi);
      for (let i = from; i <= to; i++) readerSpans[i]?.classList.toggle("is-read", i < wi);
    } else {
      readerSpans.forEach((span, i) => span.classList.toggle("is-read", i < wi));
    }
    currentSpan = readerSpans[wi] || null;
    currentSpan?.classList.add("is-current");
    readerRenderedWord = wi;
  }

  function updateNarrative(force) {
    const wi = clamp(Math.floor(position), 0, words.length - 1);
    scene = sceneForWord(wi);
    if (force || scene !== previousScene) updateScene(force);
    if (!force && wi === previousWord) return;

    if (readerOpen) updateReaderHighlight(wi, force);
    else currentSpan = readerSpans[wi] || null;

    updateStoryWindow(wi, force);

    progressEl.value = wi;
    wordCounterEl.textContent = `${String(wi + 1).padStart(4, "0")} / ${words.length}`;
    const elapsed = usingPremiumVoice() ? premiumTimeAtWord(wi) : wi / WORDS_PER_SECOND;
    const duration = usingPremiumVoice() ? premiumDuration : words.length / WORDS_PER_SECOND;
    timeCounterEl.textContent = `${timecode(elapsed)} / ${timecode(duration)}`;

    followReader(wi, force);
    previousWord = wi;
  }

  function updateScene(force) {
    previousScene = scene;
    const data = scenes[scene];
    const commit = () => {
      $("#eraNumber").textContent = data.number;
      $("#chapterEyebrow").textContent = data.eyebrow; $("#chapterTitle").innerHTML = data.title;
      $("#chapterCopy").textContent = data.copy; chapterEl.classList.remove("is-changing");
    };
    if (force) commit(); else { chapterEl.classList.add("is-changing"); setTimeout(commit, 240); }
    [...eraMarksEl.children].forEach((mark, i) => mark.classList.toggle("is-active", i === scene));
  }

  function resize() {
    width = innerWidth; height = innerHeight;
    renderScale = Math.min(devicePixelRatio || 1, 1.25);
    canvas.width = Math.round(width * renderScale); canvas.height = Math.round(height * renderScale);
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    visuals.resize(width, height, renderScale);
  }

  let lastPaint = 0, currentLabel = "";
  function render(t) {
    requestAnimationFrame(render);
    if (document.hidden || t - lastPaint < 24) return;
    const delta = clamp(t - lastTime, 0, 50); lastTime = t; lastPaint = t;
    syncPremiumPosition();
    if (playing && !dragging && !readerOpen && !narrationEnabled) position += delta / 1000 * WORDS_PER_SECOND;
    if (position >= words.length - 1 && playing && !narrationEnabled) { position = words.length - 1; setPlaying(false); }
    updateNarrative(false);

    // The illustrated world follows the beat of the text currently being read.
    const beat = visuals.frame({ t: t / 1000, dt: delta / 1000, position, pointerX, pointerY });
    if (beat.label !== currentLabel) { currentLabel = beat.label; viewModeEl.textContent = currentLabel; }
  }

  function setReader(open) {
    readerOpen = open; readerEl.classList.toggle("is-open", open); readerEl.setAttribute("aria-hidden", String(!open));
    if (open) {
      updateReaderHighlight(Math.floor(position), true);
      requestAnimationFrame(() => followReader(Math.floor(position), true));
    } else {
      currentSpan?.classList.remove("is-current");
      readerRenderedWord = -1;
    }
  }

  function setPlaying(next) {
    playing = next; playButton.textContent = playing ? "Ⅱ" : "▶"; playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  playButton.addEventListener("click", () => {
    if (!playing && position >= words.length - 1) seek(0);
    setPlaying(!playing);
    if (narrationEnabled) {
      if (usingPremiumVoice()) {
        if (playing) narrationAudio.play().catch(() => stopNarration(true)); else narrationAudio.pause();
      } else if ("speechSynthesis" in window) {
        if (playing) speechSynthesis.resume(); else speechSynthesis.pause();
      }
    }
  });
  narrationButton.addEventListener("click", toggleNarration);
  voiceSelect.addEventListener("change", () => {
    try { localStorage.setItem("last-question-voice", voiceSelect.value); } catch { /* Voice selection still works without persistence. */ }
    updateNarrative(true);
    if (narrationEnabled) restartNarrationSoon();
  });
  rateSelect.addEventListener("change", () => { if (narrationEnabled) restartNarrationSoon(); });
  narrationAudio.addEventListener("ended", () => {
    if (!narrationEnabled || !usingPremiumVoice()) return;
    const next = audioSegmentIndex + 1;
    if (next >= premiumNarration.segments.length) stopNarration(true);
    else startPremiumNarration(premiumNarration.segments[next].startWord);
  });
  narrationAudio.addEventListener("error", () => { if (narrationEnabled && usingPremiumVoice()) stopNarration(true); });
  function beginProgressSeek() {
    progressScrubbing = true;
    narrationSyncBlockedUntil = performance.now() + 600;
    if (narrationEnabled && usingPremiumVoice()) narrationAudio.pause();
    else if (narrationEnabled && "speechSynthesis" in window) speechSynthesis.pause();
  }

  function previewProgressSeek() {
    position = clamp(Number(progressEl.value), 0, words.length - 1);
    updateNarrative(true);
  }

  function commitProgressSeek() {
    if (!progressScrubbing) return;
    progressScrubbing = false;
    if (narrationEnabled) restartNarrationSoon();
  }

  progressEl.max = String(words.length - 1);
  progressEl.addEventListener("pointerdown", beginProgressSeek);
  progressEl.addEventListener("input", () => {
    if (!progressScrubbing) beginProgressSeek();
    previewProgressSeek();
  });
  progressEl.addEventListener("change", commitProgressSeek);
  progressEl.addEventListener("pointerup", commitProgressSeek);
  progressEl.addEventListener("pointercancel", commitProgressSeek);
  progressEl.addEventListener("keyup", commitProgressSeek);
  addEventListener("pointerup", () => { if (progressScrubbing) commitProgressSeek(); });
  $("#readerOpen").addEventListener("click", () => setReader(true)); $("#readerClose").addEventListener("click", () => setReader(false));
  $(".wordmark").addEventListener("click", (e) => { e.preventDefault(); seek(0); });
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; dragX = e.clientX; canvas.setPointerCapture(e.pointerId);
    if (narrationEnabled && usingPremiumVoice()) narrationAudio.pause();
    else if (narrationEnabled && "speechSynthesis" in window) speechSynthesis.pause();
  });
  canvas.addEventListener("pointermove", (e) => {
    pointerX = e.clientX / width; pointerY = e.clientY / height;
    if (!dragging) return; position -= (e.clientX - dragX) * 1.35; dragX = e.clientX; position = clamp(position, 0, words.length - 1); previousWord = -1;
  });
  canvas.addEventListener("pointerup", () => { dragging = false; if (narrationEnabled) restartNarrationSoon(); }); canvas.addEventListener("pointercancel", () => { dragging = false; if (narrationEnabled) restartNarrationSoon(); });
  addEventListener("wheel", (e) => { position = clamp(position + e.deltaY * .12, 0, words.length - 1); previousWord = -1; if (narrationEnabled) restartNarrationSoon(); }, { passive: true });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") setReader(false);
    if (e.target.closest?.("button, input, select, a")) return;
    if (e.key === "ArrowRight") seek(markerWords[Math.min(markerWords.length - 1, scene + 1)]);
    if (e.key === "ArrowLeft") seek(markerWords[Math.max(0, scene - 1)]);
    if (e.key === " ") { e.preventDefault(); playButton.click(); }
  });
  addEventListener("resize", resize);

  visuals.init(canvas, words, indexOfPhrase, nthIndexOfPhrase);
  buildReader(); buildEraMarks(); resize(); loadVoices();
  if ("speechSynthesis" in window) speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
  const query = new URLSearchParams(location.search);
  const requestedEra = Number(query.get("era"));
  const requestedPhase = Number(query.get("phase"));
  if (Number.isInteger(requestedEra) && requestedEra >= 0 && requestedEra < markerWords.length) {
    const start = markerWords[requestedEra], end = markerWords[requestedEra + 1] ?? words.length - 1;
    position = start + (end - start) * (Number.isFinite(requestedPhase) ? clamp(requestedPhase, 0, .999) : 0);
  }
  const requestedWord = Number(query.get("word"));
  if (Number.isInteger(requestedWord)) position = clamp(requestedWord, 0, words.length - 1);
  updateNarrative(true); requestAnimationFrame(render);
})();
