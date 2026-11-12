import { ErrorMessages } from "@contracts/constants";
import { charterAccess, type CharterAccess } from "@contracts/charter";
import { TRPCError } from "@trpc/server";

export function charterAccessError(reason: Exclude<CharterAccess, { ok: true }>["reason"]): TRPCError {
  if (reason === "unauthenticated") {
    return new TRPCError({ code: "UNAUTHORIZED", message: ErrorMessages.unauthenticated });
  }
  if (reason === "not-member") {
    return new TRPCError({ code: "FORBIDDEN", message: "Access is not approved yet." });
  }
  return new TRPCError({ code: "FORBIDDEN", message: "Only the owner can view or change the charter." });
}

export { charterAccess };
