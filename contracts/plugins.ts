/** Claw plugin contract. Shared by the API and the owner settings panel. */

export const PLUGIN_ACTIONS = [
  "mission.create",
  "task.assign",
  "comment.add",
  "approval.request",
] as const;

export const PLUGIN_HOOK_EVENTS = [
  "mission.updated",
  "task.updated",
  "approval.requested",
  "approval.decided",
] as const;

export const PLUGIN_KINDS = ["first-party", "third-party"] as const;
export const PLUGIN_SURFACES = ["extension", "wechat"] as const;
export const PLUGIN_STATUSES = ["pending", "approved", "revoked"] as const;

export type PluginAction = (typeof PLUGIN_ACTIONS)[number];
export type PluginHookEvent = (typeof PLUGIN_HOOK_EVENTS)[number];
export type PluginKind = (typeof PLUGIN_KINDS)[number];
export type PluginSurface = (typeof PLUGIN_SURFACES)[number];
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

/** Plugins run with no host credentials and no network of their own. */
export type PluginIsolation = "sandbox";

export const WECHAT_PLUGIN_NAME = "wechat-official";
export const WECHAT_PLUGIN_VERSION = "0.1.0";

export const WECHAT_SECRET_NAMES = [
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "WECHAT_TOKEN",
  "WECHAT_ENCODING_AES_KEY",
] as const;

export type WechatSecretName = (typeof WECHAT_SECRET_NAMES)[number];

export type PluginConfig = Record<string, string>;

export type PluginManifest = {
  name: string;
  version: string;
  kind: PluginKind;
  surface: PluginSurface;
  isolation: PluginIsolation;
  scopes: PluginAction[];
  hooks: PluginHookEvent[];
  config: PluginConfig;
};

export type ParsedPluginManifest = {
  manifest: PluginManifest;
  valid: boolean;
};

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const CONFIG_KEY_RE = /^[a-z][a-z0-9_]{0,32}$/;
const SECRET_KEY_RE = /secret|token|password|credential|webhook|aes|private|key/i;
const RESERVED_PREFIX_RE = /^(wechat|berta)(-|$)/;

export type PluginRegistrationInput = {
  name: string;
  version: string;
  kind: PluginKind;
  surface: PluginSurface;
  scopes: readonly string[];
  hooks: readonly string[];
  config?: Record<string, string>;
};

export type PluginRegistrationResult =
  | { ok: true; manifest: PluginManifest; storedScopes: string }
  | { ok: false; message: string };

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isAction(value: string): value is PluginAction {
  return (PLUGIN_ACTIONS as readonly string[]).includes(value);
}

function isHook(value: string): value is PluginHookEvent {
  return (PLUGIN_HOOK_EVENTS as readonly string[]).includes(value);
}

function configAllowed(surface: PluginSurface, config: PluginConfig): string | null {
  const keys = Object.keys(config);
  if (keys.length > 8) return "Plugin configuration accepts at most 8 fields.";
  for (const key of keys) {
    if (!CONFIG_KEY_RE.test(key) || SECRET_KEY_RE.test(key)) {
      return "Configuration fields cannot carry secrets. Use host environment names instead.";
    }
    const value = config[key]?.trim() ?? "";
    if (!value || value.length > 80 || /[\r\n]/.test(value) || value.includes("://")) {
      return "Configuration values must be short labels, not URLs or secrets.";
    }
  }
  if (surface === "wechat") {
    const allowed = new Set(["account_mode", "display_name"]);
    if (keys.some((key) => !allowed.has(key))) {
      return "WeChat configuration only accepts account_mode and display_name.";
    }
    if (config.account_mode && config.account_mode !== "official-account" && config.account_mode !== "wecom") {
      return "WeChat account_mode must be official-account or wecom.";
    }
  } else if (keys.some((key) => key !== "display_name")) {
    return "Extension configuration only accepts display_name.";
  }
  return null;
}

/** Owner registration. Status is never accepted from the caller. */
export function registerPluginManifest(input: PluginRegistrationInput): PluginRegistrationResult {
  const name = input.name.trim();
  const version = input.version.trim();
  if (!NAME_RE.test(name)) {
    return { ok: false, message: "Plugin name must be 3–64 lowercase letters, numbers, or hyphens." };
  }
  if (!VERSION_RE.test(version)) {
    return { ok: false, message: "Plugin version must be a plain major.minor.patch number." };
  }
  if (input.surface === "wechat" && (input.kind !== "first-party" || name !== WECHAT_PLUGIN_NAME)) {
    return { ok: false, message: "WeChat is a first-party adapter named wechat-official. It cannot be registered as a third-party plugin." };
  }
  if (input.kind === "third-party" && RESERVED_PREFIX_RE.test(name)) {
    return { ok: false, message: "That name is reserved for first-party adapters." };
  }
  const scopes = unique(input.scopes);
  if (scopes.length === 0 || scopes.length > PLUGIN_ACTIONS.length || scopes.some((scope) => !isAction(scope))) {
    return { ok: false, message: "Choose one or more explicit plugin actions. Wildcards are rejected." };
  }
  const hooks = unique(input.hooks);
  if (hooks.length > PLUGIN_HOOK_EVENTS.length || hooks.some((hook) => !isHook(hook))) {
    return { ok: false, message: "Hook subscriptions must be explicit event names." };
  }
  const config: PluginConfig = {};
  for (const [key, value] of Object.entries(input.config ?? {})) config[key] = value.trim();
  const configError = configAllowed(input.surface, config);
  if (configError) return { ok: false, message: configError };

  const manifest: PluginManifest = {
    name,
    version,
    kind: input.kind,
    surface: input.surface,
    isolation: "sandbox",
    scopes: scopes.filter(isAction),
    hooks: hooks.filter(isHook),
    config,
  };
  return { ok: true, manifest, storedScopes: encodePluginManifest(manifest) };
}

