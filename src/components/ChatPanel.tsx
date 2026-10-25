import { useEffect, useRef, useState, type FormEvent } from "react";
import { Clock, MessagesSquare, Send, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What's the main idea?",
  "Summarise the key steps",
  "Where is the example explained?",
];

const toSeconds = (label: string) =>
  label
    .split(":")
    .map(Number)
    .reduce((acc, n) => acc * 60 + n, 0);

/** Splits assistant text on [MM:SS] / [H:MM:SS] refs so they render as clickable badges. */
function renderAnswer(text: string, onJump: (seconds: number) => void) {
  const parts = text.split(/(\[\d{1,2}:\d{2}(?::\d{2})?\])/g);
  return parts.map((part, i) => {
    const m = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]$/.exec(part);
    if (!m) return <span key={i}>{part}</span>;
    const label = m[1]!;
    return (
      <button
        key={i}
        type="button"
        onClick={() => onJump(toSeconds(label))}
        className="mx-0.5 align-middle"
      >
        <Badge
          variant="secondary"
          className="gap-1 font-mono text-[11px] hover:bg-primary hover:text-primary-foreground"
        >
          <Clock className="h-3 w-3" /> {label}
        </Badge>
      </button>
    );
  });
}

export function ChatPanel({
  videoId,
  indexed,
  onJump,
  suggestions,
}: {
  suggestions?: string[] | undefined;
  videoId: string | null;
  indexed: boolean;
  onJump: (seconds: number) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMessages([]);
  }, [videoId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (indexed && !busy) inputRef.current?.focus();
  }, [indexed, busy]);

  const ask = async (question: string) => {
    if (!videoId || !question.trim() || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: "user", content: question },
      { role: "assistant", content: "" },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, question }),
      });
      if (!res.ok || !res.body) {
        const msg = (await res.text()) || "Couldn't answer that.";
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = dec.decode(value, { stream: true });
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1]!;
          next[next.length - 1] = { ...last, content: last.content + text };
          return next;
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't answer that.";
      toast.error(message);
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  return (
    <Card className="flex flex-col lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessagesSquare className="h-4 w-4 text-primary" /> Ask the video
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          className="flex-1 space-y-4 overflow-y-auto pr-1"
          style={{ maxHeight: "22rem" }}
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border py-12 text-center">
              <p className="max-w-xs text-sm text-muted-foreground">
                {indexed
                  ? "Ask anything about this video. Answers come with timestamps you can click."
                  : "Ingest a video, then ask a question about it."}
              </p>
              {indexed && (
                <div className="flex flex-wrap justify-center gap-2 px-4">
                  {(suggestions ?? SUGGESTIONS).map((s) => (
                    <button key={s} type="button" onClick={() => void ask(s)}>
                      <Badge variant="outline" className="cursor-pointer text-xs hover:bg-accent">
                        {s}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <div
                  key={i}
                  className="flex justify-end animate-in fade-in slide-in-from-bottom-1 duration-300"
                >
                  <div className="max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div
                  key={i}
                  className="text-sm leading-relaxed text-foreground animate-in fade-in duration-300"
                >
                  {m.content ? (
                    renderAnswer(m.content, onJump)
                  ) : (
                    <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> searching transcript…
                    </span>
                  )}
                </div>
              ),
            )
          )}
        </div>

        <form onSubmit={submit} className="mt-4 flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!indexed || busy}
            placeholder={indexed ? "Ask about this video…" : "Ingest a video first"}
          />
          <Button type="submit" variant="secondary" disabled={!indexed || busy || !input.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
