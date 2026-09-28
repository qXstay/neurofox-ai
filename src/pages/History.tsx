import { useNavigate } from "react-router-dom";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronLeft, Download, Copy, Trash2, X, ChevronDown, Image, Film, Music, AlertTriangle, Check, Loader2, Pause, Play } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/contexts/AuthContext";

type GenerationStatus = "pending" | "success" | "failed";
type MediaType = "image" | "video" | "music" | "unknown";

interface MusicTrack {
  id: string;
  title: string;
  coverUrl?: string;
  audioUrl: string;
  originalFilename?: string;
  assetId: string;
}

interface BackendResultAsset {
  assetId: string;
  assetType?: string | null;
  contentType?: string | null;
  originalFilename?: string | null;
  byteSize?: number | null;
}

interface BackendGenerationHistoryEntry {
  id: string;
  generationJobId: string;
  flowId?: string | null;
  tokenCost?: number | null;
  status: string;
  prompt: string;
  result?: {
    assets?: BackendResultAsset[];
  } | null;
  error?: {
    code?: string | null;
    message?: string | null;
  } | null;
  createdAt: string;
}

interface BackendGenerationHistoryResponse {
  outcome: string;
  generations?: BackendGenerationHistoryEntry[];
}

interface HistoryItem {
  id: string;
  type: MediaType;
  status: GenerationStatus;
  model: string;
  prompt: string;
  date: string;
  time: string;
  cost: number;
  errorText?: string;
  resultAssetId?: string;
  resultAssetType?: string | null;
  resultFilename?: string;
  resultAssets: BackendResultAsset[];
  tracks?: MusicTrack[];
  trackCount?: number;
  coverUrl?: string;
}

const REAL_HISTORY_FLOW_IDS = new Set([
  "photo_nano_banana_edit",
  "photo_nano_banana_pro",
  "photo_nano_banana_2",
  "photo_gpt_image",
  "photo_gpt_image_15_text_to_image",
  "photo_gpt_image_2_text_to_image",
  "photo_gpt_image_2_image_to_image",
  "video_kling_avatar",
  "video_kling_motion_control",
  "video_grok_image_to_video",
  "video_grok_text_to_video",
  "video_seedance_image_reference",
  "video_seedance_text_to_video",
  "video_veo_image_to_video",
  "music_suno_base_instrumental_prompt",
  "music_suno_upload_cover",
  "music_suno_upload_extend",
  "music_suno_add_instrumental",
  "music_suno_add_vocals",
]);

const FLOW_LABELS: Record<string, string> = {
  photo_nano_banana_edit: "Nano Banana",
  photo_nano_banana_pro: "Nano Banana Pro",
  photo_nano_banana_2: "Nano Banana 2",
  photo_gpt_image: "GPT Image 1.5",
  photo_gpt_image_15_text_to_image: "GPT Image 1.5 Text",
  photo_gpt_image_2_text_to_image: "GPT Image 2.0 Text",
  photo_gpt_image_2_image_to_image: "GPT Image 2.0 Image",
  video_kling_avatar: "Kling AI Avatar 2",
  video_kling_motion_control: "Kling Motion Control 2.6",
  video_grok_image_to_video: "Grok Video",
  video_grok_text_to_video: "Grok Video",
  video_seedance_image_reference: "Seedance 2.0",
  video_seedance_text_to_video: "Seedance 2.0",
  video_veo_image_to_video: "Veo 3.1",
  music_suno_base_instrumental_prompt: "Suno Instrumental",
  music_suno_upload_cover: "Suno Upload Cover",
  music_suno_upload_extend: "Suno Upload Extend",
  music_suno_add_instrumental: "Suno Add Instrumental",
  music_suno_add_vocals: "Suno Add Vocals",
};

const STATUS_CFG = {
  pending: { label: "В обработке", cls: "bg-photo-accent/[0.10] text-photo-accent/80 border-photo-accent/20" },
  success: { label: "Готово", cls: "bg-emerald-500/[0.10] text-emerald-400/80 border-emerald-500/20" },
  failed: { label: "Ошибка", cls: "bg-red-500/[0.10] text-red-400/70 border-red-500/20" },
};
const HISTORY_REFRESH_INTERVAL_MS = 2_500;

const ORDER = ["Сегодня", "Вчера", "Ранее"];