export function encodePluginManifest(manifest: PluginManifest): string {
  return JSON.stringify({
    actions: manifest.scopes,
    kind: manifest.kind,
    surface: manifest.surface,
    hooks: manifest.hooks,
    config: manifest.config,
    isolation: "sandbox",
  });
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Reads the scopes column. Legacy comma lists stay action-only and sandboxed. */
export function parseStoredScopes(name: string, version: string, stored: string): ParsedPluginManifest {
  const fallback: PluginManifest = {
    name,
    version,
    kind: "third-party",
    surface: "extension",
    isolation: "sandbox",
    scopes: [],
    hooks: [],
    config: {},
  };
  const trimmed = stored.trim();
  if (!trimmed.startsWith("{")) {
    const scopes = unique(trimmed.split(/[,\s]+/).filter(Boolean)).filter(isAction);
    return { valid: scopes.length > 0 || trimmed.length === 0, manifest: { ...fallback, scopes } };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.isolation !== undefined && parsed.isolation !== "sandbox") {
      return { valid: false, manifest: fallback };
    }
    const kind = parsed.kind === "first-party" || parsed.kind === "third-party" ? parsed.kind : null;
    const surface = parsed.surface === "extension" || parsed.surface === "wechat" ? parsed.surface : null;
    if (!kind || !surface) return { valid: false, manifest: fallback };
    const scopes = unique(asStringArray(parsed.actions)).filter(isAction);
    const hooks = unique(asStringArray(parsed.hooks)).filter(isHook);
    const config: PluginConfig = {};
    if (parsed.config && typeof parsed.config === "object" && !Array.isArray(parsed.config)) {
      for (const [key, value] of Object.entries(parsed.config)) {
        if (typeof value === "string") config[key] = value;
      }
    }
    if (configAllowed(surface, config)) return { valid: false, manifest: { ...fallback, kind, surface, scopes, hooks } };
    return {
      valid: true,
      manifest: { name, version, kind, surface, isolation: "sandbox", scopes, hooks, config },
    };
  } catch {
    return { valid: false, manifest: fallback };
  }
}

export type PluginDecisionAction = "approve" | "revoke";

export type PluginDecision =
  | { ok: true; changed: false; status: PluginStatus; issueToken: false }
  | { ok: true; changed: true; status: PluginStatus; tokenGeneration: number; issueToken: boolean };

/** Approval never comes from the manifest. Revoke bumps the generation so old tokens die. */
export function decidePlugin(input: {
  action: PluginDecisionAction;
  status: PluginStatus;
  tokenGeneration: number;
}): PluginDecision {
  if (input.action === "approve") {
    if (input.status === "approved") return { ok: true, changed: false, status: "approved", issueToken: false };
    return {
      ok: true,
      changed: true,
      status: "approved",
      tokenGeneration: input.tokenGeneration + 1,
      issueToken: true,
    };
  }
  if (input.status === "revoked") return { ok: true, changed: false, status: "revoked", issueToken: false };
  return {
    ok: true,
    changed: true,
    status: "revoked",
    tokenGeneration: input.tokenGeneration + 1,
    issueToken: false,
  };
}

export type HookCandidate = {
  id: number;
  status: PluginStatus;
  hooks: readonly string[];
  isolation: PluginIsolation | string;
  manifestValid: boolean;
};

/** Approved sandbox plugins whose subscription lists this exact event. No wildcards, no delivery. */
export function selectHookRecipients(event: string, plugins: readonly HookCandidate[]): number[] {
  if (!isHook(event)) return [];
  return plugins
    .filter((plugin) => plugin.manifestValid && plugin.status === "approved" && plugin.isolation === "sandbox" && plugin.hooks.includes(event))
    .map((plugin) => plugin.id);
}

export function dispatchPluginHooks(input: {
  hooksEnabled: boolean;
  event: string;
  plugins: readonly HookCandidate[];
}): { delivered: false; reason: "hooks_disabled" | "hooks_not_shipped" | "no_recipients"; recipientIds: number[] } {
  if (!input.hooksEnabled) return { delivered: false, reason: "hooks_disabled", recipientIds: [] };
  const recipientIds = selectHookRecipients(input.event, input.plugins);
  if (recipientIds.length === 0) return { delivered: false, reason: "no_recipients", recipientIds: [] };
  return { delivered: false, reason: "hooks_not_shipped", recipientIds };
}
