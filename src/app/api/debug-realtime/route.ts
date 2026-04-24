import { NextResponse } from "next/server";
import { getRealtimeServer } from "@/lib/realtime";
import type { Server } from "socket.io";

type GlobalWithSocket = typeof globalThis & {
  pmSocketIo?: Server;
};

export async function GET() {
  const io = getRealtimeServer();
  
  return NextResponse.json({
    ioAvailable: !!io,
    globalThisAvailable: !!(globalThis as GlobalWithSocket).pmSocketIo,
    processAvailable: !!(process as unknown as GlobalWithSocket).pmSocketIo,
    globalAvailable: !!(global as unknown as GlobalWithSocket).pmSocketIo,
  });
}
