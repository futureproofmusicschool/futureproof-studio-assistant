import "server-only";

import crypto from "node:crypto";
import { Auth, google } from "googleapis";
import {
  GOOGLE_SCOPES,
  GOOGLE_SERVICE_SCOPES,
  GOOGLE_SERVICES,
  googleOAuthConfigStatus,
  requireGoogleOAuthConfig,
  scopesForGoogleServices,
  type GoogleService,
} from "@/lib/google/config";
import {
  googleAccountIdentitiesMatch,
  selectGoogleRefreshToken,
} from "@/lib/google/auth-logic";
import {
  clearGoogleAuthorization,
  clearPendingGoogleAuthorizations,
  consumePendingGoogleAuthorization,
  readGoogleAuthorization,
  savePendingGoogleAuthorization,
  updateGoogleRefreshToken,
  writeGoogleAuthorization,
  type StoredGoogleAuthorization,
} from "@/lib/google/store";

export type GoogleConnectionStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  scopes: string[];
  services: Record<GoogleService, boolean>;
  connectedAt: string | null;
  updatedAt: string | null;
  source: "environment" | "oauth-client.json" | null;
  redirectUri: string;
  credentialFile: string;
  error?: string;
};

type GoogleUserInfo = { id?: string | null; email?: string | null };

let cachedClient: Auth.OAuth2Client | null = null;
let cachedRefreshToken = "";

function oauthClient() {
  const config = requireGoogleOAuthConfig();
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

function splitScopes(value: string | null | undefined) {
  return value?.split(/\s+/).map((scope) => scope.trim()).filter(Boolean) ?? [];
}

function base64Url(bytes: Buffer) {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function serviceStatus(scopes: readonly string[]) {
  const granted = new Set(scopes);
  return Object.fromEntries(
    GOOGLE_SERVICES.map((service) => [
      service,
      GOOGLE_SERVICE_SCOPES[service].every((scope) => granted.has(scope)),
    ]),
  ) as Record<GoogleService, boolean>;
}

function hasScopes(granted: readonly string[], required: readonly string[]) {
  const available = new Set(granted);
  return required.every((scope) => available.has(scope));
}

function friendlyScopeName(scope: string) {
  if (scope === GOOGLE_SCOPES.driveFile) return "Google Drive";
  if (scope === GOOGLE_SCOPES.gmailCompose) return "Gmail drafts";
  if (scope === GOOGLE_SCOPES.contacts) return "Google Contacts";
  return scope;
}

function invalidGrant(error: unknown) {
  const record = error as { message?: unknown; response?: { data?: { error?: unknown } } };
  return (
    record?.response?.data?.error === "invalid_grant" ||
    (typeof record?.message === "string" && record.message.toLowerCase().includes("invalid_grant"))
  );
}

function attachRefreshPersistence(client: Auth.OAuth2Client, expectedRefreshToken: string) {
  client.on("tokens", (tokens) => {
    if (tokens.refresh_token) updateGoogleRefreshToken(tokens.refresh_token, expectedRefreshToken);
  });
  return client;
}

export function getGoogleConnectionStatus(): GoogleConnectionStatus {
  const config = googleOAuthConfigStatus();
  try {
    const authorization = readGoogleAuthorization();
    return {
      ...config,
      connected: Boolean(config.configured && authorization),
      email: authorization?.email ?? null,
      scopes: authorization?.scopes ?? [],
      services: serviceStatus(authorization?.scopes ?? []),
      connectedAt: authorization?.connectedAt ?? null,
      updatedAt: authorization?.updatedAt ?? null,
    };
  } catch (error) {
    return {
      ...config,
      connected: false,
      email: null,
      scopes: [],
      services: serviceStatus([]),
      connectedAt: null,
      updatedAt: null,
      error: error instanceof Error ? error.message : "The saved Google authorization is invalid.",
    };
  }
}

export function beginGoogleAuthorization(services: readonly GoogleService[] = GOOGLE_SERVICES) {
  const client = oauthClient();
  const scopes = scopesForGoogleServices(services);
  const state = base64Url(crypto.randomBytes(32));
  const codeVerifier = base64Url(crypto.randomBytes(64));
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());

  // One local installation has one active account flow. Starting again
  // invalidates an older browser tab so callbacks cannot race and reconnect a
  // different account after the artist has moved on.
  clearPendingGoogleAuthorizations();
  savePendingGoogleAuthorization({
    state,
    codeVerifier,
    scopes,
    createdAt: new Date().toISOString(),
  });

  return {
    authorizationUrl: client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      include_granted_scopes: true,
      prompt: "consent",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: Auth.CodeChallengeMethod.S256,
    }),
    services: [...services],
  };
}

export function cancelGoogleAuthorization(state: string) {
  consumePendingGoogleAuthorization(state);
}

async function googleUserInfo(client: Auth.OAuth2Client): Promise<GoogleUserInfo> {
  const service = google.oauth2({ version: "v2", auth: client });
  const response = await service.userinfo.get();
  return { id: response.data.id, email: response.data.email };
}

