import { IncomingCallResume } from "./IncomingCallResume";

export default async function IncomingCallPage({
  searchParams,
}: {
  searchParams: Promise<{ callId?: string }>;
}) {
  const { callId } = await searchParams;
  return <IncomingCallResume callId={typeof callId === "string" ? callId : null} />;
}
