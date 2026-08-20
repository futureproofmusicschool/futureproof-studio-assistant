import "server-only";

import fs from "node:fs";
import { dataPath } from "@/lib/paths";
import {
  clearGoogleAuthorization,
  clearPendingGoogleAuthorizations,
  writePrivateGoogleJson,
} from "@/lib/google/store";

/**
 * Google Workspace access is deliberately narrower than the Gemini API key.
 * These scopes authorize the signed-in artist's account; they are never sent
 * to Gemini or exposed as bearer tokens in the renderer.
 */
export const GOOGLE_SCOPES = {
  openid: "openid",
  email: "https://www.googleapis.com/auth/userinfo.email",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
  contacts: "https://www.googleapis.com/auth/contacts",
} as const;

export type GoogleService = "drive" | "gmail" | "contacts";

export const GOOGLE_SERVICES: readonly GoogleService[] = ["drive", "gmail", "contacts"];

export const GOOGLE_SERVICE_SCOPES: Record<GoogleService, readonly string[]> = {
  drive: [GOOGLE_SCOPES.driveFile],
  gmail: [GOOGLE_SCOPES.gmailCompose],
  contacts: [GOOGLE_SCOPES.contacts],
};

export const GOOGLE_OAUTH_CLIENT_PATH = dataPath("google", "oauth-client.json");

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  source: "environment" | "oauth-client.json";
};

type OAuthClientFile = {
  clientId?: unknown;
  clientSecret?: unknown;
  redirectUri?: unknown;
  client_id?: unknown;
  client_secret?: unknown;
  redirect_uri?: unknown;
  installed?: OAuthClientSection;
  web?: OAuthClientSection;
};

type OAuthClientSection = {
  client_id?: unknown;
  client_secret?: unknown;
  redirect_uris?: unknown;
};

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultRedirectUri() {
  const port = Number(process.env.PORT || 3017);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a valid TCP port before Google OAuth can be configured.");
  }
  return `http://127.0.0.1:${port}/api/google/auth/callback`;
}

function validateRedirectUri(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The Google OAuth redirect URI is not a valid URL.");
  }

  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/api/google/auth/callback" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "The Google OAuth redirect URI must be the loopback callback http://127.0.0.1:<port>/api/google/auth/callback.",
    );
  }

  return url.toString();
}

function readClientFile(): OAuthClientFile | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(GOOGLE_OAUTH_CLIENT_PATH, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as OAuthClientFile) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error(`${GOOGLE_OAUTH_CLIENT_PATH} is not valid JSON.`);
    }
    throw error;
  }
}

function configFromFile(file: OAuthClientFile) {
  // Accept both a small app-owned shape and Google's downloaded Desktop OAuth
  // client JSON. A desktop client is public, so its client secret is optional
  // here and must never be treated as protection for the installed app.
  const section = file.installed ?? file.web;
  const clientId = nonEmpty(file.clientId) ?? nonEmpty(file.client_id) ?? nonEmpty(section?.client_id);
  const clientSecret =
    nonEmpty(file.clientSecret) ?? nonEmpty(file.client_secret) ?? nonEmpty(section?.client_secret);
  const redirectUri = nonEmpty(file.redirectUri) ?? nonEmpty(file.redirect_uri) ?? defaultRedirectUri();
  return { clientId, clientSecret, redirectUri };
}

function validateClientId(value: string | undefined) {
  if (!value) throw new Error("A Google Desktop OAuth client ID is required.");
  if (!value.endsWith(".apps.googleusercontent.com")) {
    throw new Error("That does not look like a Google OAuth client ID.");
  }
  return value;
}

