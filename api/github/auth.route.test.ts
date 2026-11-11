import { describe, expect, it } from "vitest";

const clientSecret = "test-client-secret";

describe("github oauth routes", () => {
  it("redirects to GitHub and keeps the client secret off the browser", async () => {
    process.env.APP_ID = "app";
    process.env.APP_SECRET = "app-secret";
    process.env.DATABASE_URL = "mysql://berta:berta@127.0.0.1:3306/berta";
    process.env.KIMI_AUTH_URL = "https://auth.example";
    process.env.KIMI_OPEN_URL = "https://open.example";
    process.env.GITHUB_CLIENT_ID = "Iv1.test";
    process.env.GITHUB_CLIENT_SECRET = clientSecret;
    process.env.GITHUB_OAUTH_REDIRECT_URL = "https://app.bertapp.life/api/oauth/callback";
    process.env.OWNER_GITHUB_ID = "7";
    const { default: app } = await import("../boot");
    const response = await app.request("http://localhost/api/oauth/github");
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.test");
    expect(url.searchParams.get("client_secret")).toBeNull();
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.bertapp.life/api/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(url.searchParams.get("state")?.startsWith("gh:")).toBe(true);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("gh_oauth_state=");
    expect(setCookie).toContain("HttpOnly");
    expect(location).not.toContain(clientSecret);
    expect(setCookie).not.toContain(clientSecret);

    const callback = await app.request("http://localhost/api/oauth/callback?code=abc&state=gh:does-not-match");
    expect(callback.status).toBe(302);
    const redirect = callback.headers.get("location") ?? "";
    expect(redirect).toBe("/login?oauth=invalid_state");
    expect(redirect).not.toContain(clientSecret);
    expect(redirect).not.toContain("abc");
    const body = await callback.text();
    expect(body).not.toContain(clientSecret);
    expect(body).not.toContain("abc");
  });
});

