import { describe, expect, it } from "vitest";
import { loginRedirect, oauthMessage } from "@contracts/oauth";
import { describeCallbackArrival, stateKindFromQuery } from "./oauth-callback";

describe("oauth callback helpers", () => {
  it("maps failures to safe login redirects without leaking codes", () => {
    expect(loginRedirect("invalid_state")).toBe("/login?oauth=invalid_state");
    expect(oauthMessage("invalid_state")).toContain("Start again");
    expect(oauthMessage("not-a-reason")).toBeNull();
  });

  it("describes callback arrival without storing secrets", () => {
    expect(stateKindFromQuery("gh:abc")).toBe("github");
    expect(stateKindFromQuery("other")).toBe("other");
    expect(describeCallbackArrival({
      hasCode: true,
      hasState: true,
      stateKind: "github",
      hasCookieState: false,
      providerError: "access_denied",
    })).toEqual({
      hasCode: true,
      hasState: true,
      stateKind: "github",
      hasCookieState: false,
      providerError: "access_denied",
    });
  });
});
