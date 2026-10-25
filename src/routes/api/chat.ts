import { createFileRoute } from "@tanstack/react-router";
import { embed, getConfig, pineconeHost, queryPinecone, UserError } from "@/lib/ingest.server";

type Body = { videoId?: unknown; question?: unknown };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as Body;
        const videoId = typeof body.videoId === "string" ? body.videoId : "";
        const question = typeof body.question === "string" ? body.question.trim() : "";
        if (!/^[\w-]{11}$/.test(videoId)) return new Response("Invalid videoId", { status: 400 });
        if (!question) return new Response("Missing question", { status: 400 });

        try {
          const cfg = getConfig();
          const [queryVector] = await embed([question], cfg.openai);
          const host = await pineconeHost(cfg.pinecone, cfg.index);
          const chunks = await queryPinecone(host, cfg.pinecone, videoId, queryVector!, 4);

          const context = chunks.map((c) => `[${c.formatted_time}] ${c.text}`).join("\n\n");

          const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${cfg.openai}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              stream: true,
              messages: [
                {
                  role: "system",
                  content:
                    "You answer questions about a YouTube video using only the transcript excerpts provided. " +
                    "Be concise (2-4 sentences). Cite the moments you used inline as [MM:SS] or [H:MM:SS], " +
                    "exactly as they appear in the excerpts. If the excerpts don't contain the answer, say so plainly.",
                },
                {
                  role: "user",
                  content: `Transcript excerpts:\n\n${context}\n\nQuestion: ${question}`,
                },
              ],
            }),
          });

          if (!upstream.ok || !upstream.body) {
            const msg = await upstream.text();
            return new Response(`OpenAI chat failed (${upstream.status}): ${msg.slice(0, 200)}`, {
              status: 502,
            });
          }

          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();
          let buffer = "";

          const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              for (;;) {
                const { value, done } = await reader.read();
                if (done) {
                  controller.close();
                  return;
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                let out = "";
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed.startsWith("data:")) continue;
                  const data = trimmed.slice(5).trim();
                  if (data === "[DONE]") {
                    if (out) controller.enqueue(encoder.encode(out));
                    controller.close();
                    return;
                  }
                  try {
                    const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
                    out += j.choices?.[0]?.delta?.content ?? "";
                  } catch {
                    /* ignore partial frames */
                  }
                }
                if (out) {
                  controller.enqueue(encoder.encode(out));
                  return;
                }
              }
            },
          });

          return new Response(stream, {
            headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
          });
        } catch (err) {
          const message =
            err instanceof UserError ? err.message : "Something went wrong answering that.";
          return new Response(message, { status: err instanceof UserError ? 400 : 500 });
        }
      },
    },
  },
});
