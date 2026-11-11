/** Safe reasons returned to /login — never include codes, tokens, or secrets. */
export const OAUTH_LOGIN_REASONS = [
  "denied",
  "provider_error",
  "missing_code",
  "invalid_state",
  "failed",
  "disabled",
] as const;

export type OauthLoginReason = (typeof OAUTH_LOGIN_REASONS)[number];

export function loginRedirect(reason: OauthLoginReason): string {
  return `/login?oauth=${reason}`;
}

export function oauthMessage(reason: string | null): string | null {
  switch (reason) {
    case "denied":
      return "GitHub sign-in was cancelled. Start again from this page.";
    case "provider_error":
      return "GitHub could not finish sign-in. Start again from this page.";
    case "missing_code":
      return "Sign-in did not return a code. Start again from this page.";
    case "invalid_state":
      return "Sign-in expired or the browser lost the session cookie. Start again from this page — do not reuse an old tab.";
    case "failed":
      return "GitHub sign-in failed. Start again from this page.";
    case "disabled":
      return "GitHub sign-in is not configured on this host.";
    default:
      return null;
  }
}
