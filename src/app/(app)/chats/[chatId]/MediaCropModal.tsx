"use client";

import { useState, useRef, useEffect } from "react";

const CROP_AREA_SIZE = 288; // 72rem * 4px = 288px

export function MediaCropModal({
  imageSrc,
  onCrop,
  onCancel,
}: {
  imageSrc: string;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(0.1);
  const maxZoom = Math.max(3, minZoom * 5); // Allow up to 3x or 5x the minZoom
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  
  // Interaction refs
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const { naturalWidth, naturalHeight } = img;
    // Fit-to-frame initially so the image is fully visible
    const fitZoom = Math.min(CROP_AREA_SIZE / naturalWidth, CROP_AREA_SIZE / naturalHeight);
    setMinZoom(fitZoom);
    setZoom(fitZoom);
    setOffset({ x: 0, y: 0 });
  };

  // Mouse drag
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") {
      isDraggingRef.current = true;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && isDraggingRef.current) {
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") {
      isDraggingRef.current = false;
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    const zoomDelta = e.deltaY > 0 ? -minZoom * 0.5 : minZoom * 0.5;
    const newZoom = Math.max(minZoom, Math.min(maxZoom, zoom + zoomDelta));
    setZoom(newZoom);
  };

  // Touch drag & pinch
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartDistRef.current = dist;
      pinchStartZoomRef.current = zoom;
      isDraggingRef.current = false;
    } else if (e.touches.length === 1) {
      isDraggingRef.current = true;
      lastPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      pinchStartDistRef.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = dist / pinchStartDistRef.current;
      const newZoom = Math.max(minZoom, Math.min(maxZoom, pinchStartZoomRef.current * scale));
      setZoom(newZoom);
    } else if (e.touches.length === 1 && isDraggingRef.current) {
      const dx = e.touches[0].clientX - lastPosRef.current.x;
      const dy = e.touches[0].clientY - lastPosRef.current.y;
      setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    pinchStartDistRef.current = null;
  };

  const handleApply = async () => {
    if (!imgRef.current) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 512; // Export size
    canvas.width = size;
    canvas.height = size;

    const img = imgRef.current;
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const scaleToCanvas = size / CROP_AREA_SIZE;
    const cx = size / 2;
    const cy = size / 2;
    
    const drawWidth = img.naturalWidth * zoom * scaleToCanvas;
    const drawHeight = img.naturalHeight * zoom * scaleToCanvas;

    const drawX = cx - (drawWidth / 2) + (offset.x * scaleToCanvas);
    const drawY = cy - (drawHeight / 2) + (offset.y * scaleToCanvas);

    // Fill background with black for transparent images or when scaled down
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);
    
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

    canvas.toBlob((blob) => {
      if (blob) onCrop(blob);
    }, "image/jpeg", 0.9);
  };

  // Prevent scrolling on touch devices while editing
  useEffect(() => {
    const preventDefault = (e: TouchEvent) => e.preventDefault();
    document.body.addEventListener('touchmove', preventDefault, { passive: false });
    return () => {
      document.body.removeEventListener('touchmove', preventDefault);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[1100] flex flex-col bg-black backdrop-blur-3xl animate-in fade-in duration-300 touch-none">
      <header className="safe-top flex items-center justify-between px-6 py-4 text-white z-10">
        <button onClick={onCancel} className="h-10 px-2 flex items-center text-sm font-bold text-white/70 hover:text-white transition-colors active:scale-[0.96]">Отмена</button>
        <h2 className="text-sm font-black uppercase tracking-widest text-white/90">Кадрирование</h2>
        <button onClick={handleApply} className="h-10 px-2 flex items-center text-sm font-bold text-primary hover:text-primary-light transition-colors active:scale-[0.96]">Готово</button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 w-full h-full relative overflow-hidden">
        {/* Fullscreen interactive area for dragging/pinching */}
        <div 
          className="absolute inset-0 z-0 cursor-move"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageSrc}
            alt=""
            onLoad={handleImageLoad}
            className="absolute max-w-none select-none pointer-events-none"
            style={{
              transform: `translate3d(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px), 0) scale(${zoom})`,
              left: "50%",
              top: "50%",
              willChange: "transform",
            }}
          />
        </div>

        {/* Crop Mask Overlay */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
           <div className="w-72 h-72 rounded-2xl border-[3px] border-white/50 relative shadow-[0_0_0_9999px_rgba(0,0,0,0.8)]" />
        </div>
      </main>

      {/* Footer controls */}
      <footer className="safe-bottom p-6 z-10 flex flex-col items-center justify-center w-full bg-gradient-to-t from-black to-transparent">
        <div className="w-full max-w-xs space-y-4">
           <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-white/60 px-1">
              <span>Масштаб</span>
              <span>{Math.round(zoom * 100)}%</span>
           </div>
           <input 
             type="range" 
             min={minZoom} 
             max={maxZoom} 
             step={minZoom * 0.1} 
             value={zoom} 
             onChange={e => setZoom(parseFloat(e.target.value))}
             className="w-full h-1.5 bg-white/20 rounded-full appearance-none accent-primary cursor-pointer"
           />
        </div>
      </footer>
    </div>
  );
}
