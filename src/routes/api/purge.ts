import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/) });

export const Route = createFileRoute("/api/purge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid video ID" }, { status: 400 });
        const lib = await import("@/lib/ingest.server");
        try {
          const cfg = lib.getConfig();
          const host = await lib.pineconeHost(cfg.pinecone, cfg.index);
          await lib.deleteNamespace(host, cfg.pinecone, parsed.data.videoId);
          await lib.cleanupNamespaces(host, cfg.pinecone);
          return Response.json({ ok: true });
        } catch (err) {
          console.error("purge failed", err);
          const message =
            err instanceof lib.UserError ? err.message : "Couldn't remove this video's data.";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
