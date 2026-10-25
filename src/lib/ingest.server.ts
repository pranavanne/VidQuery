import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { formatTime } from "./youtube";

export type Segment = { start: number; text: string };
export type Chunk = {
  videoId: string;
  text: string;
  start_seconds: number;
  formatted_time: string;
};

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

export class UserError extends Error {}

export async function fetchTranscript(videoId: string): Promise<Segment[]> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
    },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId,
    }),
  });
  if (!res.ok) throw new UserError("Couldn't reach YouTube for this video. Try again in a moment.");
  const data = (await res.json()) as {
    playabilityStatus?: { status?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: { baseUrl: string; languageCode: string; kind?: string }[];
      };
    };
  };
  if (data.playabilityStatus?.status && data.playabilityStatus.status !== "OK")
    throw new UserError("This video is private, age-restricted or unavailable.");
  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) throw new UserError("This video has no captions, so it can't be searched.");
  const track =
    tracks.find((t) => t.languageCode.startsWith("en") && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode.startsWith("en")) ??
    tracks[0]!;
  const xml = await (await fetch(track.baseUrl)).text();
  const segments: Segment[] = [];
  for (const m of xml.matchAll(/<p\s+t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decode(m[2]!);
    if (text) segments.push({ start: Number(m[1]) / 1000, text });
  }
  if (!segments.length) {
    for (const m of xml.matchAll(/<text\s+start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
      const text = decode(m[2]!);
      if (text) segments.push({ start: Number(m[1]), text });
    }
  }
  if (!segments.length) throw new UserError("Transcript unavailable for this video.");
  return segments;
}

export async function chunkTranscript(videoId: string, segments: Segment[]): Promise<Chunk[]> {
  let full = "";
  const offsets: { at: number; start: number }[] = [];
  for (const s of segments) {
    offsets.push({ at: full.length, start: s.start });
    full += s.text + " ";
  }
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });
  const pieces = await splitter.splitText(full);
  let cursor = 0;
  return pieces.map((text) => {
    const idx = Math.max(0, full.indexOf(text, Math.max(0, cursor - 120)));
    cursor = idx + text.length;
    let start = 0;
    for (const o of offsets) {
      if (o.at <= idx) start = o.start;
      else break;
    }
    return { videoId, text, start_seconds: Math.floor(start), formatted_time: formatTime(start) };
  });
}

export async function embed(texts: string[], apiKey: string): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts.slice(i, i + 100) }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new UserError(`OpenAI embeddings failed (${res.status}): ${msg.slice(0, 200)}`);
    }
    const j = (await res.json()) as { data: { embedding: number[] }[] };
    out.push(...j.data.map((d) => d.embedding));
  }
  return out;
}

const PC_HEADERS = (key: string) => ({
  "Api-Key": key,
  "Content-Type": "application/json",
  "X-Pinecone-API-Version": "2025-01",
});

export async function pineconeHost(apiKey: string, index: string): Promise<string> {
  const res = await fetch(`https://api.pinecone.io/indexes/${encodeURIComponent(index)}`, {
    headers: PC_HEADERS(apiKey),
  });
  if (!res.ok)
    throw new UserError(
      `Pinecone index "${index}" not found (${res.status}). Check the index name.`,
    );
  const j = (await res.json()) as { host: string };
  return j.host;
}

export async function upsert(host: string, apiKey: string, chunks: Chunk[], vectors: number[][]) {
  const indexed_at = Date.now();
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100).map((c, k) => ({
      id: `${c.videoId}-${i + k}`,
      values: vectors[i + k]!,
      metadata: { ...c, indexed_at },
    }));
    const res = await fetch(`https://${host}/vectors/upsert`, {
      method: "POST",
      headers: PC_HEADERS(apiKey),
      body: JSON.stringify({ vectors: batch, namespace: chunks[0]!.videoId }),
    });
    if (!res.ok)
      throw new UserError(
        `Pinecone upsert failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
      );
  }
}

/** Namespaces we never auto-delete (demo videos), so they stay free to re-use. */
export const PROTECTED_VIDEO_IDS = new Set(["zjkBMFhNj_g", "aircAruvnKk", "i53Gi_K3o7I"]);
/** Vectors older than this are removed automatically. */
export const TTL_MS = 24 * 60 * 60 * 1000;
/** Hard cap on how many videos stay indexed at once (oldest removed first). */
export const MAX_VIDEOS = 6;

export async function listNamespaces(host: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`https://${host}/describe_index_stats`, {
    method: "POST",
    headers: PC_HEADERS(apiKey),
    body: JSON.stringify({}),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { namespaces?: Record<string, { vectorCount?: number }> };
  return Object.entries(j.namespaces ?? {})
    .filter(([name, v]) => name && (v.vectorCount ?? 0) > 0)
    .map(([name]) => name);
}

