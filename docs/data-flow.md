# Data flow and privacy boundary

Studio Assistant is a single-user local application. It has no Futureproof
account service or shared application database. The local server binds only to
the loopback interface.

## What stays on the computer

- task board;
- conversation log, uploads, and transcripts;
- assistant memory, plans, studio reference material, and MIDI style or
  instrument notes;
- Gemini API key;
- selected connector-host preference, managed workspace IDs, safe-retry
  receipts, and application settings;
- retained pre-Google migration backups.

These files live outside the checkout in the external personal-data directory.
A pull, fresh clone, or checkout replacement cannot overwrite them.

## What the connector host owns

In the recommended mode, Codex or Claude Code owns Google sign-in, connector
authorization, token storage, and token refresh. Studio Assistant detects the
host and each app capability at runtime. It does not read or export the host's
raw Google OAuth tokens.

The local app asks the selected host to perform scoped Drive or Gmail tool
operations. Requests and returned tool data may therefore be processed under
that host's OpenAI or Anthropic account and its applicable data controls.
Automatic mode reports which host is effective for the current installation;
it does not imply that the two providers expose identical tools or policies.

If **Direct Google (advanced)** is selected, the OAuth client configuration and
Google refresh token are instead stored in the external personal-data
directory. On systems with Unix permission bits, the Google directory is mode
`0700` and credential files are mode `0600`. Direct-mode tokens are never
returned to the browser or included in model prompts. This compatibility mode
also retains Google Contacts as the canonical identity store.

## What lives in the connected Google account

- native Google Docs inside one dedicated managed Drive folder;
- in recommended connector mode, one managed Google Sheet with a canonical
  **Contacts** tab and a **History** tab for outreach workflow and
  correspondence;
- in Advanced direct mode, canonical identity records in Google Contacts plus
  workflow, history, and recovery snapshots in the managed Sheet;
- reviewable Gmail drafts when the optional Gmail capability is connected.

Studio Assistant does not expose an email-send action. Gmail remains the review
and send surface. The app does not need Gmail in order to use Docs, contacts, or
the one-time import.

## What is sent to Gemini

Gemini receives the conversation and the context needed to answer it. That can
include local board or memory summaries, a compact outreach digest, an uploaded
file on the current turn, and Google Sheet or Google Doc content when the artist
invokes the corresponding assistant tool. Draft text is generated in the
conversation and then written to Gmail through the selected integration.

Raw connector credentials, Google refresh tokens, and access tokens are not
included in Gemini prompts. There is no Futureproof relay for Google Workspace
data: this installation communicates with its selected local connector host or,
in Advanced mode, directly with Google, plus the user's configured Gemini API.

## Migration, switching, and deletion

The one-time migration copies existing local contacts and markdown documents
to Google only after explicit confirmation. In connector mode, contacts and
correspondence go to the managed Sheet. In Advanced direct mode, identity is
also copied to Google Contacts. Documents become native Google Docs in either
mode. The local originals remain untouched, and retrying the import is designed
to be idempotent.

Switching connector hosts changes which local host performs Google operations;
it does not copy or delete anything in Google. Use the same Google account if
you expect the next host to see the same managed folder. A completed or partial
one-time import is also recognized across connector hosts when both report the
same Google account, so switching hosts does not duplicate imported Docs.

Disconnecting a connector in Codex or Claude Code removes that host's access
but does not delete Google-owned files or drafts. Disconnecting Advanced direct
Google removes the local refresh token and attempts remote revocation. Deleting
or moving managed Drive content can make it disappear from Studio Assistant
after the next refresh.
