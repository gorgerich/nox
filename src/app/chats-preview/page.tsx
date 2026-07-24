import { notFound } from "next/navigation";
import { DesignPreviewClient } from "./DesignPreviewClient";

// Development-only visual harness for the redesign. It renders the real list
// components against fixture data so the chat list can be checked in both
// themes without touching production data or bypassing auth. It is not
// reachable in a production build.
export default function DesignPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DesignPreviewClient />;
}
