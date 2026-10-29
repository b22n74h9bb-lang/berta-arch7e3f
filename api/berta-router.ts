import { generateText } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { approvals, chatMessages, missions, sandboxJobs, tasks } from "@db/schema";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { ensureMission, getMissionState, ownedApproval, ownedJob, ownedTask } from "./queries/berta";
import { kimiGw } from "./ai/provider";
import {
  generateAndStoreImage,
  getStoredImageUrl,
  ImageGenerationError,
} from "./media";
import {
  AiMisconfigured,
  AiTransient,
  AiUnavailable,
  ContentRejected,
  classifyAiError,
  listModels,
} from "./ai/client";

const BERTA_SYSTEM = `You are Berta, the user's autonomous but bounded research collaborator for mission ARCH7E3F.
Mission: build a Human CRISPR Atlas using lawful public human-derived datasets, and a methodologically separate aggregate analysis of public reactions to CRISPR and genome editing.
Rules: no mouse-derived core data; no human experimentation; no individual profiling, de-anonymization, sensitive-trait inference, persuasion target lists, or manipulation; never claim molecular CRISPR findings directly control complex social behaviour. Keep facts, assumptions, hypotheses, and unknowns distinct. Rabbit mode means acting independently only on reversible, low-risk, authorized work within resource limits. Ask before large downloads, restricted data, external contact, publication, purchases, or high-impact actions. Be concise, warm, scientifically rigorous, and concrete. Never claim to have accessed a Claw runtime, dataset, screen, or tool unless it is actually connected in the current conversation.`;

function aiError(error: unknown): TRPCError {
  const classified = classifyAiError(error);
  if (classified instanceof AiUnavailable) {
    return new TRPCError({
      code: "FORBIDDEN",
      message: "AI quota is exhausted. Mission data remains available; recharge the site owner’s Kimi quota to resume chat.",
    });
  }
  if (classified instanceof AiMisconfigured) {
    return new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI is not provisioned yet. Publish or reopen the site once, then retry.",
    });
  }
  if (classified instanceof ContentRejected) {
    return new TRPCError({ code: "BAD_REQUEST", message: "That request was rejected. Rephrase it within the mission boundaries." });
  }
  if (classified instanceof AiTransient) {
    return new TRPCError({ code: "TIMEOUT", message: "Berta is temporarily unavailable. Retry deliberately when ready." });
  }
  return new TRPCError({ code: "BAD_REQUEST", message: classified.message || "The AI request could not be completed." });
}