/** Reads the indexed_at stamp from a namespace's first vector. 0 when unknown/legacy. */
export async function namespaceIndexedAt(
  host: string,
  apiKey: string,
  videoId: string,
): Promise<number> {
  const res = await fetch(
    `https://${host}/vectors/fetch?ids=${encodeURIComponent(`${videoId}-0`)}&namespace=${encodeURIComponent(videoId)}`,
    { headers: PC_HEADERS(apiKey) },
  );
  if (!res.ok) return 0;
  const j = (await res.json()) as {
    vectors?: Record<string, { metadata?: { indexed_at?: number } }>;
  };
  const first = Object.values(j.vectors ?? {})[0];
  return Number(first?.metadata?.indexed_at ?? 0);
}

export async function deleteNamespace(host: string, apiKey: string, videoId: string) {
  const res = await fetch(`https://${host}/vectors/delete`, {
    method: "POST",
    headers: PC_HEADERS(apiKey),
    body: JSON.stringify({ deleteAll: true, namespace: videoId }),
  });
  if (!res.ok && res.status !== 404)
    throw new UserError(
      `Pinecone delete failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
}

/**
 * Deletes expired namespaces (older than TTL_MS) and trims the index down to
 * MAX_VIDEOS, oldest first. Demo videos and `keep` are never removed.
 */
export async function cleanupNamespaces(
  host: string,
  apiKey: string,
  keep?: string,
): Promise<string[]> {
  const names = await listNamespaces(host, apiKey);
  const candidates = names.filter((n) => n !== keep && !PROTECTED_VIDEO_IDS.has(n));
  const aged = await Promise.all(
    candidates.map(async (n) => ({ n, at: await namespaceIndexedAt(host, apiKey, n) })),
  );
  const now = Date.now();
  const expired = aged.filter((a) => a.at === 0 || now - a.at > TTL_MS).map((a) => a.n);
  const fresh = aged.filter((a) => !expired.includes(a.n)).sort((a, b) => a.at - b.at);
  const budget = Math.max(0, MAX_VIDEOS - 1 - PROTECTED_VIDEO_IDS.size);
  const overflow = fresh.slice(0, Math.max(0, fresh.length - budget)).map((a) => a.n);
  const removed = [...new Set([...expired, ...overflow])];
  for (const n of removed) {
    try {
      await deleteNamespace(host, apiKey, n);
    } catch (err) {
      console.error("cleanup failed for namespace", n, err);
    }
  }
  return removed;
}

export async function namespaceCount(
  host: string,
  apiKey: string,
  videoId: string,
): Promise<number> {
  const res = await fetch(`https://${host}/describe_index_stats`, {
    method: "POST",
    headers: PC_HEADERS(apiKey),
    body: JSON.stringify({}),
  });
  if (!res.ok) return 0;
  const j = (await res.json()) as { namespaces?: Record<string, { vectorCount?: number }> };
  return j.namespaces?.[videoId]?.vectorCount ?? 0;
}

export async function queryPinecone(
  host: string,
  apiKey: string,
  videoId: string,
  vector: number[],
  topK = 4,
): Promise<Chunk[]> {
  const res = await fetch(`https://${host}/query`, {
    method: "POST",
    headers: PC_HEADERS(apiKey),
    body: JSON.stringify({ vector, topK, namespace: videoId, includeMetadata: true }),
  });
  if (!res.ok)
    throw new UserError(
      `Pinecone query failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  const j = (await res.json()) as { matches?: { metadata?: Chunk }[] };
  const matches = (j.matches ?? []).map((m) => m.metadata).filter((m): m is Chunk => !!m?.text);
  if (!matches.length)
    throw new UserError("This video hasn't been indexed yet. Click Ingest Video first.");
  return matches;
}

export function getConfig() {
  const openai = process.env["OPENAI_API_KEY"];
  const pinecone = process.env["PINECONE_API_KEY"];
  const index = process.env["PINECONE_INDEX_NAME"] ?? process.env["PINECODE_INDEX_NAME"];
  if (!openai || !pinecone || !index) throw new UserError("Missing OpenAI or Pinecone settings.");
  return { openai, pinecone, index };
}
