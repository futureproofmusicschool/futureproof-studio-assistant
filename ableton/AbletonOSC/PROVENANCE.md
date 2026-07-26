# Provenance

This is a vendored, modified copy of AbletonOSC. Lineage:

1. **Upstream:** [ideoforms/AbletonOSC](https://github.com/ideoforms/AbletonOSC) (MIT, see LICENSE.md). An Ableton Live Control Surface script exposing the Live Object Model over OSC: listens on UDP 11000, replies to the sender's host on UDP 11001.
2. **Kadence Integrated fork** (copied from `kadence-integrated/apps/desktop/build-resources/AbletonOSC`): added arrangement-clip read handlers (`/live/track/get/arrangement_clips/{name,length,start_time}`), `/live/track/delete_clip`, song structure/track-data export helpers, and routing/device-chain additions.
3. **This repo's additions:**
   - `/live/track/duplicate_clip_to_arrangement` (track.py): copies a session clip onto the arrangement timeline at a beat position. The workhorse for "build in session view, place into the arrangement".

This copy is the canonical one for this repo. If upstream or Kadence improves, diff and merge by hand.

## Install

Run `scripts/install-abletonosc.sh` from the repo root (optionally with `user@host` for a remote Mac), then in Live: Preferences → Link, Tempo & MIDI → Control Surface → AbletonOSC, and restart Live after any script update.
