"use client";

import { useState, useRef, useEffect } from "react";
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
}: {
  initialFiles: File[];
  onSend: (items: MediaPreviewItem[], caption: string) => void;
  onCancel: () => void;
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

  if (isCropping && currentItem?.type === "IMAGE") {
    return (
      <MediaCropModal
        imageSrc={currentItem.previewUrl}
        onCrop={handleCropSave}
        onCancel={() => setIsCropping(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-black animate-in fade-in duration-200">
      {/* Top Toolbar */}
      <header className="safe-top flex items-center justify-between px-4 py-4 bg-gradient-to-b from-black/60 to-transparent z-10">
        <button onClick={onCancel} className="touch-target h-10 px-2 flex items-center text-sm font-black uppercase tracking-widest text-white/80 hover:text-white transition-smooth active:scale-95">
          Отмена
        </button>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsHD(!isHD)}
            className={`h-8 px-3 rounded-full flex items-center justify-center text-[10px] font-black uppercase tracking-widest transition-smooth active:scale-95 ${isHD ? "bg-primary text-black shadow-[0_0_15px_rgba(var(--primary),0.5)]" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
          >
            HD
          </button>
          
          {currentItem?.type === "IMAGE" && (
            <>
              <button onClick={() => setIsCropping(true)} className="touch-target h-10 w-10 flex items-center justify-center text-white/80 hover:text-white transition-smooth active:scale-90" title="Crop">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              </button>
              {/* Fake buttons for MVP, real ones would open respective editors */}
              <button className="touch-target h-10 w-10 flex items-center justify-center text-white/80 hover:text-white transition-smooth active:scale-90 opacity-50" title="Text (скоро)">
                <span className="font-serif text-lg font-bold">T</span>
              </button>
              <button className="touch-target h-10 w-10 flex items-center justify-center text-white/80 hover:text-white transition-smooth active:scale-90 opacity-50" title="Draw (скоро)">
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
              <img src={currentItem.previewUrl} alt="" className="max-w-full max-h-full object-contain" />
            )}
            {currentItem.type === "VIDEO" && (
              <video src={currentItem.previewUrl} controls className="max-w-full max-h-full object-contain" autoPlay loop muted playsInline />
            )}
            {currentItem.type === "FILE" && (
              <div className="flex flex-col items-center justify-center p-8 bg-white/5 rounded-[2rem] border border-white/10">
                <div className="h-20 w-20 bg-primary/20 text-primary rounded-3xl flex items-center justify-center mb-6">
                  <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                </div>
                <p className="text-white font-bold max-w-[200px] truncate text-center">{currentItem.file.name}</p>
                <p className="text-white/50 text-[10px] font-black uppercase tracking-widest mt-2">{(currentItem.file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            )}
            
            <button onClick={handleRemoveCurrent} className="absolute top-4 right-4 h-10 w-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-danger hover:text-white transition-colors active:scale-90 shadow-xl border border-white/10">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </>
        ) : null}
      </main>

      {/* Bottom Toolbar & Carousel */}
      <footer className="safe-bottom flex flex-col bg-gradient-to-t from-black/90 via-black/80 to-transparent pt-8 pb-4 px-4 z-10 gap-4">
        
        {/* Thumbnails Carousel */}
        {items.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x">
            {items.map((item, idx) => (
              <button 
                key={item.id} 
                onClick={() => setCurrentIndex(idx)}
                className={`relative h-14 w-14 shrink-0 rounded-xl overflow-hidden snap-center transition-all ${idx === currentIndex ? "ring-2 ring-primary scale-100 opacity-100" : "opacity-50 scale-95 hover:opacity-80"}`}
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
            onClick={() => fileInputRef.current?.click()}
            className="touch-target h-12 w-12 shrink-0 rounded-2xl bg-white/10 text-white flex items-center justify-center hover:bg-white/20 active:scale-95 transition-smooth"
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
              placeholder="Добавить подпись..."
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
            onClick={() => {
              if (items.length > 0) onSend(items, caption);
            }}
            className="touch-target h-12 w-12 shrink-0 rounded-2xl bg-primary text-black flex items-center justify-center shadow-[0_0_20px_rgba(var(--primary),0.3)] hover:scale-105 active:scale-95 transition-smooth"
          >
            <svg className="h-5 w-5 translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
