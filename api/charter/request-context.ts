/** Per-request chat clock and capability context. Attached after charter assembly. */

export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

export type ChatMissionMeta = {
  createdAt: Date | string;
  code?: string | null;
  status?: string | null;
};

export const CHAT_REQUEST_CONTEXT_INTRO = "Authoritative current datetime for this request:";

export const CHAT_CLOCK_PRECEDENCE =
  'Use this clock for "today" and the current date. Do not use a training cutoff, an internal default date, or a date stated in the owner charter or earlier messages when it conflicts with this clock.';

export const CHAT_TURN_CAPABILITY =
  "This turn is a single request/response completion. The app does not track continuous autonomous agent operation, an agent start date, or a persistent runtime log. Do not invent uptime, a launch date, or access to logs, the model gateway, tools, screens, or memory that is not included in this prompt or the messages provided with this turn.";

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function shanghaiParts(now: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHANGHAI_TIME_ZONE,
    hourCycle: "h23",
    ...options,
  }).formatToParts(now);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return values;
}

/** e.g. Thursday, 19 November 2026, 11:25 Asia/Shanghai (2026-11-19T03:25:29.221Z) */
export function formatAuthoritativeClock(now: Date): string {
  const p = shanghaiParts(now, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${SHANGHAI_TIME_ZONE} (${now.toISOString()})`;
}

/** e.g. 2026-11-19 11:25 Asia/Shanghai — used only on the model payload, not stored. */
export function formatShanghaiHistoryTimestamp(createdAt: Date | string): string {
  const p = shanghaiParts(asDate(createdAt), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${SHANGHAI_TIME_ZONE}`;
}

export function formatChatMessageForModel(createdAt: Date | string, content: string): string {
  return `[${formatShanghaiHistoryTimestamp(createdAt)}] ${content}`;
}

export function buildChatRequestContext(input: {
  now: Date;
  mission?: ChatMissionMeta | null;
}): string {
  const lines = [
    `${CHAT_REQUEST_CONTEXT_INTRO} ${formatAuthoritativeClock(input.now)}. ${CHAT_CLOCK_PRECEDENCE}`,
    "",
    CHAT_TURN_CAPABILITY,
  ];
  if (input.mission?.createdAt) {
    const created = formatAuthoritativeClock(asDate(input.mission.createdAt));
    const code = input.mission.code?.trim() || "unknown";
    const status = input.mission.status?.trim() || "unknown";
    lines.push(
      "",
      `This user's mission record (${code}, status: ${status}) was created at ${created}. That is the mission-record created time, not agent uptime or days of continuous operation.`,
    );
  }
  return lines.join("\n");
}

/** Always append after identity+charter assembly so a stored charter cannot drop the clock. */
export function appendChatRequestContext(
  assembledSystemPrompt: string,
  input: { now: Date; mission?: ChatMissionMeta | null },
): string {
  return `${assembledSystemPrompt}\n\n${buildChatRequestContext(input)}`;
}
