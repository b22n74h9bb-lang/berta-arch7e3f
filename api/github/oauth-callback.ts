import { loginRedirect, oauthMessage, type OauthLoginReason } from "@contracts/oauth";

export { loginRedirect, oauthMessage, type OauthLoginReason };

export function describeCallbackArrival(input: {
  hasCode: boolean;
  hasState: boolean;
  stateKind: "github" | "other" | "missing";
  hasCookieState: boolean;
  providerError: string | undefined;
}): {
  hasCode: boolean;
  hasState: boolean;
  stateKind: "github" | "other" | "missing";
  hasCookieState: boolean;
  providerError: "access_denied" | "provider_error" | null;
} {
  let providerError: "access_denied" | "provider_error" | null = null;
  if (input.providerError === "access_denied") providerError = "access_denied";
  else if (input.providerError) providerError = "provider_error";
  return {
    hasCode: input.hasCode,
    hasState: input.hasState,
    stateKind: input.stateKind,
    hasCookieState: input.hasCookieState,
    providerError,
  };
}

export function stateKindFromQuery(state: string | undefined): "github" | "other" | "missing" {
  if (!state) return "missing";
  return state.startsWith("gh:") ? "github" : "other";
}
