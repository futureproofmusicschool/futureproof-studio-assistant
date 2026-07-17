---
type: procedural
category: workflow
last_used: 2026-07-17
---
# Example: Export checklist

This is a sample procedural memory so you can see the format. Delete it once you have real ones.

## When to Use

Any time a track gets bounced for feedback or release.

## Steps

1. Check the master chain: limiter ceiling at -1.0 dB for streaming, or bypassed for a mastering handoff
2. Export WAV, 24-bit, at the project sample rate
3. Name it `TrackName_vNN_YYYY-MM-DD.wav`
4. Drop a copy in the bounces folder and listen on a second playback system before sending

## Gotchas

- Freeze/flatten any CPU-heavy tracks first; live renders with overloaded CPU can glitch
- Double-check the loop brace covers the whole song. Everyone exports a 16-bar loop by accident exactly once.
