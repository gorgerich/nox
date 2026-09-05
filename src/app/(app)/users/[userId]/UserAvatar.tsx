"use client";

import { avatarTint } from "@/lib/avatar-tint";
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
        // The same name-derived tint as every other avatar; a single accent
        // wash made every profile look like the same person.
        className="nox-avatar-tint relative h-24 w-24 overflow-hidden rounded-full transition-smooth active:scale-[0.96] disabled:cursor-default"
        data-avatar-tint={avatarTint(displayName || username)}
        aria-label="Открыть фото профиля"
      >
        {src ? (
          <Image src={src} alt={displayName} fill className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl font-semibold">
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