function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function resolveDateLabel(value: string) {
  const createdAt = new Date(value);
  const now = new Date();
  const createdDay = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
  const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((currentDay.getTime() - createdDay.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays <= 0) {
    return "Сегодня";
  }

  if (diffDays === 1) {
    return "Вчера";
  }

  return "Ранее";
}

function resolveTimeLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toHistoryItem(entry: BackendGenerationHistoryEntry): HistoryItem | null {
  const flowId = String(entry.flowId || "").trim();
  if (!REAL_HISTORY_FLOW_IDS.has(flowId)) {
    return null;
  }

  if (
    entry.status !== "generation_pending" &&
    entry.status !== "generation_running" &&
    entry.status !== "generation_dispatched" &&
    entry.status !== "generation_reserved" &&
    entry.status !== "generation_created" &&
    entry.status !== "generation_succeeded" &&
    entry.status !== "generation_failed"
  ) {
    return null;
  }

  const resultAssets = Array.isArray(entry.result?.assets) ? entry.result.assets : [];
  const firstResultAsset = resultAssets[0] || null;

  let type: MediaType = "image";
  if (flowId.startsWith("video_")) type = "video";
  else if (flowId.startsWith("music_")) type = "music";

  let tracks: MusicTrack[] = [];
  let trackCount = 0;
  let coverUrl: string | undefined;

  if (type === "music") {
    const audioAssets = resultAssets.filter(a => resolveAssetMediaKind(a) === "audio");
    const imageAssets = resultAssets.filter(a => resolveAssetMediaKind(a) === "image");
    if (imageAssets.length > 0) {
      coverUrl = assetContentPath(imageAssets[0].assetId);
    }
    trackCount = audioAssets.length;
    tracks = audioAssets.map((asset, index) => ({
      id: asset.assetId,
      title: `Трек ${index + 1}`,
      coverUrl: coverUrl || "",
      audioUrl: assetContentPath(asset.assetId),
      originalFilename: asset.originalFilename || undefined,
      assetId: asset.assetId,
    }));
  }

  return {
    id: entry.id,
    type,
    status:
      entry.status === "generation_succeeded"
        ? "success"
        : entry.status === "generation_failed"
          ? "failed"
          : "pending",
    model: FLOW_LABELS[flowId] || "Генерация фото",
    prompt: entry.prompt,
    date: resolveDateLabel(entry.createdAt),
    time: resolveTimeLabel(entry.createdAt),
    cost: Number(entry.tokenCost || 0),
    errorText: entry.error?.message || "Не удалось обработать запрос. Попробуйте позже.",
    resultAssetId: firstResultAsset?.assetId,
    resultAssetType: firstResultAsset?.assetType || null,
    resultFilename: firstResultAsset?.originalFilename || null,
    resultAssets,
    tracks,
    trackCount,
    coverUrl,
  };
}

function trackWord(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return "треков";
  if (mod10 === 1) return "трек";
  if (mod10 >= 2 && mod10 <= 4) return "трека";
  return "треков";
}

function assetContentPath(assetId: string, download = false) {
  const suffix = download ? "?download=1" : "";
  return `/api/assets/${encodeURIComponent(assetId)}/content${suffix}`;
}

function resolveAssetMediaKind(asset: BackendResultAsset | null | undefined) {
  const assetType = String(asset?.assetType || "").toLowerCase();
  const contentType = String(asset?.contentType || "").toLowerCase();

  if (assetType === "image" || contentType.startsWith("image/")) return "image";
  if (assetType === "video" || contentType.startsWith("video/")) return "video";
  if (assetType === "audio" || contentType.startsWith("audio/")) return "audio";
  return "unknown";
}

function stopMediaPropagation(event: React.SyntheticEvent) {
  event.stopPropagation();
}

function isFinitePositiveDuration(duration: number) {
  return Number.isFinite(duration) && duration > 0;
}

function formatTrackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function assetDisplayName(asset: BackendResultAsset, index: number) {
  return asset.originalFilename || `Result asset ${index + 1}`;
}

function ResultAssetMedia({
  asset,
  className = "w-full h-full",
  imageFit = "cover",
  onError,
}: {
  asset: BackendResultAsset;
  className?: string;
  imageFit?: "cover" | "contain";
  onError?: () => void;
}) {
  const mediaKind = resolveAssetMediaKind(asset);
  const src = assetContentPath(asset.assetId);
  const imageFitClass = imageFit === "contain" ? "object-contain" : "object-cover";

  if (mediaKind === "image") {
    return <img src={src} alt="" className={`${className} ${imageFitClass}`} loading="lazy" onError={onError} />;
  }

  if (mediaKind === "video") {
    return (
      <video
        src={src}
        className={`${className} object-contain bg-photo-bg`}
        controls
        playsInline
        preload="metadata"
        onClick={stopMediaPropagation}
        onDoubleClick={stopMediaPropagation}
        onMouseDown={stopMediaPropagation}
        onPointerDown={stopMediaPropagation}
        onTouchStart={stopMediaPropagation}
        onKeyDown={stopMediaPropagation}
        onError={onError}
      />
    );
  }

  if (mediaKind === "audio") {
    return (
      <div className={`${className} bg-photo-bg/40 flex flex-col items-center justify-center px-4 gap-3`}>
        <div className="w-11 h-11 rounded-xl bg-photo-surface-elevated/55 border border-photo-border-subtle/40 flex items-center justify-center">
          <Music className="w-5 h-5 text-photo-muted/50 stroke-[1.5]" />
        </div>
        <audio
          src={src}
          controls
          preload="metadata"
          className="w-full max-w-[360px]"
          onClick={stopMediaPropagation}
          onDoubleClick={stopMediaPropagation}
          onMouseDown={stopMediaPropagation}
          onPointerDown={stopMediaPropagation}
          onTouchStart={stopMediaPropagation}
          onKeyDown={stopMediaPropagation}
          onError={onError}
        />
      </div>
    );
  }

  return null;
}

function ResultAssetDownloadLink({ asset, index }: { asset: BackendResultAsset; index: number }) {
  return (
    <a
      href={assetContentPath(asset.assetId, true)}
      download={asset.originalFilename || undefined}
      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-photo-accent/[0.12] text-photo-accent text-[11.5px] font-medium border border-photo-accent/25 hover:bg-photo-accent/[0.18] transition-colors"
      onClick={(event) => event.stopPropagation()}
    >
      <Download className="w-3.5 h-3.5" />
      Скачать {index + 1}
    </a>
  );
}

function ResultPlaceholder({ item }: { item: HistoryItem }) {
  const isPending = item.status === "pending";
  const [previewFailed, setPreviewFailed] = useState(false);

  if (item.type === "music" && !isPending && item.status !== "failed") {
    return (
      <div className="aspect-[4/3] bg-photo-bg/40 overflow-hidden relative">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-xl bg-photo-surface-elevated/55 border border-photo-border-subtle/40 flex items-center justify-center">
              <Music className="w-6 h-6 text-photo-muted/40 stroke-[1.5]" />
            </div>
          </div>
        )}
        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-photo-bg/60 backdrop-blur-sm border border-photo-border-subtle/30 text-[10px] font-medium text-photo-fg/60">
          {item.trackCount || 0} {trackWord(item.trackCount || 0)}
        </div>
        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-[3px] rounded-md bg-photo-bg/60 backdrop-blur-sm border border-photo-border-subtle/30 text-[10px] font-medium text-photo-fg/60">
          <Music className="w-3 h-3" />
          Музыка
        </div>
      </div>
    );
  }

  const firstAsset = item.resultAssets[0] || null;
  const mediaKind = resolveAssetMediaKind(firstAsset);
  const ResultIcon = mediaKind === "video" ? Film : mediaKind === "audio" ? Music : Image;
  const resultCount = item.resultAssets.length;
  const showMediaPreview = Boolean(item.status === "success" && firstAsset && mediaKind !== "unknown" && !previewFailed);
  const placeholderText =
    isPending
      ? "Генерация в обработке"
      : item.status === "failed"
        ? "Генерация не завершилась"
        : mediaKind === "audio" && resultCount > 0
          ? `Сохранено ${resultCount} ${trackWord(resultCount)}`
          : "Результат сохранён";

  if (showMediaPreview && firstAsset) {
    return (
      <div className="aspect-[4/3] bg-photo-bg/40 overflow-hidden relative">
        <ResultAssetMedia asset={firstAsset} onError={() => setPreviewFailed(true)} />
      </div>
    );
  }

  return (
    <div className="aspect-[4/3] bg-photo-bg/40 overflow-hidden relative flex flex-col items-center justify-center px-4 text-center">
      <div className="w-11 h-11 rounded-xl bg-photo-surface-elevated/55 border border-photo-border-subtle/40 flex items-center justify-center mb-3">
        {isPending ? (
          <Loader2 className="w-5 h-5 text-photo-muted/45 animate-spin stroke-[1.5]" />
        ) : (
          <ResultIcon className="w-5 h-5 text-photo-muted/45 stroke-[1.5]" />
        )}
      </div>
      <p className="text-[12px] font-medium text-photo-fg/68">{placeholderText}</p>
      {isPending ? (
        <p className="text-[10.5px] text-photo-muted/45 leading-relaxed mt-1">
          Можно вернуться позже
        </p>
      ) : mediaKind === "audio" && resultCount > 1 ? (
        <p className="text-[10.5px] text-photo-muted/45 leading-relaxed mt-1">
          Откройте карточку для списка вариантов
        </p>
      ) : item.resultAssetId ? (
        <p className="text-[10.5px] text-photo-muted/45 leading-relaxed mt-1 break-all">
          ID: {item.resultAssetId}
        </p>
      ) : null}
    </div>
  );
}

