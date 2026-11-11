import { useState } from "react";
import { toast } from "sonner";
import {
  PLUGIN_ACTIONS,
  PLUGIN_HOOK_EVENTS,
  WECHAT_PLUGIN_NAME,
  WECHAT_PLUGIN_VERSION,
  type PluginAction,
  type PluginHookEvent,
  type PluginKind,
  type PluginSurface,
} from "@contracts/plugins";
import { trpc } from "@/providers/trpc";

export function PluginsPanel() {
  const utils = trpc.useUtils();
  const plugins = trpc.plugins.list.useQuery(undefined, { retry: false });
  const readiness = trpc.plugins.wechatReadiness.useQuery(undefined, { retry: false });
  const [name, setName] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [kind, setKind] = useState<PluginKind>("first-party");
  const [surface, setSurface] = useState<PluginSurface>("extension");
  const [scopes, setScopes] = useState<PluginAction[]>(["comment.add"]);
  const [hooks, setHooks] = useState<PluginHookEvent[]>([]);
  const [accountMode, setAccountMode] = useState<"official-account" | "wecom">("wecom");
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([
      utils.plugins.list.invalidate(),
      utils.plugins.wechatReadiness.invalidate(),
    ]);
  };

  const register = trpc.plugins.register.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Registered as pending. Nothing runs until you approve it.");
    },
    onError: (error) => toast.error(error.message),
  });
  const decide = trpc.plugins.decide.useMutation({
    onSuccess: async (result) => {
      await refresh();
      if (result.token) {
        setTokenNotice(result.token);
        toast.success("Approved. Copy the token from this page now. It will not be shown again.");
        return;
      }
      setTokenNotice(null);
      toast.success(
        result.status === "revoked"
          ? "Revoked. Existing plugin tokens for that version no longer match."
          : "No change. Revoke an approved plugin before issuing another token.",
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const toggle = <T extends string>(list: T[], value: T, setList: (next: T[]) => void) => {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const fillWechat = () => {
    setName(WECHAT_PLUGIN_NAME);
    setVersion(WECHAT_PLUGIN_VERSION);
    setKind("first-party");
    setSurface("wechat");
    setScopes(["approval.request", "comment.add"]);
    setHooks(["approval.decided"]);
    setAccountMode("wecom");
  };

  return (
    <section className="data-section">
      <div className="section-heading">
        <div>
          <span className="micro-label">CLAW PLUGINS</span>
          <h2>Extensions</h2>
        </div>
      </div>
      <p className="section-description">
        Plugins stay pending until you approve them. Third-party plugins are not enabled from here, hook delivery is not shipped, and WeChat does not connect.
      </p>

      <div className="plugin-readiness">
        <h3>WeChat</h3>
        {readiness.isLoading && <p className="section-description">Checking the WeChat gate.</p>}
        {readiness.isError && <p className="section-description">{readiness.error.message}</p>}
        {readiness.data && (
          <>
            <p className="section-description">
              Official Account or WeCom only. Connected: no. Callback shipped: no.
            </p>
            <ul className="boundary-list">
              {readiness.data.gates.map((gate) => (
                <li key={gate.id}>{gate.ok ? "Ready" : "Not ready"} — {gate.label}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <form
        className="connection-form"
        onSubmit={(event) => {
          event.preventDefault();
          const config: Record<string, string> = surface === "wechat"
            ? { account_mode: accountMode, display_name: "Berta" }
            : { display_name: name };
          register.mutate({ name, version, kind, surface, scopes, hooks, config });
        }}
      >
        <div className="inline-form">
          <button type="button" className="button button--secondary button--small" onClick={fillWechat}>
            Fill WeChat draft
          </button>
        </div>
        <label htmlFor="plugin-name">Name</label>
        <input id="plugin-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="mission-notes" autoComplete="off" />
        <label htmlFor="plugin-version">Version</label>
        <input id="plugin-version" value={version} onChange={(event) => setVersion(event.target.value)} autoComplete="off" />
        <label htmlFor="plugin-kind">Kind</label>
        <select id="plugin-kind" value={kind} onChange={(event) => setKind(event.target.value as PluginKind)}>
          <option value="first-party">First-party</option>
          <option value="third-party">Third-party</option>
        </select>
        <label htmlFor="plugin-surface">Surface</label>
        <select id="plugin-surface" value={surface} onChange={(event) => setSurface(event.target.value as PluginSurface)}>
          <option value="extension">Extension</option>
          <option value="wechat">WeChat</option>
        </select>
        {surface === "wechat" && (
          <>
            <label htmlFor="plugin-account-mode">WeChat account mode</label>
            <select
              id="plugin-account-mode"
              value={accountMode}
              onChange={(event) => setAccountMode(event.target.value as "official-account" | "wecom")}
            >
              <option value="wecom">WeCom</option>
              <option value="official-account">Official Account</option>
            </select>
          </>
        )}
        <fieldset className="plugin-checks">
          <legend>Actions</legend>
          {PLUGIN_ACTIONS.map((action) => (
            <label key={action}>
              <input
                type="checkbox"
                checked={scopes.includes(action)}
                onChange={() => toggle(scopes, action, setScopes)}
              />
              {action}
            </label>
          ))}
        </fieldset>
        <fieldset className="plugin-checks">
          <legend>Hook subscriptions</legend>
          {PLUGIN_HOOK_EVENTS.map((hook) => (
            <label key={hook}>
              <input
                type="checkbox"
                checked={hooks.includes(hook)}
                onChange={() => toggle(hooks, hook, setHooks)}
              />
              {hook}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="button button--primary button--small" disabled={register.isPending || scopes.length === 0}>
          Register as pending
        </button>
      </form>

      {tokenNotice && (
        <div className="plugin-token">
          <p>Plugin token, shown once. Do not paste it into Slack. No route in this build accepts it.</p>
          <code>{tokenNotice}</code>
          <button type="button" className="button button--secondary button--small" onClick={() => setTokenNotice(null)}>
            Hide token
          </button>
        </div>
      )}

      {plugins.isLoading && <p className="section-description">Loading plugins.</p>}
      {plugins.isError && <p className="section-description">{plugins.error.message}</p>}
      {plugins.data && plugins.data.length === 0 && (
        <p className="section-description">No plugins registered.</p>
      )}
      {plugins.data && plugins.data.length > 0 && (
        <div className="member-list">
          {plugins.data.map((plugin) => (
            <div key={plugin.id} className="member-row">
              <div>
                <h3>{plugin.name} {plugin.version}</h3>
                <span className="member-status">
                  {plugin.status} · {plugin.kind} · {plugin.surface} · {plugin.isolation}
                  {plugin.manifestValid ? "" : " · manifest invalid"}
                </span>
              </div>
              <div className="member-actions">
                {plugin.status !== "approved" && (
                  <button
                    type="button"
                    className="button button--primary button--small"
                    disabled={decide.isPending || !plugin.manifestValid}
                    onClick={() => decide.mutate({ id: plugin.id, action: "approve" })}
                  >
                    Approve
                  </button>
                )}
                {plugin.status !== "revoked" && (
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    disabled={decide.isPending}
                    onClick={() => {
                      if (!window.confirm("Revoke this plugin version? Its token stops matching.")) return;
                      decide.mutate({ id: plugin.id, action: "revoke" });
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
