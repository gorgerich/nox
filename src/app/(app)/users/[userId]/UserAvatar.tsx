"use client";

import Image from "next/image";
import { useState } from "react";
import { AvatarViewer } from "../../profile/AvatarViewer";

export function UserAvatar({
  src,
  displayName,
  username,
}: {
  src: string | null;
  displayName: string;
  username: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => src && setOpen(true)}
        disabled={!src}
        className="relative h-32 w-32 overflow-hidden rounded-full bg-primary/10 text-primary transition-smooth active:scale-[0.96] disabled:cursor-default"
        aria-label="Открыть фото профиля"
      >
        {src ? (
          <Image src={src} alt={displayName} fill className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl font-semibold">
            {displayName[0].toUpperCase()}
          </div>
        )}
      </button>

      <AvatarViewer
        src={open ? src : null}
        alt={displayName}
        fileName={`${username || "profile"}-avatar.jpg`}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
