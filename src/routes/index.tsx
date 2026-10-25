import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { YouTubePlayer, type PlayerHandle } from "@/components/YouTubePlayer";
import { ChatPanel } from "@/components/ChatPanel";
import { parseYouTubeId } from "@/lib/youtube";
import { Github, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SAMPLE_VIDEOS = [
  {
    id: "sample-1",
    label: "Intro to Large Language Models",
    url: "https://www.youtube.com/watch?v=zjkBMFhNj_g",
    questions: [
      "What is an LLM actually made of?",
      "How is a model fine-tuned?",
      "What are jailbreak attacks?",
    ],
  },
  {
    id: "sample-2",
    label: "But what is a neural network?",
    url: "https://www.youtube.com/watch?v=aircAruvnKk",
    questions: [
      "What is a neuron here?",
      "Why use a sigmoid function?",
      "What are weights and biases?",
    ],
  },
  {
    id: "sample-3",
    label: "System Design Interview Basics",
    url: "https://www.youtube.com/watch?v=i53Gi_K3o7I",
    questions: [
      "How should I start a design interview?",
      "When is caching discussed?",
      "How do you scale a database?",
    ],
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VidQuery — Semantic YouTube Q&A" },
      {
        name: "description",
        content:
          "Paste a YouTube link, ask questions in plain language, and jump to the exact moment it's discussed.",
      },
      { property: "og:title", content: "VidQuery — Semantic YouTube Q&A" },
      {
        property: "og:description",
        content: "Ask any YouTube video a question and jump to the exact second.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState("--:--");
  const playerRef = useRef<PlayerHandle>(null);

  const [ingest, setIngest] = useState<{
    progress: number;
    message: string;
    status: "running" | "done" | "error";
  } | null>(null);

  const runIngest = async (id: string) => {
    setIngest({ progress: 5, message: "Starting", status: "running" });
    const toastId = toast.loading("Indexing video…");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: id }),
      });
      if (!res.ok || !res.body) throw new Error("Indexing request failed.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as {
            stage: string;
            progress: number;
            message: string;
            chunks?: number;
            cached?: boolean;
          };
          if (e.stage === "error") {
            setIngest({ progress: 100, message: e.message, status: "error" });
            toast.error(e.message, { id: toastId });
          } else if (e.stage === "done") {
            const msg = e.cached
              ? `Already indexed (${e.chunks} chunks) — loaded instantly`
              : `Indexed ${e.chunks} chunks — ready for questions`;
            setIngest({ progress: 100, message: msg, status: "done" });
            toast.success(e.cached ? "Loaded from cache" : `Video indexed (${e.chunks} chunks)`, {
              id: toastId,
            });
          } else {
            setIngest({ progress: e.progress, message: e.message, status: "running" });
            toast.loading(e.message, { id: toastId });
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Indexing failed.";
      setIngest({ progress: 100, message, status: "error" });
      toast.error(message, { id: toastId });
    }
  };

  const [suggestions, setSuggestions] = useState<string[] | undefined>(undefined);

  const load = (value: string, qs?: string[]) => {
    const id = parseYouTubeId(value);
    if (!id) {
      setError(
        "That doesn't look like a YouTube link. Try a watch, youtu.be, shorts or embed URL.",
      );
      return;
    }
    setError(null);
    setSuggestions(qs);
    setVideoId(id);
    if (ingest?.status !== "running") void runIngest(id);
  };

  const purge = async () => {
    if (!videoId) return;
    const toastId = toast.loading("Removing this video's data…");
    try {
      const res = await fetch("/api/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Couldn't remove this video's data.");
      setIngest(null);
      toast.success("Removed — storage freed up", { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Removal failed.", { id: toastId });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-3xl leading-none">
              Vid<span className="italic text-primary">Query</span>
            </span>
            <span className="hidden font-mono text-xs uppercase tracking-widest text-muted-foreground sm:inline">
              Semantic YouTube Q&amp;A
            </span>
          </div>
          <a
            href="https://github.com/pranavanne/VidQuery"
            target="_blank"
            rel="noreferrer"
          >
            <Badge
              variant="outline"
              className="gap-1.5 px-3 py-1 font-mono text-xs hover:bg-accent"
            >
              <Github className="h-3.5 w-3.5" /> GitHub
            </Badge>
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6">
        <section className="py-16 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
            00:00 → the exact second
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl font-display text-5xl leading-[1.05] sm:text-6xl">
            Ask a video anything.{" "}
            <span className="italic text-muted-foreground">Skip straight to the answer.</span>
          </h1>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              load(url);
            }}
            className="mx-auto mt-10 flex max-w-2xl flex-col gap-3 sm:flex-row"
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="h-12 flex-1 font-mono text-sm"
            />
            <Button
              type="submit"
              size="lg"
              className="h-12"
              disabled={ingest?.status === "running"}
            >
              {ingest?.status === "running" ? "Indexing…" : "Ingest Video"}
            </Button>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          {ingest && (
            <div className="mx-auto mt-4 max-w-2xl text-left animate-in fade-in slide-in-from-top-1 duration-300">
              <Progress value={ingest.progress} className="h-1.5" />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p
                  className={`font-mono text-xs ${ingest.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {ingest.message}
                </p>
                {ingest.status === "done" && videoId && (
                  <button
                    type="button"
                    onClick={() => void purge()}
                    className="shrink-0 font-mono text-xs text-muted-foreground underline underline-offset-4 hover:text-destructive"
                  >
                    Remove stored data
                  </button>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                Stored videos are cleared automatically after 24 hours to stay within free limits.
              </p>
            </div>
          )}

          <div className="mx-auto mt-4 flex max-w-2xl items-center justify-center gap-3">
            <span className="text-sm text-muted-foreground">or try</span>
            <Select
              onValueChange={(v) => {
                const sample = SAMPLE_VIDEOS.find((s) => s.id === v);
                const u = sample?.url ?? "";
                setUrl(u);
                load(u, sample?.questions);
              }}
            >
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Sample Demo Videos" />
              </SelectTrigger>
              <SelectContent>
                {SAMPLE_VIDEOS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="grid gap-6 pb-16 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Play className="h-4 w-4 text-primary" /> Player
              </CardTitle>
              <span className="font-mono text-xs text-muted-foreground">{time}</span>
            </CardHeader>
            <CardContent>
              <div className="relative aspect-video overflow-hidden rounded-lg">
                {videoId ? (
                  <YouTubePlayer ref={playerRef} videoId={videoId} onTime={setTime} />
                ) : (
                  <>
                    <Skeleton className="absolute inset-0" />
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                      Paste a link to load a video
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <ChatPanel
            videoId={videoId}
            indexed={ingest?.status === "done"}
            suggestions={suggestions}
            onJump={(secs) => playerRef.current?.seekToTimestamp(secs)}
          />
        </section>
      </main>
    </div>
  );
}
