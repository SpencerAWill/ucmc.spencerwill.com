import { env } from "#/server/cloudflare-env";

/**
 * Accessor for the Cloudflare Images binding. Like the R2 accessors, it
 * exists so `env.*` is never touched at module scope, and so tests have
 * one module to swap a fake in for.
 */
export function getImages(): ImagesBinding {
  return env.IMAGES;
}
