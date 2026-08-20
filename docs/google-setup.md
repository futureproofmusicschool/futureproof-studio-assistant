# Google services setup

Studio Assistant keeps the task board, conversation, memory, and studio tools
on one machine while using Google Drive for shareable work and Gmail for
reviewable drafts.

The recommended setup reuses Google connectors from Codex or Claude Code. It
does **not** require a personal Google Cloud project, OAuth client ID, or client
secret. Direct Google OAuth is still available under an explicit Advanced
option for developers who need it.

See [Data flow and privacy boundary](data-flow.md) for the exact local, Google,
connector-host, and Gemini boundaries.

## Recommended connector setup

Each installation remains a local, single-user app connected to one Google
account through its selected connector host.

1. Install and sign in to Codex or Claude Code on the same machine as Studio
   Assistant.
2. Start Studio Assistant and open **Settings → Google services**.
3. Leave the host set to **Automatic (recommended)**. The app checks which host
   is available and verifies Google Drive and Gmail separately.
4. Connect **Google Drive**. This is required for the Docs and Contacts tabs.
   The setup link opens the selected host's connector flow in the browser.
5. Optionally connect **Gmail** to create drafts for review. Sending still
   happens in Gmail; Studio Assistant exposes no send action.
6. Return to Settings. The status refreshes when the window regains focus, and
   you can run the one-time local import after Drive reports **Connected**.

You can pin Codex or Claude Code instead of Automatic. A named host being
installed is not enough by itself: Studio Assistant enables only the Drive and
Gmail capabilities that host reports for the current installation and account.
In particular, it does not assume that Claude Code exposes the same connector
surface as Codex.

If a connector is missing, select its row in Settings to open the host's setup
page. If a host or capability says **Not detected**, install or update that host,
sign in, and refresh Settings. You can also choose another available host.

## What Studio Assistant creates

Drive contains one dedicated Studio Assistant folder with:

- native Google Docs created by the assistant;
- one managed Google Sheet whose **Contacts** tab is the identity and outreach
  source of truth;
- a **History** tab in that Sheet for correspondence and workflow history.

Gmail contains drafts created for review. Gmail is independent of Drive: Docs,
contacts, and migration continue to work when Gmail is not connected.

The app manages only its dedicated Drive folder. The Docs tab lists managed
files, previews their contents, and opens the original Google Doc for editing
or sharing.

## Existing local data

Settings inventories legacy `contacts/contacts.json` data and markdown files in
`documents/`. Import runs only after explicit confirmation, is safe to retry,
and keeps every local original untouched:

- contacts and correspondence are copied into the managed Sheet's Contacts and
  History tabs;
- markdown documents are copied into native Google Docs in the managed folder.

## How connector authentication works

Codex or Claude Code owns the connector sign-in and token refresh. Studio
Assistant stores the selected-host preference plus local workspace IDs and
operation receipts needed for safe retries. It does not copy the connector's
Google refresh token into the repository or send that token to the browser.

Connector tool availability can change when a host is upgraded, an account is
switched, or an organization changes its connector policy. Automatic mode
detects the current state rather than promising parity between hosts.

## Advanced: direct Google OAuth

Use this only when connector-host setup is unsuitable and you are comfortable
maintaining a Google Cloud project. Normal installations can skip this entire
section.

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the Google Drive, Google Docs, Google Sheets, People, and Gmail APIs.
3. Configure the Google Auth Platform audience for the account that will use
   this installation.
4. Add identity/email, `drive.file`, `contacts`, and `gmail.compose` to the
   consent screen.
5. Create an OAuth client whose application type is **Desktop app**.
6. In **Settings → Google services**, change the host to **Direct Google
   (advanced)**, choose **Show advanced**, and paste the downloaded OAuth JSON
   or its client ID and secret.
7. Connect Drive, then optionally Gmail.

`drive.file` limits direct mode to files created by or explicitly opened with
this OAuth application. `gmail.compose` is broad enough to authorize sending,
but Studio Assistant's direct integration calls draft creation only and has no
send route or tool.

Advanced direct mode retains the earlier Google Contacts architecture: Google
Contacts is canonical for identity, while the managed Sheet holds outreach
workflow, history, and recovery snapshots. This differs intentionally from the
recommended connector mode, where the Sheet's Contacts and History tabs are
the complete contact store.

Direct authorization opens in the system browser and returns to the
loopback-only app server. The OAuth client and refresh token are stored in the
external personal-data directory, never in the checkout, and saved values are
not returned to the Settings page.

Keep the direct OAuth client stable after setup. Files created with one client
may not be rediscoverable through a replacement client because Google Drive's
per-file grants and private discovery properties are application-specific.

Direct-mode references:

- [OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google Docs and `drive.file` scopes](https://developers.google.com/workspace/docs/api/auth)
- [Google Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [People API contacts](https://developers.google.com/people/v1/contacts)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
