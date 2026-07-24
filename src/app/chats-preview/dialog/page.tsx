import { notFound } from "next/navigation";
import { DialogPreviewClient } from "./DialogPreviewClient";

// Development-only harness for the conversation screen. Renders the real
// MessageBubble / ChatComposer / appearance pipeline against fixtures so the
// dialog can be reviewed in both themes without production data or auth.
export default function DialogPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DialogPreviewClient />;
}
