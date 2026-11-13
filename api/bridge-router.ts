import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PLUGIN_ACTIONS } from "./bridge/security";
import { parsePluginScopes } from "./bridge/plugins";
import type { SessionUser } from "./kimi/auth";
import { adminQuery, createRouter } from "./middleware";
import { applyPluginDecision, listPlugins, registerPlugin } from "./queries/plugins";

function assertOwner(user: SessionUser) {
  if (!user.verifiedOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can manage plugins." });
  }
}

const registerInput = z.object({
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(64),
  scopes: z.array(z.enum(PLUGIN_ACTIONS)).min(1),
});

const decideInput = z.object({
  pluginId: z.number().int().positive(),
  action: z.enum(["approve", "revoke"]),
});

export const bridgeRouter = createRouter({
  listPlugins: adminQuery.query(async ({ ctx }) => {
    assertOwner(ctx.user);
    return listPlugins();
  }),
  registerPlugin: adminQuery.input(registerInput).mutation(async ({ ctx, input }) => {
    assertOwner(ctx.user);
    const scopes = parsePluginScopes(input.scopes.join(","));
    if (scopes.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Scopes must be explicit plugin actions. Wildcards are rejected.",
      });
    }
    try {
      return await registerPlugin({
        name: input.name,
        version: input.version,
        scopes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not register plugin.";
      throw new TRPCError({ code: "BAD_REQUEST", message });
    }
  }),
  decidePlugin: adminQuery.input(decideInput).mutation(async ({ ctx, input }) => {
    assertOwner(ctx.user);
    const result = await applyPluginDecision(input);
    if (!result.ok) {
      if (result.reason === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "That plugin was not found." });
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          result.reason === "already_revoked"
            ? "That plugin is already revoked."
            : "That plugin is already approved.",
      });
    }
    return {
      ok: true as const,
      status: result.status,
      /** Plaintext token is returned once on approve. Never logged. Never re-fetched. */
      token: result.token,
    };
  }),
});
