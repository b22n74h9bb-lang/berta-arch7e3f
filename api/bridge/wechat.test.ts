import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { wechatCallbackDecision, wechatReadiness, wechatSecretPresence, wechatSignature, wechatSignatureValid } from "./wechat";

describe("wechat signature", () => {
  it("matches the official sorted SHA1 handshake and rejects a mismatch", () => {
    const token = "callback-token";
    const timestamp = "1700000000";
    const nonce = "nonce";
    const signature = createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
    expect(wechatSignature({ token, timestamp, nonce })).toBe(signature);
    expect(wechatSignatureValid({ token, timestamp, nonce, signature })).toBe(true);
    expect(wechatSignatureValid({ token, timestamp, nonce, signature: "0".repeat(40) })).toBe(false);
    expect(wechatSignatureValid({ token: "", timestamp, nonce, signature })).toBe(false);
  });
});

describe("wechat readiness", () => {
  it("stays disconnected even when every owner gate is ready", () => {
    const ready = wechatReadiness({
      adapterFlag: "enabled",
      secrets: {
        WECHAT_APP_ID: true,
        WECHAT_APP_SECRET: true,
        WECHAT_TOKEN: true,
        WECHAT_ENCODING_AES_KEY: true,
      },
      pluginStatus: "approved",
    });
    expect(ready.connected).toBe(false);
    expect(ready.shipped).toBe(false);
    expect(ready.gates.find((gate) => gate.id === "callback_shipped")?.ok).toBe(false);
    expect(ready.accountModes).toEqual(["official-account", "wecom"]);

    const presence = wechatSecretPresence({
      WECHAT_APP_ID: "wx-app",
      WECHAT_APP_SECRET: "super-secret",
      WECHAT_TOKEN: "",
      WECHAT_ENCODING_AES_KEY: "aes",
    });
    expect(presence).toEqual({
      WECHAT_APP_ID: true,
      WECHAT_APP_SECRET: true,
      WECHAT_TOKEN: false,
      WECHAT_ENCODING_AES_KEY: true,
    });
    expect(JSON.stringify(presence)).not.toContain("super-secret");
  });
});

describe("wechat callback route", () => {
  beforeEach(() => {
    process.env.APP_ID = "app";
    process.env.APP_SECRET = "app-secret";
    process.env.DATABASE_URL = "mysql://berta:berta@127.0.0.1:3306/berta";
    process.env.KIMI_AUTH_URL = "https://auth.example";
    process.env.KIMI_OPEN_URL = "https://open.example";
    process.env.WECHAT_ADAPTER = "enabled";
    process.env.WECHAT_APP_ID = "wx-app";
    process.env.WECHAT_APP_SECRET = "do-not-leak";
    process.env.WECHAT_TOKEN = "callback-token";
    process.env.WECHAT_ENCODING_AES_KEY = "encoding-key";
  });

  it("stays disabled even when the flag, secrets, and a valid signature are present", async () => {
    const echostr = "echo-from-wechat";
    const decision = wechatCallbackDecision({
      adapterFlag: "enabled",
      echostr,
      token: "callback-token",
      signature: "abc",
    });
    expect(decision.status).toBe(503);
    expect(JSON.stringify(decision.body)).not.toContain(echostr);
    expect(JSON.stringify(decision.body)).not.toContain("callback-token");

    const { default: app } = await import("../boot");
    const response = await app.request(
      "http://localhost/api/wechat/callback?signature=abc&timestamp=1&nonce=n&echostr=echo-from-wechat",
      { method: "GET" },
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("wechat_disabled");
    expect(body).not.toContain("echo-from-wechat");
    expect(body).not.toContain("do-not-leak");
    expect(body).not.toContain("callback-token");

    const posted = await app.request("http://localhost/api/wechat/callback", {
      method: "POST",
      body: "<xml><Content>hello</Content></xml>",
      headers: { "content-type": "text/xml" },
    });
    expect(posted.status).toBe(503);
    expect(await posted.text()).not.toContain("hello");
  });
});