function imageError(error: unknown): TRPCError {
  if (error instanceof ImageGenerationError) {
    const code =
      error.code === "configuration"
        ? "PRECONDITION_FAILED"
        : error.code === "quota"
          ? "FORBIDDEN"
          : error.code === "rate-limited"
            ? "TOO_MANY_REQUESTS"
            : error.code === "timeout"
              ? "TIMEOUT"
              : "BAD_REQUEST";
    return new TRPCError({ code, message: error.message });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Image generation could not be completed." });
}

export const bertaRouter = createRouter({
  bootstrap: authedQuery.query(({ ctx }) => getMissionState(ctx.user.id)),

  updateMission: authedQuery
    .input(
      z.object({
        objective: z.string().min(20).max(8000).optional(),
        rabbitMode: z.boolean().optional(),
        voiceReplies: z.boolean().optional(),
        creditBudget: z.number().int().min(1).max(10000).optional(),
        status: z.enum(["active", "paused"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureMission(ctx.user.id);
      await getDb().update(missions).set(input).where(eq(missions.userId, ctx.user.id));
      return { ok: true };
    }),

  saveConnection: authedQuery
    .input(
      z.object({
        runtimeUrl: z
          .string()
          .max(2048)
          .refine((value) => {
            if (!value) return true;
            try {
              return new URL(value).protocol === "https:";
            } catch {
              return false;
            }
          }, "Enter a valid HTTPS URL or leave the field empty."),
      })
      .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureMission(ctx.user.id);
      const runtimeUrl = input?.runtimeUrl?.trim() || null;
      await getDb()
        .update(missions)
        .set({ runtimeUrl, runtimeStatus: runtimeUrl ? "unverified" : "unconfigured" })
        .where(eq(missions.userId, ctx.user.id));
      return { ok: true, status: runtimeUrl ? "unverified" : "unconfigured" };
    }),

  addTask: authedQuery
    .input(z.object({ title: z.string().trim().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => {
      await ensureMission(ctx.user.id);
      const existing = await getDb().select({ position: tasks.position }).from(tasks).where(eq(tasks.userId, ctx.user.id));
      const position = existing.reduce((max, row) => Math.max(max, row.position), 0) + 1;
      await getDb().insert(tasks).values({ userId: ctx.user.id, title: input.title, position });
      return { ok: true };
    }),

  updateTask: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["todo", "active", "done", "blocked"]).optional(),
        progress: z.number().int().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ownedTask(ctx.user.id, input.id);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
      const progress = input.status === "done" ? 100 : input.progress;
      await getDb()
        .update(tasks)
        .set({ status: input.status, progress })
        .where(and(eq(tasks.id, input.id), eq(tasks.userId, ctx.user.id)));
      return { ok: true };
    }),

  generateImage: authedQuery
    .input(
      z.object({
        prompt: z.string().trim().min(3).max(1200),
        size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).default("1024x1024"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureMission(ctx.user.id);
      const db = getDb();
      await db.insert(chatMessages).values({
        userId: ctx.user.id,
        role: "user",
        content: `Create an image: ${input.prompt}`,
      });
      const [created] = await db
        .insert(sandboxJobs)
        .values({
          userId: ctx.user.id,
          name: input.prompt.slice(0, 180),
          kind: "image-generation",
          status: "running",
          progress: 10,
          budgetCredits: 1,
          executor: "kimi-image-gateway",
          output: "Generating the image now; no automatic retry will be made.",
        })
        .$returningId();
      const jobId = created.id;

      try {
        const asset = await generateAndStoreImage({
          userId: ctx.user.id,
          prompt: input.prompt,
          size: input.size,
        });
        await db
          .update(sandboxJobs)
          .set({ status: "completed", progress: 100, output: `storage:${asset.key}` })
          .where(and(eq(sandboxJobs.id, jobId), eq(sandboxJobs.userId, ctx.user.id)));
        await db.insert(chatMessages).values({
          userId: ctx.user.id,
          role: "assistant",
          content: `Image created and saved to mission media as job #${jobId}. Open the Sandbox to view it again later.`,
        });
        return { jobId, key: asset.key, url: asset.url, sizeBytes: asset.sizeBytes };
      } catch (error) {
        const mapped = imageError(error);
        await db
          .update(sandboxJobs)
          .set({ status: "failed", output: mapped.message })
          .where(and(eq(sandboxJobs.id, jobId), eq(sandboxJobs.userId, ctx.user.id)));
        await db.insert(chatMessages).values({
          userId: ctx.user.id,
          role: "assistant",
          content: `Image generation did not complete: ${mapped.message}`,
        });
        throw mapped;
      }
    }),

  jobMediaUrl: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const job = await ownedJob(ctx.user.id, input.id);
      if (!job || job.kind !== "image-generation" || !job.output?.startsWith("storage:")) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Generated image not found." });
      }
      return { url: await getStoredImageUrl(job.output.slice("storage:".length)) };
    }),

  createJob: authedQuery
    .input(
      z.object({
        name: z.string().trim().min(3).max(255),
        kind: z.enum(["dataset-manifest", "analysis-plan", "reproducibility-check"]),
        budgetCredits: z.number().int().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureMission(ctx.user.id);
      await getDb().insert(sandboxJobs).values({
        userId: ctx.user.id,
        name: input.name,
        kind: input.kind,
        budgetCredits: input.budgetCredits,
        status: "queued",
        executor: "not-connected",
        output: "Queued locally. No remote executor is connected; no code has been run.",
      });
      return { ok: true };
    }),

  updateJob: authedQuery
    .input(z.object({ id: z.number().int().positive(), action: z.enum(["pause", "resume", "cancel"]) }))
    .mutation(async ({ ctx, input }) => {
      const job = await ownedJob(ctx.user.id, input.id);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Sandbox job not found." });
      const status =
        input.action === "pause" ? "paused" : input.action === "resume" ? "queued" : "cancelled";
      if (["completed", "failed", "cancelled"].includes(job.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This job has already reached a terminal state." });
      }
      await getDb()
        .update(sandboxJobs)
        .set({ status })
        .where(and(eq(sandboxJobs.id, input.id), eq(sandboxJobs.userId, ctx.user.id)));
      return { ok: true };
    }),

  resolveApproval: authedQuery
    .input(z.object({ id: z.number().int().positive(), decision: z.enum(["approved", "rejected"]) }))
    .mutation(async ({ ctx, input }) => {
      const approval = await ownedApproval(ctx.user.id, input.id);
      if (!approval) throw new TRPCError({ code: "NOT_FOUND", message: "Approval not found." });
      if (approval.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This approval has already been resolved." });
      }
      await getDb()
        .update(approvals)
        .set({ status: input.decision, resolvedAt: new Date() })
        .where(and(eq(approvals.id, input.id), eq(approvals.userId, ctx.user.id)));
      return { ok: true };
    }),

  sendChat: authedQuery
    .input(z.object({ content: z.string().trim().min(1).max(6000) }))
    .mutation(async ({ ctx, input }) => {
      await ensureMission(ctx.user.id);
      const db = getDb();
      await db.insert(chatMessages).values({ userId: ctx.user.id, role: "user", content: input.content });
      const history = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.userId, ctx.user.id))
        .orderBy(desc(chatMessages.createdAt))
        .limit(14);
      const messages = history
        .reverse()
        .filter((message) => message.role !== "system")
        .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));

      try {
        const { defaultModelId } = await listModels();
        const result = await generateText({
          model: kimiGw(defaultModelId),
          system: BERTA_SYSTEM,
          messages,
          providerOptions: { "kimi-gw": { max_completion_tokens: 1400 } },
        });
        const reply = result.text.trim();
        if (!reply) throw new Error("The model returned an empty response.");
        await db.insert(chatMessages).values({ userId: ctx.user.id, role: "assistant", content: reply });
        return { reply };
      } catch (error) {
        throw aiError(error);
      }
    }),
});
