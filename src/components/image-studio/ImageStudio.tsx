"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Sparkle,
  DownloadSimple,
  ArrowSquareOut,
  Image as ImageIcon,
  Warning,
  X,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

const MODELS = ["qwen-image-2.0-pro"] as const;
const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
const COUNTS = [1, 2, 3, 4] as const;
// Models whose outputs belong in this studio's conversation history.
const STUDIO_MODEL_PREFIXES = ["qwen-image", "gpt-image"];

interface GeneratedImage {
  mimeType: string;
  localPath: string;
}

interface StudioMessage {
  id: string;
  prompt: string;
  count: number;
  status: "loading" | "done" | "error";
  images: GeneratedImage[];
  error?: string;
}

interface GalleryHistoryItem {
  id: string;
  prompt: string;
  model: string;
  created_at: string;
  images: GeneratedImage[];
}

function imageUrl(localPath: string): string {
  return `/api/media/serve?path=${encodeURIComponent(localPath)}`;
}

let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m${msgSeq}-${msgSeq}`;
}

export function ImageStudio() {
  const { t } = useTranslation();

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string>(MODELS[0]);
  const [aspectRatio, setAspectRatio] = useState<string>(ASPECT_RATIOS[0]);
  const [count, setCount] = useState<number>(1);

  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<StudioMessage[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Load past generations as a conversation (oldest → newest). Rows from a
  // single multi-image generation share prompt + created_at, so we group them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/media/gallery?limit=60&sort=newest");
        if (!res.ok) return;
        const data = await res.json();
        const items: GalleryHistoryItem[] = (data.items || []).filter(
          (it: GalleryHistoryItem) =>
            typeof it.model === "string" &&
            STUDIO_MODEL_PREFIXES.some((p) => it.model.startsWith(p)) &&
            Array.isArray(it.images) &&
            it.images.length > 0,
        );
        const groups = new Map<string, StudioMessage>();
        for (const it of items) {
          const key = `${it.created_at}__${it.prompt}`;
          let g = groups.get(key);
          if (!g) {
            g = { id: it.id, prompt: it.prompt, count: 0, status: "done", images: [] };
            groups.set(key, g);
          }
          g.images.push(...it.images);
        }
        const ordered = [...groups.values()].reverse(); // oldest first
        if (!cancelled) setMessages(ordered);
      } catch {
        /* history is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll to newest turn.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Esc closes the lightbox.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const handleGenerate = useCallback(async () => {
    const p = prompt.trim();
    if (!p) {
      showToast({ type: "warning", message: t("imageStudio.promptRequired") });
      return;
    }
    const id = nextId();
    setMessages((prev) => [...prev, { id, prompt: p, count, status: "loading", images: [] }]);
    setPrompt("");
    setLoading(true);
    try {
      const res = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p, model, aspectRatio, n: count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t("imageStudio.failed"));
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, status: "done", images: Array.isArray(data.images) ? data.images : [] } : m,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("imageStudio.failed");
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "error", error: msg } : m)));
      showToast({ type: "error", message: msg });
    } finally {
      setLoading(false);
    }
  }, [prompt, model, aspectRatio, count, t]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!loading) handleGenerate();
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-6 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkle size={18} weight="fill" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">{t("imageStudio.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("imageStudio.subtitle")}</p>
          </div>
        </div>
        <Link href="/gallery">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
            <ArrowSquareOut size={14} />
            {t("imageStudio.openInGallery")}
          </Button>
        </Link>
      </div>

      {/* Conversation flow (scrollable) */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <ImageIcon size={26} />
              </div>
              <p className="text-sm font-medium">{t("imageStudio.emptyTitle")}</p>
              <p className="max-w-xs text-xs text-muted-foreground">{t("imageStudio.emptyHint")}</p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="flex flex-col gap-3">
                {/* User prompt — right bubble */}
                <div className="flex justify-end">
                  <div className="max-w-[78%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                    {m.prompt}
                  </div>
                </div>

                {/* Assistant images — left */}
                <div className="flex justify-start gap-2.5">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Sparkle size={14} weight="fill" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {m.status === "loading" && (
                      <div className={cn("grid gap-2", m.count > 1 ? "max-w-md grid-cols-2" : "max-w-xs grid-cols-1")}>
                        {Array.from({ length: m.count }).map((_, i) => (
                          <div
                            key={i}
                            className="flex aspect-square items-center justify-center rounded-xl border border-border/50 bg-muted/40"
                          >
                            <Spinner className="size-5 text-muted-foreground" />
                          </div>
                        ))}
                      </div>
                    )}

                    {m.status === "error" && (
                      <div className="flex max-w-md items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        <Warning size={14} className="mt-0.5 shrink-0" />
                        <span className="break-words">{m.error}</span>
                      </div>
                    )}

                    {m.status === "done" && (
                      <div className={cn("grid gap-2", m.images.length > 1 ? "max-w-xl grid-cols-2" : "max-w-md grid-cols-1")}>
                        {m.images.map((img, i) => (
                          <button
                            key={img.localPath}
                            type="button"
                            onClick={() => setLightbox(imageUrl(img.localPath))}
                            className="group relative cursor-zoom-in overflow-hidden rounded-xl border border-border/50 bg-muted/40"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imageUrl(img.localPath)}
                              alt={`${m.prompt} ${i + 1}`}
                              loading="lazy"
                              className="max-h-[440px] w-full object-contain transition-transform duration-200 group-hover:scale-[1.01]"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer (always visible) */}
      <div className="shrink-0 border-t border-border/40 bg-background/80 px-6 py-3 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-xl border border-border bg-card/60 p-2 shadow-sm focus-within:border-primary/40">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("imageStudio.promptPlaceholder")}
              rows={2}
              className="min-h-[44px] resize-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:ring-0"
            />
            <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
              {/* Model selector — single hard-wired option, kept for future models */}
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger size="sm" className="h-8 w-auto gap-1.5 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Segmented
                label={t("imageStudio.aspectRatio")}
                options={ASPECT_RATIOS as readonly string[]}
                value={aspectRatio}
                onChange={setAspectRatio}
              />
              <Segmented
                label={t("imageStudio.count")}
                options={COUNTS.map(String)}
                value={String(count)}
                onChange={(v) => setCount(Number(v))}
              />

              <div className="ml-auto">
                <Button
                  size="sm"
                  className="h-8 gap-1.5 px-4 text-xs"
                  disabled={loading || !prompt.trim()}
                  onClick={handleGenerate}
                >
                  {loading ? <Spinner className="size-3.5" /> : <Sparkle size={14} weight="fill" />}
                  {loading ? t("imageStudio.generating") : t("imageStudio.generate")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* In-app lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm sm:p-10"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X size={18} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="preview"
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
          <a
            href={lightbox}
            download
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white transition-colors hover:bg-white/20"
          >
            <DownloadSimple size={14} />
            {t("imageStudio.download")}
          </a>
        </div>
      )}
    </div>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground/70">{label}</span>
      <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition-colors",
              value === opt
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
