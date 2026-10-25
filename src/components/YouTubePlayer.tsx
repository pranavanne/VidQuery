import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatTime } from "@/lib/youtube";

export type PlayerHandle = { seekToTimestamp: (seconds: number) => void };

type YTPlayer = {
  seekTo: (s: number, allow: boolean) => void;
  playVideo: () => void;
  loadVideoById: (id: string) => void;
  getCurrentTime: () => number;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

export const YouTubePlayer = forwardRef<
  PlayerHandle,
  { videoId: string; onTime?: (t: string) => void }
>(function YouTubePlayer({ videoId, onTime }, ref) {
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const [, force] = useState(0);

  useImperativeHandle(ref, () => ({
    seekToTimestamp(seconds: number) {
      if (player.current && ready.current) {
        player.current.seekTo(seconds, true);
        player.current.playVideo();
      } else pendingSeek.current = seconds;
    },
  }));

  useEffect(() => {
    let cancelled = false;
    if (player.current) {
      player.current.loadVideoById(videoId);
      return;
    }
    loadApi().then(() => {
      if (cancelled || !mount.current || !window.YT) return;
      const el = document.createElement("div");
      mount.current.appendChild(el);
      player.current = new window.YT.Player(el, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            ready.current = true;
            if (pendingSeek.current != null) {
              player.current?.seekTo(pendingSeek.current, true);
              player.current?.playVideo();
              pendingSeek.current = null;
            }
            force((n) => n + 1);
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    const t = setInterval(() => {
      if (ready.current && player.current) onTime?.(formatTime(player.current.getCurrentTime()));
    }, 500);
    return () => {
      clearInterval(t);
    };
  }, [onTime]);

  useEffect(
    () => () => {
      player.current?.destroy();
      player.current = null;
    },
    [],
  );

  return <div ref={mount} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />;
});
