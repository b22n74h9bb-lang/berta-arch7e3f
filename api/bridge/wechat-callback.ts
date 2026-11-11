import type { Context } from "hono";
import { log } from "../lib/logger";
import { wechatCallbackDecision } from "./wechat";

/**
 * WeChat callback placeholder.
 * The decision function ignores flags, signatures, and echostr. Delivery is a later owner-approved change.
 */
export function createWechatCallbackHandler() {
  return (c: Context) => {
    const decision = wechatCallbackDecision();
    log.info("wechat callback refused", { shipped: false });
    return c.json(decision.body, decision.status);
  };
}