export function readGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const envClientId = nonEmpty(process.env.GOOGLE_OAUTH_CLIENT_ID);
  if (envClientId) {
    return {
      clientId: envClientId,
      ...(nonEmpty(process.env.GOOGLE_OAUTH_CLIENT_SECRET)
        ? { clientSecret: nonEmpty(process.env.GOOGLE_OAUTH_CLIENT_SECRET) }
        : {}),
      redirectUri: validateRedirectUri(
        nonEmpty(process.env.GOOGLE_OAUTH_REDIRECT_URI) ?? defaultRedirectUri(),
      ),
      source: "environment",
    };
  }

  const file = readClientFile();
  if (!file) return null;
  const parsed = configFromFile(file);
  if (!parsed.clientId) {
    throw new Error(`${GOOGLE_OAUTH_CLIENT_PATH} does not contain a Google OAuth client ID.`);
  }

  return {
    clientId: parsed.clientId,
    ...(parsed.clientSecret ? { clientSecret: parsed.clientSecret } : {}),
    redirectUri: validateRedirectUri(parsed.redirectUri),
    source: "oauth-client.json",
  };
}

export function requireGoogleOAuthConfig() {
  const config = readGoogleOAuthConfig();
  if (!config) {
    throw new Error(
      `Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID or add a Desktop OAuth client at ${GOOGLE_OAUTH_CLIENT_PATH}.`,
    );
  }
  return config;
}

export function googleOAuthConfigStatus() {
  try {
    const config = readGoogleOAuthConfig();
    return config
      ? {
          configured: true as const,
          source: config.source,
          redirectUri: config.redirectUri,
          credentialFile: GOOGLE_OAUTH_CLIENT_PATH,
        }
      : {
          configured: false as const,
          source: null,
          redirectUri: defaultRedirectUri(),
          credentialFile: GOOGLE_OAUTH_CLIENT_PATH,
        };
  } catch (error) {
    return {
      configured: false as const,
      source: null,
      redirectUri: defaultRedirectUri(),
      credentialFile: GOOGLE_OAUTH_CLIENT_PATH,
      error: error instanceof Error ? error.message : "Google OAuth configuration is invalid.",
    };
  }
}

export function writeGoogleOAuthClientConfig(input: {
  clientId?: unknown;
  clientSecret?: unknown;
  json?: unknown;
}) {
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  if (typeof input.json === "string" && input.json.trim()) {
    let downloaded: OAuthClientFile;
    try {
      const parsed: unknown = JSON.parse(input.json);
      if (typeof parsed !== "object" || parsed === null) throw new Error();
      downloaded = parsed as OAuthClientFile;
    } catch {
      throw new Error("The pasted Google OAuth client JSON is not valid JSON.");
    }
    if (downloaded.web && !downloaded.installed && !nonEmpty(downloaded.clientId)) {
      throw new Error("Use a Desktop app OAuth client, not a Web application OAuth client.");
    }
    const parsed = configFromFile(downloaded);
    clientId = parsed.clientId;
    clientSecret = parsed.clientSecret;
  } else {
    clientId = nonEmpty(input.clientId);
    clientSecret = nonEmpty(input.clientSecret);
  }

  const normalizedId = validateClientId(clientId);
  const redirectUri = defaultRedirectUri();
  // Tokens and pending PKCE exchanges are tied to the client that issued
  // them. Never let either silently cross an OAuth client replacement.
  clearGoogleAuthorization();
  clearPendingGoogleAuthorizations();
  writePrivateGoogleJson(GOOGLE_OAUTH_CLIENT_PATH, {
    installed: {
      client_id: normalizedId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      redirect_uris: [redirectUri],
    },
  });
  return googleOAuthConfigStatus();
}

export function parseGoogleServices(value: string | null | undefined): GoogleService[] {
  if (!value?.trim()) return [...GOOGLE_SERVICES];
  const requested = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const unknown = requested.filter((item) => !(GOOGLE_SERVICES as readonly string[]).includes(item));
  if (unknown.length) throw new Error(`Unknown Google service: ${unknown.join(", ")}.`);
  return Array.from(new Set(requested)) as GoogleService[];
}

export function scopesForGoogleServices(services: readonly GoogleService[]) {
  return Array.from(
    new Set([
      GOOGLE_SCOPES.openid,
      GOOGLE_SCOPES.email,
      ...services.flatMap((service) => GOOGLE_SERVICE_SCOPES[service]),
    ]),
  );
}
