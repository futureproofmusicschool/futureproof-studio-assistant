import { cancelGoogleAuthorization, completeGoogleAuthorization } from "@/lib/google/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resultPage(title: string, message: string, ok: boolean) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111114; color: #f5f2fb; }
      main { width: min(32rem, calc(100vw - 3rem)); padding: 2rem; border: 1px solid #34303d; border-radius: 1rem; background: #19171e; }
      .mark { width: .75rem; height: .75rem; border-radius: 999px; background: ${ok ? "#61d095" : "#ed7474"}; }
      h1 { margin: 1rem 0 .6rem; font-size: 1.45rem; }
      p { margin: 0; color: #bbb5c6; line-height: 1.55; }
    </style>
  </head>
  <body><main><div class="mark"></div><h1>${safeTitle}</h1><p>${safeMessage}</p></main></body>
</html>`,
    {
      status: ok ? 200 : 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  const oauthError = params.get("error");

  if (oauthError) {
    if (state) {
      try {
        cancelGoogleAuthorization(state);
      } catch {
        // It may already have expired; the user-facing denial is still clear.
      }
    }
    return resultPage(
      "Google was not connected",
      oauthError === "access_denied"
        ? "Permission was not granted. You can close this tab and try again from Settings."
        : "Google could not complete authorization. Close this tab and try again from Settings.",
      false,
    );
  }

  if (!state || !code) {
    return resultPage("Google was not connected", "The authorization response was incomplete. Start again from Settings.", false);
  }

  try {
    const status = await completeGoogleAuthorization({ state, code });
    return resultPage(
      "Google connected",
      `${status.email ? `${status.email} is connected. ` : "Your Google account is connected. "}You can close this tab and return to Studio Assistant.`,
      true,
    );
  } catch (error) {
    return resultPage(
      "Google was not connected",
      error instanceof Error ? error.message : "Authorization failed. Close this tab and try again from Settings.",
      false,
    );
  }
}
