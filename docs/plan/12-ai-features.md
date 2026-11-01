# 12 — AI Features

## Principles
1. **Use the unfair advantage:** each person has a clean, separate track → perfect speaker labels and cleaner inputs than any mixed recording.
2. **Private by default:** models run on our or the customer's servers. External APIs (OpenAI/Claude) only if the workspace's `ai_mode` allows it.
3. **Help during the interview, not just after.** Riverside's AI is mostly post-production; ours starts live.
4. **No generative-media arms race.** Skip avatars, voice cloning, dubbing, eye contact, AI B-roll, viral clip generators.

## A. During recording (live, host-only)

| Feature | What it does | Tech | Phase |
|---|---|---|---|
| **AI producer alerts** | "Guest 2 too quiet", "echo on Guest 1", "clipping", "upload behind", "guest tab hidden" | Local signal processing on each device + telemetry channel (`03` §4) | **v1** |
| **Talk balance** | Shows talk-time per person; nudge "you've talked 70%" | Voice activity detection per track | **v1** |
| **Interview guide tracker** | Host pastes questions; they're ticked off as covered; shows what's left + time per section | Streaming transcript (host side) + small model for matching | v1.1 |
| **Live notes & bookmarks** | Live transcript for host; "mark that" button/hotkey | Streaming Whisper on server, low-res audio from call | v1.1 |
| **Follow-up suggestions** | 1–2 suggested follow-ups from what the guest just said, private to host | Small LLM on server | v2 |
| **Live captions / translation for guests** | Captions in guest's language | Streaming Whisper + translation | v2 |

## B. After recording (private)

| Feature | What it does | Tech | Phase |
|---|---|---|---|
| **Transcripts, speaker = track** | 100+ languages, word timestamps, perfect speaker labels | faster-whisper (GPU) / whisper.cpp (CPU), large-v3-turbo | **v1** |
| **Audio cleanup** | Noise reduction, level balancing (EBU R128) | DeepFilterNet / RNNoise + ffmpeg | v1.1 |
| **Summary, chapters, show notes, takeaways** | Editable drafts | Local 7–14B open model (Ollama/vLLM) | v1.1 |
| **Redaction** | Detect + mask names, emails, phones, places; review before export | Presidio + rules + model assist | v1.1 |
| **Search across all recordings** | Semantic + keyword search with timestamps | Local embeddings + Postgres pgvector | v1.2 |
| **Ask your recordings** | "What did guest 3 say about X?" → answer with clickable timestamps | Retrieval over transcripts + local model | v1.2 |
| **Quote finder** | Best quotes per speaker with timestamps | Local model | v1.2 |
| **Research coding** | Suggested themes/codes across interviews → export to NVivo/ATLAS.ti/MAXQDA | Local model + embeddings clustering | v1.2 |
| **Silence & filler removal** | Cut all tracks in sync; review list before applying | Transcript timings + VAD | v1.2 |
| **Subtitles & translation** | SRT/VTT in many languages | Whisper + translation model | v1.2 |

## Model & cost notes
- Transcription: GPU batch in cloud ≈ cents per recorded hour; CPU on self-host (slower, fine for overnight).
- Small open models on one shared GPU handle summaries/Q&A for early volume; queue jobs.
- Check model licences (some open-weight models restrict commercial use).
- Self-host: AI container optional; works without GPU (transcripts only) → document hardware tiers.
- Quality bar: measure transcript WER on our own test set (multiple languages/accents) before claiming accuracy.

## Pricing tie-in
- Transcripts on every plan (cheap).
- Summaries/redaction/search on Studio, Business, Research team, and self-host licence.
- External-API mode only on paid plans, opt-in.

## Pitch
"Record interviews you'll never lose — with an AI producer that keeps them on track — then search, summarise and quote them, privately, on your own servers."
