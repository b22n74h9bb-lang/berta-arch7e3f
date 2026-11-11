import { createHash, timingSafeEqual } from "node:crypto";
import {
  WECHAT_SECRET_NAMES,
  type PluginStatus,
  type WechatSecretName,
} from "@contracts/plugins";

/**
 * Official WeChat callback signature (SHA1 of the sorted token, timestamp, and nonce).
 * This is their documented handshake, not a password hash. Nothing in this build returns echostr.
 */
export function wechatSignature(input: { token: string; timestamp: string; nonce: string }): string {
  const joined = [input.token, input.timestamp, input.nonce].sort().join("");
  return createHash("sha1").update(joined).digest("hex");
}

export function wechatSignatureValid(input: {
  token: string;
  timestamp: string;
  nonce: string;
  signature: string | undefined;
}): boolean {
  if (!input.token || !input.signature) return false;
  const expected = wechatSignature(input);
  const left = Buffer.from(expected);
  const right = Buffer.from(input.signature.trim());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function wechatSecretPresence(source: NodeJS.ProcessEnv): Record<WechatSecretName, boolean> {
  return {
    WECHAT_APP_ID: Boolean(source.WECHAT_APP_ID?.trim()),
    WECHAT_APP_SECRET: Boolean(source.WECHAT_APP_SECRET?.trim()),
    WECHAT_TOKEN: Boolean(source.WECHAT_TOKEN?.trim()),
    WECHAT_ENCODING_AES_KEY: Boolean(source.WECHAT_ENCODING_AES_KEY?.trim()),
  };
}

export type WechatReadiness = {
  connected: false;
  shipped: false;
  accountModes: ["official-account", "wecom"];
  gates: { id: string; ok: boolean; label: string }[];
};

/** Checklist only. `connected` stays false until a later owner-approved build mounts delivery. */
export function wechatReadiness(input: {
  adapterFlag: string | undefined;
  secrets: Record<WechatSecretName, boolean>;
  pluginStatus: PluginStatus | "absent";
}): WechatReadiness {
  const secretsReady = WECHAT_SECRET_NAMES.every((name) => input.secrets[name]);
  return {
    connected: false,
    shipped: false,
    accountModes: ["official-account", "wecom"],
    gates: [
      {
        id: "adapter_flag",
        ok: input.adapterFlag?.trim() === "enabled",
        label: "Host flag WECHAT_ADAPTER=enabled",
      },
      {
        id: "secret_names",
        ok: secretsReady,
        label: "Host has WECHAT_APP_ID, WECHAT_APP_SECRET, WECHAT_TOKEN, and WECHAT_ENCODING_AES_KEY",
      },
      {
        id: "plugin_approved",
        ok: input.pluginStatus === "approved",
        label: "Owner approved the first-party wechat-official plugin",
      },
      {
        id: "callback_shipped",
        ok: false,
        label: "Callback delivery is not shipped in this build",
      },
    ],
  };
}

/**
 * Ingress stays disabled in code. Environment flags and a valid signature cannot turn it on.
 * The ignored argument exists so callers cannot accidentally branch on echostr here.
 */
export function wechatCallbackDecision(_input?: {
  adapterFlag?: string;
  echostr?: string;
  token?: string;
  signature?: string;
}): { status: 503; body: { error: "wechat_disabled"; shipped: false } } {
  return { status: 503, body: { error: "wechat_disabled", shipped: false } };
}
