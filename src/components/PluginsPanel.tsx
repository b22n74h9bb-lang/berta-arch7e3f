import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";

const SCOPE_OPTIONS = [
  "mission.create",
  "task.assign",
  "comment.add",
  "approval.request",
] as const;

type ScopeOption = (typeof SCOPE_OPTIONS)[number];

export function PluginsPanel() {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [scopes, setScopes] = useState<ScopeOption[]>(["comment.add"]);
  const [lastToken, setLastToken] = useState<string | null>(null);

  const plugins = trpc.bridge.listPlugins.useQuery(undefined, {
    refetchInterval: 15000,
    retry: false,
  });
  const register = trpc.bridge.registerPlugin.useMutation({
    onSuccess: async () => {
      setName("");
      await utils.bridge.listPlugins.invalidate();
      toast.success("Plugin registered as pending. Approve it to mint a token.");
    },
    onError: (error) => toast.error(error.message),
  });
  const decide = trpc.bridge.decidePlugin.useMutation({
    onSuccess: async (result, input) => {
      await utils.bridge.listPlugins.invalidate();
      if (input.action === "approve" && result.token) {
        setLastToken(result.token);
        toast.success("Approved. Copy the token now — it will not be shown again.");
      } else {
        setLastToken(null);
        toast.success("Plugin revoked. Old tokens stop immediately.");
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleScope = (scope: ScopeOption) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  return (
    <section className="data-section">
      <div className="section-heading">
        <div>
          <span className="micro-label">EXTENSIONS</span>
          <h2>Claw / bridge plugins</h2>
        </div>
      </div>
      <p className="section-description">
        Owner-approved plugins only. Scopes are explicit allowlists. Tokens are hashed server-side and shown once on approve. No third-party activation without your decision.
      </p>
      <form
        className="connection-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (scopes.length === 0) {
            toast.error("Pick at least one explicit scope.");
            return;
          }
          register.mutate({ name, version, scopes });
        }}
      >
        <label htmlFor="plugin-name">Name</label>
        <input
          id="plugin-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="wechat-bridge"
          required
        />
        <label htmlFor="plugin-version">Version</label>
        <input
          id="plugin-version"
          value={version}
          onChange={(event) => setVersion(event.target.value)}
          placeholder="0.1.0"
          required
        />
        <fieldset className="plugin-scopes">
          <legend>Scopes</legend>
          {SCOPE_OPTIONS.map((scope) => (
            <label key={scope} className="plugin-scope-option">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={() => toggleScope(scope)}
              />
              <code>{scope}</code>
            </label>
          ))}
        </fieldset>
        <button type="submit" className="button button--primary" disabled={register.isPending}>
          Register pending
        </button>
      </form>
      {lastToken && (
        <div className="plugin-token-once">
          <span className="micro-label">ONE-TIME TOKEN</span>
          <p>Copy now. The server keeps only a hash.</p>
          <code>{lastToken}</code>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={async () => {
              await navigator.clipboard.writeText(lastToken);
              toast.success("Token copied.");
            }}
          >
            Copy
          </button>
        </div>
      )}
      {plugins.isLoading && <p className="section-description">Loading plugins.</p>}
      {plugins.isError && <p className="section-description">{plugins.error.message}</p>}
      {plugins.data && plugins.data.length === 0 && (
        <p className="section-description">No plugins registered yet.</p>
      )}
      {plugins.data && plugins.data.length > 0 && (
        <div className="member-list">
          {plugins.data.map((plugin) => (
            <div key={plugin.id} className="member-row">
              <div>
                <h3>
                  {plugin.name} <span className="member-status">v{plugin.version}</span>
                </h3>
                <span className="member-status">{plugin.status}</span>
                <p className="section-description">
                  {plugin.scopes.length > 0 ? plugin.scopes.join(", ") : "no scopes"}
                </p>
              </div>
              <div className="member-actions">
                {plugin.status === "pending" && (
                  <button
                    type="button"
                    className="button button--primary button--small"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ pluginId: plugin.id, action: "approve" })}
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
                      if (!window.confirm("Revoke this plugin? Current tokens stop immediately.")) {
                        return;
                      }
                      decide.mutate({ pluginId: plugin.id, action: "revoke" });
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