function ModalMediaGallery({ item }: { item: HistoryItem }) {
  if (!item.resultAssets.length) {
    return <ResultPlaceholder item={item} />;
  }

  const singleAsset = item.resultAssets.length === 1 ? item.resultAssets[0] : null;
  if (singleAsset && resolveAssetMediaKind(singleAsset) === "image") {
    return (
      <div className="max-h-[62vh] overflow-hidden bg-photo-bg/35 flex items-center justify-center">
        <ResultAssetMedia asset={singleAsset} imageFit="contain" className="block max-h-[62vh] max-w-full" />
      </div>
    );
  }

  return (
    <div className="max-h-[62vh] overflow-y-auto bg-photo-bg/35">
      <div className="space-y-3 p-3">
        {item.resultAssets.map((asset, index) => {
          const mediaKind = resolveAssetMediaKind(asset);

          return (
            <div key={asset.assetId} className="rounded-xl border border-photo-border-subtle/45 bg-photo-surface/55 overflow-hidden">
              {mediaKind === "unknown" ? (
                <div className="aspect-[4/3] bg-photo-bg/40 flex flex-col items-center justify-center px-4 text-center">
                  <div className="w-11 h-11 rounded-xl bg-photo-surface-elevated/55 border border-photo-border-subtle/40 flex items-center justify-center mb-3">
                    <Image className="w-5 h-5 text-photo-muted/45 stroke-[1.5]" />
                  </div>
                  <p className="text-[12px] font-medium text-photo-fg/68">Результат сохранён</p>
                  <p className="text-[10.5px] text-photo-muted/45 leading-relaxed mt-1 break-all">ID: {asset.assetId}</p>
                </div>
              ) : (
                <div className={mediaKind === "audio" ? "min-h-[150px]" : "aspect-video bg-photo-bg/40"}>
                  <ResultAssetMedia asset={asset} imageFit={mediaKind === "image" ? "contain" : "cover"} />
                </div>
              )}

              <div className="px-3 py-2.5 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-photo-fg/60 leading-relaxed truncate">{assetDisplayName(asset, index)}</p>
                  <p className="text-[10px] text-photo-muted/40 leading-relaxed break-all">{asset.assetId}</p>
                </div>
                <ResultAssetDownloadLink asset={asset} index={index} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CopyPromptButton({ prompt, className }: { prompt: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(prompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [prompt]);

  return (
    <button type="button" onClick={handleCopy} className={className}>
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Скопировано" : "Промпт"}
    </button>
  );
}

function ModalMeta({
  item,
  showPrompt,
  setShowPrompt,
  onDeleteRequest,
  isDeleting,
}: {
  item: HistoryItem;
  showPrompt: boolean;
  setShowPrompt: (value: boolean) => void;
  onDeleteRequest: (item: HistoryItem) => void;
  isDeleting: boolean;
}) {
  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12.5px] font-semibold text-photo-fg/75">{item.model}</span>
        <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${STATUS_CFG.success.cls}`}>Готово</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-photo-muted/45 mb-3">
        {item.cost > 0 && <span className="text-photo-fg/60 font-semibold">{item.cost} токенов</span>}
        {item.cost > 0 && <span className="text-photo-border-subtle/50">·</span>}
        <span>{item.date} · {item.time}</span>
      </div>

      {item.resultAssets.length > 0 && (
        <div className="rounded-lg bg-photo-bg/50 border border-photo-border-subtle/30 px-3 py-2.5 mb-3">
          {item.resultAssets.length > 1 ? (
            <>
              <p className="text-[10.5px] text-photo-fg/55 leading-relaxed">
                Вариантов сохранено: {item.resultAssets.length}
              </p>
              {item.resultAssets.map((asset, index) => (
                <p key={asset.assetId} className="text-[10.5px] text-photo-muted/45 leading-relaxed mt-1 break-all">
                  Результат {index + 1}: {asset.originalFilename || asset.assetId}
                </p>
              ))}
            </>
          ) : (
            <>
              <p className="text-[10.5px] text-photo-muted/45 leading-relaxed break-all">Result asset ID: {item.resultAssetId}</p>
              {item.resultFilename && (
                <p className="text-[10.5px] text-photo-fg/55 leading-relaxed mt-1 break-all">{item.resultFilename}</p>
              )}
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowPrompt(!showPrompt)}
        className="flex items-center gap-1.5 text-[11.5px] font-medium text-photo-muted/50 hover:text-photo-muted/80 transition-colors mb-3"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showPrompt ? "rotate-180" : ""}`} />
        Показать запрос
      </button>
      {showPrompt && (
        <div className="rounded-lg bg-photo-bg/50 border border-photo-border-subtle/30 px-3 py-2.5 mb-3">
          <p className="text-[11.5px] text-photo-fg/60 leading-relaxed break-words">{item.prompt}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <a
          href={item.resultAssetId ? assetContentPath(item.resultAssetId, true) : undefined}
          download={item.resultFilename || undefined}
          aria-disabled={!item.resultAssetId}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-photo-accent/[0.12] text-photo-accent text-[12px] font-medium border border-photo-accent/25 ${
            item.resultAssetId ? "hover:bg-photo-accent/[0.18] transition-colors" : "opacity-70 pointer-events-none"
          }`}
        >
          <Download className="w-3.5 h-3.5" />
          Скачать
        </a>
        <CopyPromptButton
          prompt={item.prompt}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-photo-surface-elevated/40 text-photo-fg/60 text-[12px] font-medium border border-photo-border-subtle/50 hover:text-photo-fg/80 transition-colors"
        />
        <button
          type="button"
          onClick={() => onDeleteRequest(item)}
          disabled={isDeleting}
          className="w-9 h-9 rounded-lg bg-photo-surface-elevated/40 border border-photo-border-subtle/50 flex items-center justify-center text-photo-muted/45 hover:text-red-300/80 hover:bg-red-500/[0.08] transition-colors disabled:opacity-55 disabled:cursor-wait shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function DeleteConfirmation({
  item,
  isDeleting,
  error,
  onCancel,
  onConfirm,
}: {
  item: HistoryItem;
  isDeleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-photo-bg/90 backdrop-blur-sm" onClick={isDeleting ? undefined : onCancel} />
      <div className="relative z-10 w-full max-w-[380px] mx-4 rounded-2xl border border-photo-border/50 bg-photo-surface/95 shadow-2xl overflow-hidden px-5 py-5">
        <div className="w-9 h-9 rounded-xl bg-red-500/[0.08] flex items-center justify-center mb-3">
          <Trash2 className="w-4 h-4 text-red-400/60 stroke-[1.6]" />
        </div>
        <p className="text-[15px] font-semibold text-photo-fg/78 mb-1.5">Удалить из истории?</p>
        <p className="text-[12.5px] text-photo-muted/50 leading-relaxed mb-3">
          {item.model} · {item.date} · {item.time}
        </p>
        {error && (
          <div className="rounded-lg bg-red-500/[0.07] border border-red-500/[0.12] px-3 py-2 mb-3">
            <p className="text-[11.5px] text-red-300/70 leading-relaxed">{error}</p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 py-2 rounded-lg bg-photo-surface-elevated/40 text-photo-fg/60 text-[12px] font-medium border border-photo-border-subtle/50 hover:text-photo-fg/80 transition-colors disabled:opacity-55"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 py-2 rounded-lg bg-red-500/[0.12] text-red-300/80 text-[12px] font-medium border border-red-500/[0.22] hover:bg-red-500/[0.18] transition-colors disabled:opacity-55 disabled:cursor-wait"
          >
            {isDeleting ? "Удаляем" : "Удалить"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrackRow({ track }: { track: MusicTrack }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const canSeek = isFinitePositiveDuration(duration);
  const progress = canSeek ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const syncAudioState = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    setDuration(isFinitePositiveDuration(audio.duration) ? audio.duration : 0);
    setCurrentTime(Number.isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime : 0);
  }, []);

  const handleTogglePlayback = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      audio.play().catch(() => setIsPlaying(false));
      return;
    }

    audio.pause();
  }, []);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !isFinitePositiveDuration(audio.duration)) {
      return;
    }

    const nextTime = Number(event.currentTarget.value);
    if (!Number.isFinite(nextTime)) {
      return;
    }

    audio.currentTime = Math.min(Math.max(nextTime, 0), audio.duration);
    setCurrentTime(audio.currentTime);
  }, []);

  return (
    <div className="flex flex-col gap-2.5 py-3 px-3.5 rounded-xl bg-photo-bg/40 border border-photo-border-subtle/30">
      <div className="flex items-center gap-3">
        {track.coverUrl ? (
          <img src={track.coverUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-photo-surface-elevated/50 flex items-center justify-center shrink-0 border border-photo-border-subtle/40">
            <Music className="w-4 h-4 text-photo-muted/50" />
          </div>
        )}
        <span className="text-[12px] font-medium text-photo-fg/70 flex-1 min-w-0 truncate">{track.title}</span>
        <a
          href={assetContentPath(track.assetId, true)}
          download={track.originalFilename || undefined}
          className="w-8 h-8 rounded-full bg-photo-surface-elevated/50 border border-photo-border-subtle/40 flex items-center justify-center text-photo-muted/40 hover:text-photo-fg/60 transition-colors shrink-0"
          onClick={stopMediaPropagation}
          onMouseDown={stopMediaPropagation}
          onPointerDown={stopMediaPropagation}
          onTouchStart={stopMediaPropagation}
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
          data-testid="history-track-play-toggle"
          onClick={handleTogglePlayback}
          onMouseDown={stopMediaPropagation}
          onPointerDown={stopMediaPropagation}
          onTouchStart={stopMediaPropagation}
          className="w-8 h-8 rounded-full bg-photo-accent/[0.14] border border-photo-accent/25 flex items-center justify-center text-photo-accent hover:bg-photo-accent/[0.2] transition-colors shrink-0"
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
        </button>
        <div
          data-testid="history-track-seek"
          className="relative flex-1 h-8 rounded-full bg-photo-surface-elevated/35 border border-photo-border-subtle/35 flex items-center px-3 gap-2"
          onClick={stopMediaPropagation}
          onMouseDown={stopMediaPropagation}
          onPointerDown={stopMediaPropagation}
          onTouchStart={stopMediaPropagation}
        >
          <div className="relative flex-1 h-1 rounded-full bg-photo-border-subtle/35 overflow-hidden">
            <div className="absolute inset-y-0 left-0 rounded-full bg-photo-accent/75" style={{ width: `${progress}%` }} />
          </div>
          <span className="w-[68px] text-right text-[10px] tabular-nums text-photo-muted/45 shrink-0">
            {formatTrackTime(currentTime)} / {formatTrackTime(duration)}
          </span>
          <input
            type="range"
            aria-label={`Позиция ${track.title}`}
            min="0"
            max={canSeek ? duration : 0}
            step="0.01"
            value={canSeek ? Math.min(currentTime, duration) : 0}
            disabled={!canSeek}
            onChange={handleSeek}
            onClick={stopMediaPropagation}
            onMouseDown={stopMediaPropagation}
            onPointerDown={stopMediaPropagation}
            onTouchStart={stopMediaPropagation}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
        </div>
      </div>
      <audio
        ref={audioRef}
        src={track.audioUrl}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={syncAudioState}
        onDurationChange={syncAudioState}
        onCanPlay={syncAudioState}
        onTimeUpdate={syncAudioState}
        onEnded={() => {
          setIsPlaying(false);
          syncAudioState();
        }}
        onPlay={() => {
          setIsPlaying(true);
          syncAudioState();
        }}
        onPause={() => {
          setIsPlaying(false);
          syncAudioState();
        }}
        onClick={stopMediaPropagation}
        onDoubleClick={stopMediaPropagation}
        onMouseDown={stopMediaPropagation}
        onPointerDown={stopMediaPropagation}
        onTouchStart={stopMediaPropagation}
        onKeyDown={stopMediaPropagation}
      />
    </div>
  );
}

export default function History() {
  const navigate = useNavigate();
  const { isAuthorized, isReady } = useAuth();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [viewItem, setViewItem] = useState<HistoryItem | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<HistoryItem | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadHistory = useCallback(async ({
    showLoader = true,
    isActive = () => true,
  }: {
    showLoader?: boolean;
    isActive?: () => boolean;
  } = {}) => {
    if (!isReady || !isAuthorized) {
      return;
    }

    if (showLoader) {
      setIsLoading(true);
    }
    setLoadError(null);

    try {
      const response = await fetch("/api/generations/history", {
        credentials: "include",
      });
      const payload = await parseJson<BackendGenerationHistoryResponse>(response);

      if (!response.ok) {
        if (response.status === 401 && isActive()) {
          navigate("/login?returnTo=%2Fhistory", { replace: true });
          return;
        }

        throw new Error(payload.outcome || "generation_history_unavailable");
      }

      if (!isActive()) {
        return;
      }

      const nextItems = Array.isArray(payload.generations)
        ? payload.generations
            .map(toHistoryItem)
            .filter((item): item is HistoryItem => Boolean(item))
        : [];

      setItems(nextItems);
    } catch {
      if (isActive()) {
        setItems([]);
        setLoadError("Не удалось загрузить историю. Попробуйте позже.");
      }
    } finally {
      if (showLoader && isActive()) {
        setIsLoading(false);
      }
    }
  }, [isAuthorized, isReady, navigate]);

  useEffect(() => {
    let active = true;

    loadHistory({
      isActive: () => active,
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [loadHistory]);

  const requestDelete = useCallback((item: HistoryItem) => {
    setDeleteCandidate(item);
    setDeleteError(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteCandidate || deletingIds.has(deleteCandidate.id)) {
      return;
    }

    const historyId = deleteCandidate.id;
    setDeleteError(null);
    setDeletingIds((current) => {
      const next = new Set(current);
      next.add(historyId);
      return next;
    });

    try {
      const response = await fetch(`/api/generations/history/${encodeURIComponent(historyId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await response.json().catch(() => null) as { outcome?: string } | null;

      if (!response.ok) {
        if (response.status === 401) {
          navigate("/login?returnTo=%2Fhistory", { replace: true });
          return;
        }

        throw new Error(payload?.outcome || "generation_history_delete_failed");
      }

      setItems((current) => current.filter((item) => item.id !== historyId));
      setViewItem((current) => (current?.id === historyId ? null : current));
      setDeleteCandidate(null);
    } catch {
      setDeleteError("Не удалось удалить. Попробуйте позже.");
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(historyId);
        return next;
      });
    }
  }, [deleteCandidate, deletingIds, navigate]);

  const successItems = useMemo(() => items.filter((item) => item.status === "success"), [items]);
  const failedItems = useMemo(() => items.filter((item) => item.status === "failed"), [items]);
  const pendingItems = useMemo(() => items.filter((item) => item.status === "pending"), [items]);
  const hasPendingItems = pendingItems.length > 0;

  useEffect(() => {
    if (!hasPendingItems || !isReady || !isAuthorized) {
      return;
    }

    let active = true;
    const intervalId = window.setInterval(() => {
      loadHistory({
        showLoader: false,
        isActive: () => active,
      }).catch(() => {});
    }, HISTORY_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [hasPendingItems, isAuthorized, isReady, loadHistory]);

  const isEmpty = !isLoading && items.length === 0 && !loadError;

  return (
    <div className="min-h-screen bg-photo-bg text-photo-fg">
      <AppHeader />

      <main className="max-w-[640px] mx-auto px-4 sm:px-5 pt-5 pb-14">
        <button type="button" onClick={() => navigate("/home")} className="flex items-center gap-1 text-[12.5px] text-photo-muted/50 hover:text-photo-muted/80 transition-colors mb-4">
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Главная</span>
        </button>

        <div className="mb-5 px-0.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-photo-accent/70 mb-1.5">ИСТОРИЯ</p>
              <h1 className="text-[24px] sm:text-[26px] font-semibold tracking-[-0.025em] text-photo-fg leading-tight">История генераций</h1>
            </div>
          </div>
          <p className="text-[13px] text-photo-muted/55 mt-1 leading-relaxed">
            Результаты хранятся 7 дней. Скачайте важное заранее.
          </p>
        </div>

        {isLoading && (
          <div className="rounded-2xl border border-photo-border/50 bg-photo-surface/60 px-5 py-10 text-center">
            <div className="w-10 h-10 rounded-xl bg-photo-surface-elevated/50 border border-photo-border-subtle/40 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-5 h-5 text-photo-muted/40 animate-spin" />
            </div>
            <p className="text-[15px] font-semibold text-photo-fg/70 mb-1.5">Загружаем историю</p>
            <p className="text-[12.5px] text-photo-muted/45 leading-relaxed">
              Подтягиваем ваши последние генерации.
            </p>
          </div>
        )}

        {!isLoading && loadError && (
          <div className="rounded-2xl border border-red-500/[0.12] bg-photo-surface/55 px-5 py-10 text-center">
            <div className="w-10 h-10 rounded-xl bg-red-500/[0.08] flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-5 h-5 text-red-400/40 stroke-[1.5]" />
            </div>
            <p className="text-[15px] font-semibold text-photo-fg/70 mb-1.5">История недоступна</p>
            <p className="text-[12.5px] text-photo-muted/45 leading-relaxed">{loadError}</p>
          </div>
        )}

        {isEmpty && (
          <div className="rounded-2xl border border-photo-border/50 bg-photo-surface/60 px-5 py-10 text-center">
            <div className="w-10 h-10 rounded-xl bg-photo-surface-elevated/50 border border-photo-border-subtle/40 flex items-center justify-center mx-auto mb-4">
              <Image className="w-5 h-5 text-photo-muted/40 stroke-[1.5]" />
            </div>
            <p className="text-[15px] font-semibold text-photo-fg/70 mb-1.5">Пока пусто</p>
            <p className="text-[12.5px] text-photo-muted/45 leading-relaxed mb-5">
              Ваши генерации появятся здесь после первого результата.
            </p>
            <button
              type="button"
              onClick={() => navigate("/home")}
              className="px-4 py-2 rounded-lg bg-photo-accent/[0.12] text-photo-accent text-[12px] font-medium border border-photo-accent/25 hover:bg-photo-accent/[0.20] transition-colors"
            >
              На главную
            </button>
          </div>
        )}

        {!isLoading && !loadError && ORDER.map((dateLabel) => {
          const datePending = pendingItems.filter((item) => item.date === dateLabel);
          const dateSuccess = successItems.filter((item) => item.date === dateLabel);
          const dateFailed = failedItems.filter((item) => item.date === dateLabel);
          if (datePending.length === 0 && dateSuccess.length === 0 && dateFailed.length === 0) {
            return null;
          }

          return (
            <div key={dateLabel} className="mb-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-photo-muted/50 mb-2 px-0.5">{dateLabel}</p>

              {datePending.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {datePending.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-photo-border/50 bg-photo-surface/60 overflow-hidden transition-all duration-150"
                    >
                      <ResultPlaceholder item={item} />
                      <div className="px-3.5 pt-2.5 pb-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[12px] font-semibold text-photo-fg/80 min-w-0">{item.model}</span>
                          <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border shrink-0 ${STATUS_CFG.pending.cls}`}>
                            {STATUS_CFG.pending.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10.5px]">
                          {item.cost > 0 && (
                            <span className="text-photo-fg/65 font-semibold">{item.cost} токенов</span>
                          )}
                          {item.cost > 0 && <span className="text-photo-border-subtle/60">·</span>}
                          <span className="text-photo-muted/50">{item.time}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {dateSuccess.length > 0 && (
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 ${datePending.length > 0 ? "mt-2.5" : ""}`}>
                  {dateSuccess.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-photo-border/50 bg-photo-surface/60 overflow-hidden transition-all duration-150 hover:border-photo-border/70 hover:bg-photo-surface-elevated/30 group"
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setViewItem(item);
                          setShowPrompt(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setViewItem(item);
                            setShowPrompt(false);
                          }
                        }}
                        className="w-full text-left cursor-pointer"
                      >
                        <ResultPlaceholder item={item} />
                        <div className="px-3.5 pt-2.5 pb-1.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[12px] font-semibold text-photo-fg/80">{item.model}</span>
                            <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${STATUS_CFG.success.cls}`}>
                              {STATUS_CFG.success.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10.5px]">
                            {item.cost > 0 && (
                              <span className="text-photo-fg/65 font-semibold">{item.cost} токенов</span>
                            )}
                            {item.cost > 0 && <span className="text-photo-border-subtle/60">·</span>}
                            <span className="text-photo-muted/50">{item.time}</span>
                          </div>
                        </div>
                      </div>

                      <div className="px-3.5 pb-2.5 pt-1 flex items-center gap-1.5">
                        <a
                          href={item.resultAssetId ? assetContentPath(item.resultAssetId, true) : undefined}
                          download={item.resultFilename || undefined}
                          aria-disabled={!item.resultAssetId}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium ${
                            item.resultAssetId
                              ? "text-photo-muted/45 hover:text-photo-fg/60 hover:bg-photo-surface-elevated/40 transition-colors"
                              : "text-photo-muted/35 opacity-70 pointer-events-none"
                          }`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Download className="w-3 h-3" />
                          Скачать
                        </a>
                        <CopyPromptButton
                          prompt={item.prompt}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-photo-muted/45 hover:text-photo-fg/60 hover:bg-photo-surface-elevated/40 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => requestDelete(item)}
                          disabled={deletingIds.has(item.id)}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-photo-muted/45 hover:text-red-300/75 hover:bg-red-500/[0.08] transition-colors disabled:opacity-55 disabled:cursor-wait ml-auto"
                        >
                          <Trash2 className="w-3 h-3" />
                          Удалить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {dateFailed.length > 0 && (
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 ${datePending.length > 0 || dateSuccess.length > 0 ? "mt-2.5" : ""}`}>
                  {dateFailed.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setViewItem(item);
                        setShowPrompt(false);
                      }}
                      className="text-left rounded-2xl border border-red-500/[0.12] bg-photo-surface/55 hover:bg-photo-surface-elevated/30 hover:border-red-500/20 transition-all duration-150 overflow-hidden"
                    >
                      <div className="aspect-[4/3] bg-photo-bg/30 flex items-center justify-center">
                        <div className="w-10 h-10 rounded-xl bg-red-500/[0.08] flex items-center justify-center">
                          <AlertTriangle className="w-5 h-5 text-red-400/40 stroke-[1.5]" />
                        </div>
                      </div>
                      <div className="px-3.5 pt-2.5 pb-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[12px] font-semibold text-photo-fg/75">{item.model}</span>
                          <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${STATUS_CFG.failed.cls}`}>
                            {STATUS_CFG.failed.label}
                          </span>
                        </div>
                        {item.errorText && (
                          <p className="text-[10.5px] text-red-400/45 leading-snug line-clamp-2 mb-1">{item.errorText}</p>
                        )}
                        <span className="text-[10.5px] text-photo-muted/45 block">{item.time}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {!isLoading && !loadError && !isEmpty && (
          <p className="text-[10.5px] text-photo-muted/30 text-center leading-relaxed px-4 mt-1">
            Результаты автоматически удаляются через 7 дней.
          </p>
        )}
      </main>

      {viewItem?.status === "success" && viewItem.type !== "music" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-photo-bg/90 backdrop-blur-sm" onClick={() => setViewItem(null)} />
          <div className="relative z-10 w-full max-w-[520px] max-h-[calc(100vh-2rem)] mx-4 rounded-2xl border border-photo-border/50 bg-photo-surface/95 shadow-2xl overflow-hidden overflow-y-auto">
            <button
              type="button"
              onClick={() => setViewItem(null)}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-red-950/40 border border-red-500/20 flex items-center justify-center text-red-400/60 hover:text-red-300/80 hover:bg-red-950/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <ModalMediaGallery item={viewItem} />

            <ModalMeta
              item={viewItem}
              showPrompt={showPrompt}
              setShowPrompt={setShowPrompt}
              onDeleteRequest={requestDelete}
              isDeleting={deletingIds.has(viewItem.id)}
            />
          </div>
        </div>
      )}

      {viewItem?.status === "success" && viewItem.type === "music" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-photo-bg/90 backdrop-blur-sm" onClick={() => setViewItem(null)} />
          <div className="relative z-10 w-full max-w-[520px] mx-4 rounded-2xl border border-photo-border/50 bg-photo-surface/95 shadow-2xl overflow-hidden">
            <button type="button" onClick={() => setViewItem(null)} className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-red-950/40 border border-red-500/20 flex items-center justify-center text-red-400/60 hover:text-red-300/80 hover:bg-red-950/60 transition-colors">
              <X className="w-4 h-4" />
            </button>

            <div className="px-4 pt-5 pb-4">
              <div className="flex items-center justify-between mb-2 pr-8">
                <span className="text-[12.5px] font-semibold text-photo-fg/75">{viewItem.model}</span>
                <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${STATUS_CFG.success.cls}`}>Готово</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-photo-muted/45 mb-4">
                {viewItem.cost > 0 && <span className="text-photo-fg/60 font-semibold">{viewItem.cost} токенов</span>}
                {viewItem.cost > 0 && <span className="text-photo-border-subtle/50">·</span>}
                <span>{viewItem.date} · {viewItem.time}</span>
              </div>

              <div className="flex flex-col gap-2.5 mb-4 max-h-[35vh] overflow-y-auto pr-1">
                {viewItem.tracks?.map((track) => (
                  <TrackRow key={track.id} track={track} />
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowPrompt(!showPrompt)}
                className="flex items-center gap-1.5 text-[11.5px] font-medium text-photo-muted/50 hover:text-photo-muted/80 transition-colors mb-3"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showPrompt ? "rotate-180" : ""}`} />
                Показать запрос
              </button>
              {showPrompt && (
                <div className="rounded-lg bg-photo-bg/50 border border-photo-border-subtle/30 px-3 py-2.5 mb-3">
                  <p className="text-[11.5px] text-photo-fg/60 leading-relaxed break-words">{viewItem.prompt}</p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <CopyPromptButton
                  prompt={viewItem.prompt}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-photo-surface-elevated/40 text-photo-fg/60 text-[12px] font-medium border border-photo-border-subtle/50 hover:text-photo-fg/80 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => requestDelete(viewItem)}
                  disabled={deletingIds.has(viewItem.id)}
                  className="w-9 h-9 rounded-lg bg-photo-surface-elevated/40 border border-photo-border-subtle/50 flex items-center justify-center text-photo-muted/45 hover:text-red-300/80 hover:bg-red-500/[0.08] transition-colors disabled:opacity-55 disabled:cursor-wait shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewItem?.status === "failed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-photo-bg/90 backdrop-blur-sm" onClick={() => setViewItem(null)} />
          <div className="relative z-10 w-full max-w-[420px] mx-4 rounded-2xl border border-photo-border/50 bg-photo-surface/95 shadow-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setViewItem(null)}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-red-950/40 border border-red-500/20 flex items-center justify-center text-red-400/60 hover:text-red-300/80 hover:bg-red-950/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="px-5 py-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-red-500/[0.08] flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-red-400/60 stroke-[1.6]" />
                </div>
                <span className={`text-[10px] font-semibold px-2 py-[2px] rounded-full border ${STATUS_CFG.failed.cls}`}>Ошибка</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-photo-muted/45 mb-3">
                <span className="text-photo-fg/60 font-semibold">{viewItem.model}</span>
                <span className="text-photo-border-subtle/50">·</span>
                <span>{viewItem.date} · {viewItem.time}</span>
              </div>
              {viewItem.errorText && (
                <div className="rounded-lg bg-photo-bg/50 border border-photo-border-subtle/30 px-3 py-2.5 mb-4">
                  <p className="text-[12px] text-photo-fg/55 leading-relaxed">{viewItem.errorText}</p>
                </div>
              )}
              <button
                type="button"
                onClick={() => requestDelete(viewItem)}
                disabled={deletingIds.has(viewItem.id)}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/[0.10] text-red-300/75 text-[12px] font-medium border border-red-500/[0.18] hover:bg-red-500/[0.15] transition-colors disabled:opacity-55 disabled:cursor-wait"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteCandidate && (
        <DeleteConfirmation
          item={deleteCandidate}
          isDeleting={deletingIds.has(deleteCandidate.id)}
          error={deleteError}
          onCancel={() => {
            if (!deletingIds.has(deleteCandidate.id)) {
              setDeleteCandidate(null);
              setDeleteError(null);
            }
          }}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
