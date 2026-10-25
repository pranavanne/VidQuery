import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/) });

export const Route = createFileRoute("/api/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid video ID" }, { status: 400 });
        const { videoId } = parsed.data;
        const lib = await import("@/lib/ingest.server");
        const enc = new TextEncoder();

        const stream = new ReadableStream({
          async start(controller) {
            const send = (e: Record<string, unknown>) =>
              controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
            try {
              const cfg = lib.getConfig();
              send({ stage: "cache", progress: 5, message: "Checking cache" });
              const host = await lib.pineconeHost(cfg.pinecone, cfg.index);
              const removed = await lib.cleanupNamespaces(host, cfg.pinecone, videoId);
              if (removed.length)
                send({
                  stage: "cleanup",
                  progress: 8,
                  message: `Cleared ${removed.length} old video(s) from storage`,
                });
              const existing = await lib.namespaceCount(host, cfg.pinecone, videoId);
              if (existing > 0) {
                send({
                  stage: "done",
                  progress: 100,
                  message: "Already indexed",
                  chunks: existing,
                  cached: true,
                });
                return;
              }

              send({ stage: "transcript", progress: 10, message: "Fetching transcript" });
              const segments = await lib.fetchTranscript(videoId);
              send({
                stage: "split",
                progress: 30,
                message: `Splitting ${segments.length} caption lines`,
              });
              const chunks = await lib.chunkTranscript(videoId, segments);
              send({ stage: "embed", progress: 50, message: `Embedding ${chunks.length} chunks` });
              const vectors = await lib.embed(
                chunks.map((c) => c.text),
                cfg.openai,
              );
              send({ stage: "upsert", progress: 80, message: "Saving to Pinecone" });
              await lib.upsert(host, cfg.pinecone, chunks, vectors);
              send({
                stage: "done",
                progress: 100,
                message: "Video indexed",
                chunks: chunks.length,
              });
            } catch (err) {
              console.error("ingest failed", err);
              const message =
                err instanceof lib.UserError ? err.message : "Something went wrong while indexing.";
              send({ stage: "error", progress: 100, message });
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      },
    },
  },
});
