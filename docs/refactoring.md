# Runtime refactoring

The app keeps its existing conversation, call, document, contact, board, composer, and local-data workflows. The changes reduce repeated work and make interrupted operations recoverable.

| Area | Implementation |
| --- | --- |
| Chat input | The composer owns its draft and attachment state. Memoized conversation rows have stable persisted IDs; typing no longer renders the transcript. |
| Streaming | Visual deltas are coalesced per animation frame and flushed before tool events and completion. Received assistant text is retained on provider failure. Browser disconnection stops display writes while accepted server work can finish. |
| Filing | A durable journal processes days in order. Failed jobs stop the cursor. Saved model payloads and deterministic output paths allow retry after interruption. Same-day archives merge by turn ID. Compaction retains all unfiled turns. |
| Calls | A root provider owns the call across route navigation. Generation checks reject stale async callbacks, microphone resources are cleaned up, and hangup waits for the relay's transcript flush. Pending tool responses survive a transport reconnection. |
| Audio rendering | A separate external store updates microphone meters without rendering the conversation. Browser and relay transcription use the same overlap merger. |
| Uploads | PDFs use the installed parser's named API and release its worker. Upload filenames include a UUID. MIDI analysis and attachment summaries keep their existing contract. |
| Client requests | Concurrent GETs share a request with independent response bodies. Completed cloud lists are revalidated. Document selection uses request versions; connection invalidation clears the prior selection. Board errors survive refresh. |
| Connectors | Identical concurrent reads share work; writes retain host queues and operation receipts. Folder membership has a short cache, and document bodies use account, host, version, and modified-time keys. Timings log operation names and durations, not payloads. |
| Context setup | Independent contact and Ableton context loads run together. Explicit connector-host runtime requests avoid probing the unused host; Settings still inspects the complete inventory. Setup avoids an unnecessary composer CLI probe. |
| Ableton | Host lookup and handshake work are shared. Waiters are removed on send failure. The optional vendored request-ID protocol correlates reads; older scripts use serialized address families with echoed-index matching. Independent reads run together. |
| Research | Job updates reread current storage before changing one job. Per-job polling is shared. The local server finalizes open jobs without an open browser, using the same document operation IDs. |
| Local storage/search | Conversation reads scan the tail. Reference extraction and derived sections are cached by file metadata. Studio search uses asynchronous file reads. Shared atomic writers and data-root/environment parsing replace duplicated implementations. The board CLI uses the same API as the UI. |
| Startup | Versioned production builds are fingerprinted and selected atomically. Development keeps its own output directory. The shell launcher builds when needed; the desktop launcher reports missing/stale builds and early child failures. The relay flushes on graceful shutdown. |
| Maintenance | Contact domain logic and document formatting are separate from providers. Feature stylesheet imports preserve the previous cascade. Explicit work tracking replaces global fetch patching. CI runs types, tests, production build, and Python protocol checks. |

## Validation

```sh
npm ci --prefix app
npm --prefix app run typecheck
npm --prefix app test
npm --prefix app run build
python3 -m unittest discover -s ableton/tests
```

The automated checks include failed filing and retry, same-day archives, compaction, torn JSONL tails, corrupt-state protection, PDF extraction, interrupted streams, request sharing, OSC identifiers, stale production builds, and existing connector operation receipts.

A production browser smoke check used 200 synthetic conversation messages (100 Markdown assistant responses). Text entry, multiline drafts, and the existing layout were checked. The board CLI was exercised through create, move, list, and remove against isolated temporary data. These checks do not establish a numerical input-latency benchmark.

Live Gemini audio/resumption, connected-account Google edits, and actual Ableton session edits require integration verification. The request-ID extension takes effect after installing the updated AbletonOSC script and restarting Live; older installed scripts remain supported but cannot offer perfect protection against delayed replies to identical requests.

## Startup

Use `npm run build --prefix app` after source changes, then `npm start --prefix app`. The double-click launcher builds automatically when needed. Desktop launches require a current build. `npm run dev --prefix app` remains the development command. Never rebuild a development server's active `.next` directory.

Build outputs and synthetic test data are not public artifacts. Keep real account data, transcripts, logs, and screenshots outside the checkout.
