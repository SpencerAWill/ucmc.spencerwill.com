/**
 * Schema introspection used by the /settings auto-form to pick a renderer.
 *
 * Zod 4 wraps `.default(x)` as `ZodDefault<T>` and exposes the inner
 * schema at `_def.innerType`. We always unwrap before inspecting the
 * type, so callers see the "real" shape regardless of whether a default
 * was applied.
 *
 * The `_def` access uses `unknown` plus a narrow type assertion rather
 * than the published `ZodType` interfaces — Zod's exported types don't
 * include the internal `_def` shape, but the runtime structure is stable
 * across the 4.x line and is what every introspection helper in the
 * ecosystem reads.
 */
import type { z } from "zod";

type ZodInternals = { type?: string; innerType?: ZodLike };
type ZodLike = z.ZodTypeAny & { _def: ZodInternals };

export function unwrapDefault<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
): z.ZodTypeAny {
  const def = (schema as ZodLike)._def;
  if (def.type === "default" && def.innerType) {
    return unwrapDefault(def.innerType);
  }
  return schema;
}

export type AutoFormType = "string" | "boolean" | "number" | "unknown";

export function autoFormType(schema: z.ZodTypeAny): AutoFormType {
  const inner = unwrapDefault(schema) as ZodLike;
  const t = inner._def.type;
  if (t === "string") return "string";
  if (t === "boolean") return "boolean";
  if (t === "number") return "number";
  return "unknown";
}
