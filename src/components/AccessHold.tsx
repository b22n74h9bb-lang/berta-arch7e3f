import { BertaMark } from "@/components/BertaMark";
import { useAuth } from "@/hooks/useAuth";

const copy = {
  pending: {
    label: "WAITING FOR THE OWNER",
    title: "This account is pending",
    body: "GitHub sign-in worked. Mission data, chat, and the sandbox stay closed until the owner approves this account.",
  },
  rejected: {
    label: "NOT APPROVED",
    title: "This account was not approved",
    body: "The owner declined this GitHub account. Nothing in the mission is available here.",
  },
  revoked: {
    label: "ACCESS REVOKED",
    title: "Access was revoked",
    body: "The owner removed this account. Mission data stays closed. A new sign-in does not restore access.",
  },
} as const;

export function AccessHold({
  login,
  status,
}: {
  login: string;
  status: "pending" | "rejected" | "revoked";
}) {
  const { logout, isLoading } = useAuth();
  const text = copy[status];
  const who = login.trim() || "this GitHub account";
  return (
    <div className="centered-state">
      <BertaMark size={72} active={false} />
      <span className="micro-label">{text.label}</span>
      <h1>{text.title}</h1>
      <p>Signed in as {who}. {text.body}</p>
      <button type="button" className="button button--secondary" onClick={logout} disabled={isLoading}>
        Sign out
      </button>
    </div>
  );
}
