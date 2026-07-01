/**
 * Route-facing shells for the user's email-management server fns:
 * list / request-add / consume-add / remove / set-primary.
 *
 * Each handler dynamic-imports its action so the D1, KV, and cookie
 * code never reaches the client bundle. Result types live here so
 * route loaders, mutation hooks, and tests can reference them without
 * touching `.server.ts` modules.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  ConsumeAddEmailResult,
  ListMyEmailsResult,
  RemoveEmailResult,
  RequestAddEmailResult,
  SetPrimaryEmailResult,
} from "#/features/auth/server/email-actions.server";

export type {
  ConsumeAddEmailResult,
  EmailRow,
  ListMyEmailsResult,
  RemoveEmailResult,
  RequestAddEmailResult,
  SetPrimaryEmailResult,
} from "#/features/auth/server/email-actions.server";

// Same canonical email shape the magic-link request uses — RFC 5321
// max + trim + lowercase so the unique index in user_emails matches.
const emailSchema = z.email().trim().toLowerCase().max(254);

export const listMyEmailsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ListMyEmailsResult> => {
    const { listMyEmailsAction } =
      await import("#/features/auth/server/email-actions.server");
    return listMyEmailsAction();
  },
);

export const requestAddEmailFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: emailSchema }))
  .handler(async ({ data }): Promise<RequestAddEmailResult> => {
    const { requestAddEmailAction } =
      await import("#/features/auth/server/email-actions.server");
    return requestAddEmailAction({ email: data.email });
  });

export const consumeAddEmailFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().min(16).max(128) }))
  .handler(async ({ data }): Promise<ConsumeAddEmailResult> => {
    const { consumeAddEmailAction } =
      await import("#/features/auth/server/email-actions.server");
    return consumeAddEmailAction(data.token);
  });

export const removeEmailFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ emailId: z.string().min(1).max(64) }))
  .handler(async ({ data }): Promise<RemoveEmailResult> => {
    const { removeEmailAction } =
      await import("#/features/auth/server/email-actions.server");
    return removeEmailAction({ emailId: data.emailId });
  });

export const setPrimaryEmailFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ emailId: z.string().min(1).max(64) }))
  .handler(async ({ data }): Promise<SetPrimaryEmailResult> => {
    const { setPrimaryEmailAction } =
      await import("#/features/auth/server/email-actions.server");
    return setPrimaryEmailAction({ emailId: data.emailId });
  });
