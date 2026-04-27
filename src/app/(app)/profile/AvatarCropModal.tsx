"use client";

import { useState, useRef } from "react";

export function AvatarCropModal({
  imageSrc,
  onCrop,
  onCancel,
}: {
  imageSrc: string;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastPosRef.current.x;
    const dy = e.clientY - lastPosRef.current.y;
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    lastPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const handleApply = async () => {
    if (!imgRef.current) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 400;
    canvas.width = size;
    canvas.height = size;

    const img = imgRef.current;
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const drawWidth = img.naturalWidth * zoom;
    const drawHeight = img.naturalHeight * zoom;
    
    const cx = size / 2;
    const cy = size / 2;
    
    ctx.clearRect(0, 0, size, size);
    // 280 is the crop box size in UI
    ctx.drawImage(
      img,
      cx - (drawWidth / 2) + (offset.x * (size / 280)),
      cy - (drawHeight / 2) + (offset.y * (size / 280)),
      drawWidth,
      drawHeight
    );

    canvas.toBlob((blob) => {
      if (blob) onCrop(blob);
    }, "image/jpeg", 0.9);
  };

  return (
    <div className="fixed inset-0 z-[1100] flex flex-col bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
      <header className="safe-top flex items-center justify-between px-6 py-4 text-white">
        <button onClick={onCancel} className="text-sm font-black uppercase tracking-widest text-muted hover:text-white transition-colors">Отмена</button>
        <h2 className="text-sm font-black uppercase tracking-[0.2em]">Кадрирование</h2>
        <button onClick={handleApply} className="text-sm font-black uppercase tracking-widest text-primary hover:text-primary-light transition-colors">Готово</button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6">
        <div 
          className="relative w-72 h-72 rounded-[3rem] overflow-hidden border-4 border-white/20 shadow-2xl bg-neutral-900 touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageSrc}
            alt=""
            className="absolute max-w-none select-none pointer-events-none transition-smooth"
            style={{
              transform: `translate3d(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px), 0) scale(${zoom})`,
              left: "50%",
              top: "50%",
            }}
          />
          <div className="absolute inset-0 ring-[80px] ring-black/40 pointer-events-none" />
        </div>

        <div className="mt-12 w-full max-w-xs space-y-6">
           <div className="space-y-3">
              <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-muted/60 px-1">
                 <span>Масштаб</span>
                 <span>{Math.round(zoom * 100)}%</span>
              </div>
              <input 
                type="range" 
                min="0.5" 
                max="3" 
                step="0.01" 
                value={zoom} 
                onChange={e => setZoom(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-full appearance-none accent-primary"
              />
           </div>
           
           <p className="text-center text-[10px] font-bold text-muted/40 uppercase tracking-widest leading-relaxed">
             Перетащите фото, чтобы выбрать область.<br/>Используйте ползунок для масштаба.
           </p>
        </div>
      </main>
    </div>
  );
}