export async function completeGoogleAuthorization(input: { state: string; code: string }) {
  const pending = consumePendingGoogleAuthorization(input.state);
  // Do not attach the steady-state token listener during the initial exchange.
  // Some OAuth clients emit `tokens` from getToken(); persisting that refresh
  // token before the newly authenticated Google identity is verified could,
  // on a crash, pair account B's credential with account A's saved metadata.
  // The completed authorization is written atomically below, and later refresh
  // cycles use the listener in getAuthorizedGoogleClient().
  const client = oauthClient();
  let prior: StoredGoogleAuthorization | null = null;
  try {
    prior = readGoogleAuthorization();
  } catch {
    // A fresh authorization is also the recovery path for a truncated or
    // manually damaged token file. Never let stale local bytes block sign-in.
    clearGoogleAuthorization();
  }
  const { tokens } = await client.getToken({ code: input.code, codeVerifier: pending.codeVerifier });
  client.setCredentials(tokens);

  let grantedScopes = splitScopes(tokens.scope);
  if (tokens.access_token) {
    try {
      grantedScopes = (await client.getTokenInfo(tokens.access_token)).scopes;
    } catch {
      // The token response's scope field remains the source of truth.
    }
  }
  let profile: GoogleUserInfo = {};
  try {
    profile = await googleUserInfo(client);
  } catch {
    // Workspace access can still be valid when the profile endpoint is unavailable.
  }
  if ((!profile.id || !profile.email) && tokens.id_token) {
    try {
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: requireGoogleOAuthConfig().clientId,
      });
      const payload = ticket.getPayload();
      profile = {
        id: profile.id ?? payload?.sub,
        email: profile.email ?? payload?.email,
      };
    } catch {
      // The verified userinfo response remains preferred; a missing identity
      // is surfaced immediately below.
    }
  }
  if (!profile.id && !profile.email) {
    throw new Error(
      "Google authorized the APIs but did not provide a verifiable account identity. Start sign-in again from Settings.",
    );
  }

  // Google can omit a refresh token when an account has already granted this
  // OAuth client. Reuse the prior one only when the newly authenticated
  // identity proves it is the same account; otherwise we could accidentally
  // pair account B's profile with account A's long-lived credential.
  const samePriorAccount = googleAccountIdentitiesMatch(
    { subject: profile.id, email: profile.email },
    prior,
  );
  const refreshToken = selectGoogleRefreshToken(
    tokens.refresh_token,
    prior?.refreshToken,
    samePriorAccount,
  );
  if (!refreshToken) {
    throw new Error(
      "Google did not return long-term access for this account. Remove Studio Assistant from your Google account permissions, then sign in again.",
    );
  }

  if (!grantedScopes.length) {
    // The exchange normally echoes the granted scopes. A same-account
    // reconnect can safely retain the last verified set; a new connection can
    // retain only what this just-consumed authorization request asked for.
    grantedScopes = samePriorAccount && prior ? prior.scopes : pending.scopes;
  }

  const now = new Date().toISOString();
  const authorization: StoredGoogleAuthorization = {
    version: 1,
    refreshToken,
    scopes: Array.from(new Set(grantedScopes)).sort(),
    email: profile.email ?? (samePriorAccount ? prior?.email : null) ?? null,
    subject: profile.id ?? (samePriorAccount ? prior?.subject : null) ?? null,
    connectedAt: samePriorAccount ? (prior?.connectedAt ?? now) : now,
    updatedAt: now,
  };
  writeGoogleAuthorization(authorization);
  cachedClient = null;
  cachedRefreshToken = "";
  return getGoogleConnectionStatus();
}

export async function getAuthorizedGoogleClient(
  requiredScopes: readonly string[] = [],
): Promise<Auth.OAuth2Client> {
  requireGoogleOAuthConfig();
  const authorization = readGoogleAuthorization();
  if (!authorization) throw new Error("Google is not connected. Sign in from Settings first.");
  if (!hasScopes(authorization.scopes, requiredScopes)) {
    const missing = requiredScopes.filter((scope) => !authorization.scopes.includes(scope));
    throw new Error(`Google needs permission for ${missing.map(friendlyScopeName).join(", ")}. Reconnect it in Settings.`);
  }

  if (!cachedClient || cachedRefreshToken !== authorization.refreshToken) {
    const client = attachRefreshPersistence(oauthClient(), authorization.refreshToken);
    client.setCredentials({ refresh_token: authorization.refreshToken });
    cachedClient = client;
    cachedRefreshToken = authorization.refreshToken;
  }

  // Checking on every provider entry is cheap while the cached access token is
  // fresh, and it lets us turn a later revoked refresh token into a clean local
  // disconnect instead of leaking a raw Google API error indefinitely.
  try {
    await cachedClient.getAccessToken();
  } catch (error) {
    if (invalidGrant(error)) {
      clearGoogleAuthorization();
      cachedClient = null;
      cachedRefreshToken = "";
      throw new Error("Google access expired or was revoked. Sign in again from Settings.");
    }
    throw error;
  }

  return cachedClient;
}

export async function disconnectGoogle() {
  cachedClient = null;
  cachedRefreshToken = "";
  // An already-open consent tab must not be able to recreate the connection
  // after the artist explicitly disconnects.
  clearPendingGoogleAuthorizations();
  let authorization: StoredGoogleAuthorization | null;
  try {
    authorization = readGoogleAuthorization();
  } catch {
    clearGoogleAuthorization();
    return {
      disconnected: true,
      revoked: false,
      warning: "The unreadable local Google token was removed; there was no valid token to revoke.",
    };
  }
  if (!authorization) return { disconnected: true, revoked: true };

  let warning: string | undefined;
  let revoked = false;
  try {
    await oauthClient().revokeToken(authorization.refreshToken);
    revoked = true;
  } catch {
    warning = "The local Google connection was removed, but Google could not confirm remote revocation.";
  } finally {
    clearGoogleAuthorization();
  }
  return { disconnected: true, revoked, ...(warning ? { warning } : {}) };
}
