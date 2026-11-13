import { toast } from "sonner";
import { trpc } from "@/providers/trpc";

type MemberAction = "approve" | "reject" | "revoke";

const confirmCopy: Record<Exclude<MemberAction, "approve">, string> = {
  reject: "Reject this sign-in? They will not be able to open mission data.",
  revoke: "Revoke this member? Their current session stops working on the next request.",
};

export function MembersPanel() {
  const utils = trpc.useUtils();
  const members = trpc.auth.listMembers.useQuery(undefined, {
    refetchInterval: 15000,
    retry: false,
  });
  const decide = trpc.auth.decideMember.useMutation({
    onSuccess: async (_result, input) => {
      await utils.auth.listMembers.invalidate();
      toast.success(
        input.action === "approve"
          ? "Approved. They can open the app on their next session check."
          : input.action === "reject"
            ? "Rejected. That sign-in cannot open mission data."
            : "Revoked. Their current session stops on the next request.",
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const act = (githubId: string, action: MemberAction) => {
    if (action !== "approve" && !window.confirm(confirmCopy[action])) return;
    decide.mutate({ githubId, action });
  };

  return (
    <section className="data-section">
      <div className="section-heading">
        <div>
          <span className="micro-label">TEAM ACCESS</span>
          <h2>GitHub members</h2>
        </div>
      </div>
      <p className="section-description">
        Anyone can sign in with GitHub. Only people you approve can see mission data. You stay the only admin.
      </p>
      {members.isLoading && <p className="section-description">Loading sign-in requests.</p>}
      {members.isError && <p className="section-description">{members.error.message}</p>}
      {members.data && members.data.length === 0 && (
        <p className="section-description">No GitHub sign-ins yet.</p>
      )}
      {members.data && members.data.length > 0 && (
        <div className="member-list">
          {members.data.map((member) => (
            <div key={member.githubId} className="member-row">
              <div>
                <h3>{member.login}</h3>
                <span className="member-status">
                  {member.isOwnerAccount ? "owner" : member.status}
                </span>
              </div>
              {!member.isOwnerAccount && (
                <div className="member-actions">
                  {member.status !== "approved" && (
                    <button
                      type="button"
                      className="button button--primary button--small"
                      disabled={decide.isPending}
                      onClick={() => act(member.githubId, "approve")}
                    >
                      Approve
                    </button>
                  )}
                  {member.status === "pending" && (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      disabled={decide.isPending}
                      onClick={() => act(member.githubId, "reject")}
                    >
                      Reject
                    </button>
                  )}
                  {member.status === "approved" && (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      disabled={decide.isPending}
                      onClick={() => act(member.githubId, "revoke")}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
