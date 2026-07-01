// Stand-in for the synthetic `cloudflare:workers` module so component tests
// can transitively import server-fn shells (which need access to constants
// and zod schemas alongside their server fns) without the resolver failing.
// `vite.config.ts` does the same thing for the production client bundle.
// Anything that actually reads `env` is guarded by a server-fn boundary, so
// this stub is never touched at runtime.
export const env = new Proxy(
  {},
  {
    get() {
      throw new Error("cloudflare:workers is server-only");
    },
  },
);
