import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  PLUGIN_ACTIONS,
  PLUGIN_HOOK_EVENTS,
  PLUGIN_KINDS,
  PLUGIN_SURFACES,
  registerPluginManifest,
  type PluginRegistrationInput,
} from "@contracts/plugins";
import { adminQuery, createRouter } from "./middleware";
import type { SessionUser } from "./kimi/auth";
import {
  applyPluginDecision,
  findPluginByName,
  findWechatPluginStatus,
  insertPendingPlugin,
  isDuplicatePlugin,
  listPlugins,
} from "./queries/plugins";
import { wechatReadiness, wechatSecretPresence } from "./bridge/wechat";

function assertOwner(user: SessionUser) {
  if (!user.verifiedOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can review plugins." });
  }
}

const registrationInput = z.object({
  name: z.string().trim().min(3).max(64),
  version: z.string().trim().min(5).max(16),
  kind: z.enum(PLUGIN_KINDS),
  surface: z.enum(PLUGIN_SURFACES),
  scopes: z.array(z.enum(PLUGIN_ACTIONS)).min(1).max(PLUGIN_ACTIONS.length),
  hooks: z.array(z.enum(PLUGIN_HOOK_EVENTS)).max(PLUGIN_HOOK_EVENTS.length),
  config: z.record(z.string().max(40), z.string().max(80)).optional(),
});

export const pluginsRouter = createRouter({
  list: adminQuery.query(async ({ ctx }) => {
    assertOwner(ctx.user);
    return listPlugins();
  }),

  register: adminQuery.input(registrationInput).mutation(async ({ ctx, input }) => {
    assertOwner(ctx.user);
    const registration = registerPluginManifest(input satisfies PluginRegistrationInput);
    if (!registration.ok) {
      throw new TRPCError({ code: "BAD_REQUEST", message: registration.message });
    }
    const existing = await findPluginByName(registration.manifest.name, registration.manifest.version);
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "That plugin name and version is already registered." });
    }
    try {
      await insertPendingPlugin({
        name: registration.manifest.name,
        version: registration.manifest.version,
        storedScopes: registration.storedScopes,
      });
    } catch (error) {
      if (isDuplicatePlugin(error)) {
        throw new TRPCError({ code: "CONFLICT", message: "That plugin name and version is already registered." });
      }
      throw error;
    }
    return { ok: true as const, status: "pending" as const };
  }),

  decide: adminQuery
    .input(z.object({
      id: z.number().int().positive(),
      action: z.enum(["approve", "revoke"]),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOwner(ctx.user);
      const result = await applyPluginDecision(input);
      if (!result.found) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That plugin was not found." });
      }
      return {
        ok: true as const,
        changed: result.changed,
        status: result.status,
        token: result.token,
      };
    }),

  wechatReadiness: adminQuery.query(async ({ ctx }) => {
    assertOwner(ctx.user);
    return wechatReadiness({
      adapterFlag: process.env.WECHAT_ADAPTER,
      secrets: wechatSecretPresence(process.env),
      pluginStatus: await findWechatPluginStatus(),
    });
  }),
});
