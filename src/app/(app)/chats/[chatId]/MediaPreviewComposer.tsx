"use client";

import { useState, useRef, useEffect } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { MediaCropModal } from "./MediaCropModal";

export interface MediaPreviewItem {
  id: string;
  file: File;
  previewUrl: string;
  type: "IMAGE" | "VIDEO" | "FILE";
}

export function MediaPreviewComposer({
  initialFiles,
  onSend,
  onCancel,
  captionIsSeparateMessage = false,
}: {
  initialFiles: File[];
  onSend: (items: MediaPreviewItem[], caption: string) => void;
  onCancel: () => void;
  /**
   * True in an encrypted one-to-one conversation, where a caption is delivered
   * as its own message rather than attached to the media — see
   * docs/product/attachment-caption-semantics.md. The user is told, because
   * two bubbles appearing where one was expected otherwise reads as a bug.
   */
  captionIsSeparateMessage?: boolean;
}) {
  const [items, setItems] = useState<MediaPreviewItem[]>(() => 
    initialFiles.map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      previewUrl: URL.createObjectURL(file),
      type: file.type.startsWith("image/") ? "IMAGE" : file.type.startsWith("video/") ? "VIDEO" : "FILE",
    }))
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [caption, setCaption] = useState("");
  const [isHD, setIsHD] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize items
  useEffect(() => {
    const currentItems = items;
    return () => {
      currentItems.forEach(item => URL.revokeObjectURL(item.previewUrl));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const added = Array.from(e.target.files).map((file) => ({
        id: Math.random().toString(36).slice(2),
        file,
        previewUrl: URL.createObjectURL(file),
        type: file.type.startsWith("image/") ? "IMAGE" as const : file.type.startsWith("video/") ? "VIDEO" as const : "FILE" as const,
      }));
      setItems((prev) => [...prev, ...added]);
      setCurrentIndex((prev) => prev === 0 && items.length === 0 ? 0 : prev);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveCurrent = () => {
    setItems(prev => {
      const next = [...prev];
      const removed = next.splice(currentIndex, 1)[0];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
    if (currentIndex >= items.length - 1) {
      setCurrentIndex(Math.max(0, items.length - 2));
    }
  };

  useEffect(() => {
    if (items.length === 0 && initialFiles.length > 0) {
      // If all removed, just cancel
      // but wait for initial load to finish first
      const timeout = setTimeout(() => {
         if (items.length === 0) onCancel();
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [items.length, initialFiles.length, onCancel]);

  const handleCropSave = (blob: Blob) => {
    const currentItem = items[currentIndex];
    if (!currentItem) return;

    const newFile = new File([blob], currentItem.file.name, { type: "image/jpeg" });
    const newUrl = URL.createObjectURL(newFile);

    setItems(prev => {
      const next = [...prev];
      const oldItem = next[currentIndex];
      if (oldItem) URL.revokeObjectURL(oldItem.previewUrl);
      next[currentIndex] = {
        ...oldItem,
        file: newFile,
        previewUrl: newUrl,
      };
      return next;
    });
    setIsCropping(false);
  };

  const currentItem = items[currentIndex];
  // While cropping this component renders MediaCropModal instead, which brings
  // its own trap; two traps fighting over the same focus is worse than none.
  const isCropView = isCropping && currentItem?.type === "IMAGE";
  const dialogRef = useFocusTrap<HTMLDivElement>(!isCropView, onCancel);

  if (isCropView) {
    return (
      <MediaCropModal
        imageSrc={currentItem.previewUrl}
        onCrop={handleCropSave}
        onCancel={() => setIsCropping(false)}
      />
    );
  }


  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[2000] flex flex-col bg-black animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Подготовка вложений"
    >
      {/* Top Toolbar */}
      <header className="safe-top flex items-center justify-between px-4 py-4 bg-gradient-to-b from-black/60 to-transparent z-10">
        <button type="button" onClick={onCancel} className="touch-target flex h-10 items-center px-2 text-sm font-semibold text-white/80 transition-smooth hover:text-white active:scale-[0.96]">
          Отмена
        </button>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsHD(!isHD)}
            aria-pressed={isHD}
            className={`flex h-8 items-center justify-center rounded-full px-3 text-xs font-semibold transition-smooth active:scale-[0.96] ${isHD ? "bg-primary text-white" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
          >
            HD
          </button>
          
          {currentItem?.type === "IMAGE" && (
            <>
              <button type="button" onClick={() => setIsCropping(true)} className="touch-target h-10 w-10 flex items-center justify-center text-white/80 hover:text-white transition-smooth active:scale-[0.96]" aria-label="Обрезать изображение">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              </button>
              {/* Fake buttons for MVP, real ones would open respective editors */}
              <button type="button" disabled className="touch-target h-10 w-10 flex items-center justify-center text-white/80 opacity-40" aria-label="Добавить текст, скоро">
                <span className="font-serif text-lg font-bold">T</span>
              </button>
              <button type="button" disabled className="touch-target h-10 w-10 flex items-center justify-center text-white/80 opacity-40" aria-label="Рисование, скоро">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Preview Area */}
      <main className="flex-1 relative flex items-center justify-center overflow-hidden">
        {currentItem ? (
          <>
            {currentItem.type === "IMAGE" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentItem.previewUrl} alt={currentItem.file.name} className="max-w-full max-h-full object-contain" />
            )}
            {currentItem.type === "VIDEO" && (
              <video src={currentItem.previewUrl} controls className="max-w-full max-h-full object-contain" autoPlay loop muted playsInline />
            )}
            {currentItem.type === "FILE" && (
              <div className="flex flex-col items-center justify-center rounded-[1.5rem] border border-white/10 bg-white/5 p-8">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[1.25rem] bg-primary/20 text-primary">
                  <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                </div>
                <p className="text-white font-bold max-w-[200px] truncate text-center">{currentItem.file.name}</p>
                <p className="mt-2 text-xs font-medium text-white/50">{(currentItem.file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            )}
            
            <button type="button" aria-label="Удалить вложение" onClick={handleRemoveCurrent} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/35 text-white backdrop-blur-xl transition-colors hover:bg-danger active:scale-[0.96]">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </>
        ) : null}
      </main>

      {/* Bottom Toolbar & Carousel */}
      <footer className="safe-bottom flex flex-col bg-gradient-to-t from-black/90 via-black/80 to-transparent pt-8 pb-4 px-4 z-10 gap-4">
        
        {/* Thumbnails Carousel */}
        {items.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x" data-nox-horizontal-scroll="true">
            {items.map((item, idx) => (
              <button 
                key={item.id} 
                type="button"
                aria-label={`Показать вложение ${idx + 1}`}
                aria-current={idx === currentIndex}
                onClick={() => setCurrentIndex(idx)}
                className={`relative h-14 w-14 shrink-0 rounded-xl overflow-hidden snap-center transition-[opacity,transform,box-shadow] ${idx === currentIndex ? "ring-2 ring-primary scale-100 opacity-100" : "opacity-50 scale-95 hover:opacity-80"}`}
              >
                {item.type === "IMAGE" || item.type === "VIDEO" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-white/10 flex items-center justify-center text-white/50">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-3">
          <button 
            type="button"
            aria-label="Добавить вложения"
            onClick={() => fileInputRef.current?.click()}
            className="touch-target flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/10 text-white transition-smooth hover:bg-white/20 active:scale-[0.96]"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            multiple 
            onChange={handleAddFiles} 
            className="hidden" 
          />

          <div className="flex-1 bg-white/10 border border-white/10 rounded-2xl flex items-center overflow-hidden focus-within:ring-2 focus-within:ring-primary/50 transition-smooth">
            <textarea
              className="w-full max-h-32 min-h-[48px] resize-none bg-transparent py-3.5 px-4 text-[15px] outline-none text-white placeholder:text-white/40"
              placeholder={captionIsSeparateMessage ? "Подпись — отдельным сообщением" : "Добавить подпись..."}
              aria-label="Подпись к вложениям"
              rows={1}
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
            />
          </div>

          <button 
            type="button"
            aria-label="Отправить вложения"
            onClick={() => {
              if (items.length > 0) onSend(items, caption);
            }}
            className="touch-target flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-sm transition-smooth active:scale-[0.96]"
          >
            <svg className="h-5 w-5 translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
