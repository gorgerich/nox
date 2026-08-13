/**
 * The full circle: a device loses its keys, and the history comes back.
 *   npm run validate:e2ee-recovery
 *
 * This is the suite the recovery key exists for. Device private keys live in
 * IndexedDB, browsers evict IndexedDB, and every eviction mints a device that
 * cannot open anything sealed before it existed — production carries 66 device
 * bundles for 10 users, one of them with 35. A recovery key addressed on every
 * envelope is the way back, and "it decrypts" is only worth believing if a
 * browser with its storage wiped can actually read the messages again.
 *
 * So the wipe here is real: `indexedDB.deleteDatabase` on the E2EE store, which
 * is exactly what Safari does to an origin left alone for a week.
 *
 * It also asserts the property that is easy to oversell. A recovery key covers
 * what is sealed *after* it exists. The message sent before setup stays
 * unreadable, and this suite proves that too — so nobody ships a promise the
 * cryptography does not keep.
 */
import { randomUUID } from "node:crypto";
import {
  composerOf,
  createChecker,
  createPrisma,
  loadPlaywright,
  requireIsolatedDatabase,
  seedChat,
  seedUser,
  signIn,
  startApp,
  type BrowserLike,
  type ContextLike,
  type PageLike,
} from "./lib/browser-harness";

const PORT = Number(process.env.RECOVERY_PORT ?? 4021);
const PASSPHRASE = "correct horse battery staple";

async function openApp(context: ContextLike, base: string, username: string, path: string): Promise<PageLike> {
  const page = await context.newPage();
  await signIn(page, base, username);
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  return page;
}

/** Waits for the conversation to hold the expected number of messages. */
async function untilMessages(
  prisma: ReturnType<typeof createPrisma>,
  chatId: string,
  expected: number,
  timeoutMs = 45_000,
) {
  const deadline = Date.now() + timeoutMs;
  let count = await prisma.message.count({ where: { chatId } });
  while (count < expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    count = await prisma.message.count({ where: { chatId } });
  }
  return count;
}

async function send(page: PageLike, text: string) {
  const composer = await composerOf(page);
  await composer.fill(text);
  await composer.press("Enter");
}

async function main(): Promise<number> {
  const { check, failures } = createChecker();
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const aId = randomUUID();
  const bId = randomUUID();
  const aName = `reca${stamp}`;
  const bName = `recb${stamp}`;
  const chatId = `rec-chat-${stamp}`;

  const app = await startApp(url, PORT);
  let browser: BrowserLike | null = null;

  const BEFORE = `до-настройки-${stamp}`;
  const AFTER = `после-настройки-${stamp}`;

  try {
    await seedUser(prisma, aId, aName);
    await seedUser(prisma, bId, bName);
    await seedChat(prisma, { id: chatId, type: "DIRECT", owner: aId, members: [aId, bId] });

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();

    const contextA = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const contextB = await browser.newContext({ viewport: { width: 430, height: 900 } });

    // B has to exist as a device before A can encrypt to anyone.
    const pageB = await openApp(contextB, app.base, bName, `/chats/${chatId}`);
    await pageB.waitForTimeout(2_500);

    const pageA = await openApp(contextA, app.base, aName, `/chats/${chatId}`);
    await composerOf(pageA);
    await pageA.waitForTimeout(2_000);

    // --- 1 — a message sealed before any recovery key exists -----------------
    await send(pageA, BEFORE);
    check("the first message reaches the server", (await untilMessages(prisma, chatId, 1)) >= 1);

    // --- 2 — set the recovery key up through the real client code ------------
    // The client module is not reachable by URL from a test, so the setup runs
    // through the same API the UI calls, with the sealing done in the page so
    // the passphrase never leaves it — which is the property under test.
    const configured = await pageA.evaluate(
      `(async () => {
        const enc = new TextEncoder();
        const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
        const publicKey = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey));
        const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
        const randomSalt = crypto.getRandomValues(new Uint8Array(16));
        const account = enc.encode(${JSON.stringify(aId)});
        const salt = new Uint8Array(randomSalt.length + account.length);
        salt.set(randomSalt, 0); salt.set(account, randomSalt.length);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const material = await crypto.subtle.importKey("raw", enc.encode(${JSON.stringify(PASSPHRASE)}.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
        const wrapping = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapping, pkcs8);
        const b64 = (buf) => { const v = new Uint8Array(buf); let s = ""; for (const x of v) s += String.fromCharCode(x); return btoa(s); };
        const response = await fetch("/api/e2ee/recovery-key", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKey, ciphertext: b64(ciphertext), iv: b64(iv), salt: b64(salt),
            kdf: "PBKDF2-SHA256", algorithm: "AES-GCM", iterations: 600000 }),
        });
        return response.status;
      })()`,
    );
    check("the recovery key is stored", configured === 201, `status=${configured}`);

    // The server must hold ciphertext and never the passphrase.
    const stored = await prisma.accountRecoveryKey.findUnique({ where: { userId: aId } });
    check("the server holds a sealed recovery key", Boolean(stored?.ciphertext));
    check(
      "the stored key does not contain the passphrase",
      Boolean(stored) && !JSON.stringify(stored).includes(PASSPHRASE),
    );
    check("the key derivation is not weakened", (stored?.iterations ?? 0) >= 600_000, `iterations=${stored?.iterations}`);

    // --- 3 — a message sealed after the recovery key exists ------------------
    await pageA.reload({ waitUntil: "networkidle" });
    await composerOf(pageA);
    await pageA.waitForTimeout(2_000);
    await send(pageA, AFTER);
    check("the second message reaches the server", (await untilMessages(prisma, chatId, 2)) >= 2);
    await pageA.waitForTimeout(3_000);

    const afterMessage = await prisma.message.findFirst({
      where: { chatId, envelopes: { some: { recipientDeviceId: { startsWith: "recovery:" } } } },
      include: { envelopes: true },
    });
    check("the later message is addressed to the recovery key", Boolean(afterMessage));

    const beforeCount = await prisma.messageEnvelope.count({
      where: { recipientDeviceId: { startsWith: "recovery:" } },
    });
    check("recovery envelopes exist", beforeCount > 0, `envelopes=${beforeCount}`);

    // --- 4 — the eviction ----------------------------------------------------
    // Exactly what Safari does to an origin it has not seen for a week.
    await pageA.evaluate(
      `(async () => {
        await new Promise((resolve) => {
          const request = indexedDB.deleteDatabase("nox-e2ee");
          request.onsuccess = () => resolve(null);
          request.onerror = () => resolve(null);
          request.onblocked = () => resolve(null);
        });
      })()`,
    );
    await pageA.reload({ waitUntil: "networkidle" });
    await pageA.waitForTimeout(3_000);

    const bodyAfterWipe = await pageA.evaluate(`document.body.innerText`);
    check(
      "after the wipe the later message is not readable yet",
      typeof bodyAfterWipe === "string" && !bodyAfterWipe.includes(AFTER),
      "it was still on screen, so the wipe did not take",
    );

    // --- 5 — restore ---------------------------------------------------------
    const restored = await pageA.evaluate(
      `(async () => {
        const response = await fetch("/api/e2ee/recovery-key");
        if (!response.ok) return "fetch-failed";
        const { recoveryKey } = await response.json();
        if (!recoveryKey?.ciphertext) return "no-key";
        const dec = (value) => { const b = atob(value); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i += 1) out[i] = b.charCodeAt(i); return out; };
        const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(${JSON.stringify(PASSPHRASE)}.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
        const wrapping = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: dec(recoveryKey.salt), iterations: recoveryKey.iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        let plain;
        try {
          plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: dec(recoveryKey.iv) }, wrapping, dec(recoveryKey.ciphertext));
        } catch { return "wrong-passphrase"; }
        const privateKey = await crypto.subtle.importKey("pkcs8", plain, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
        // Stored where the decryption path looks for it.
        await new Promise((resolve, reject) => {
          const open = indexedDB.open("nox-e2ee");
          open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains("keys")) open.result.createObjectStore("keys"); };
          open.onsuccess = () => {
            const database = open.result;
            const tx = database.transaction("keys", "readwrite");
            tx.objectStore("keys").put(privateKey, "nox:e2ee:" + ${JSON.stringify(aId)} + ":recoveryPrivateKey");
            tx.oncomplete = () => resolve(null);
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        });
        return "ok";
      })()`,
    );
    check("the recovery key opens with the passphrase", restored === "ok", String(restored));

    // A wrong passphrase must not open it.
    const wrong = await pageA.evaluate(
      `(async () => {
        const response = await fetch("/api/e2ee/recovery-key");
        const { recoveryKey } = await response.json();
        const dec = (value) => { const b = atob(value); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i += 1) out[i] = b.charCodeAt(i); return out; };
        const material = await crypto.subtle.importKey("raw", new TextEncoder().encode("not the passphrase"), "PBKDF2", false, ["deriveKey"]);
        const wrapping = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: dec(recoveryKey.salt), iterations: recoveryKey.iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        try {
          await crypto.subtle.decrypt({ name: "AES-GCM", iv: dec(recoveryKey.iv) }, wrapping, dec(recoveryKey.ciphertext));
          return "opened";
        } catch { return "refused"; }
      })()`,
    );
    check("a wrong passphrase does not open the recovery key", wrong === "refused", String(wrong));

    // --- 6 — the history comes back -----------------------------------------
    await pageA.reload({ waitUntil: "networkidle" });
    await pageA.waitForTimeout(6_000);
    const bodyAfterRestore = (await pageA.evaluate(`document.body.innerText`)) as string;

    check(
      "the message sealed after setup is readable again",
      bodyAfterRestore.includes(AFTER),
      "the recovered history did not come back",
    );
    check(
      "the message sealed before setup stays unreadable",
      !bodyAfterRestore.includes(BEFORE),
      "it decrypted, which would mean the forward-only claim is wrong",
    );

    // --- 7 — the backfill ----------------------------------------------------
    // A device that can still read old history re-seals it to the recovery key
    // while that is still possible. Device B never lost anything, so opening
    // the conversation there should give the *first* message a recovery
    // envelope it did not have when it was sent.
    const beforeBackfill = await prisma.messageEnvelope.count({
      where: { recipientDeviceId: { startsWith: "recovery:" } },
    });
    await pageB.reload({ waitUntil: "networkidle" });
    await pageB.waitForTimeout(8_000);
    const afterBackfill = await prisma.messageEnvelope.count({
      where: { recipientDeviceId: { startsWith: "recovery:" } },
    });
    // Stated for what it is: B owns no recovery key, so B must add nothing.
    // The permission boundary is the point here — a reader backfilling into
    // somebody else's recovery key would be a hole, and this proves it does
    // not happen. Exercising a *successful* backfill needs an account with a
    // second surviving device, which this suite does not set up.
    check(
      "a reader without a recovery key adds no recovery envelopes",
      afterBackfill === beforeBackfill,
      `before=${beforeBackfill} after=${afterBackfill}`,
    );

    // The backfill must only ever address the reader's own recovery key.
    const foreign = await prisma.messageEnvelope.findMany({
      where: { recipientDeviceId: { startsWith: "recovery:" } },
      select: { recipientUserId: true, recipientDeviceId: true },
    });
    check(
      "every recovery envelope belongs to the account it names",
      foreign.every((envelope) => envelope.recipientDeviceId === `recovery:${envelope.recipientUserId}`),
      JSON.stringify(foreign.slice(0, 3)),
    );
  } finally {
    await browser?.close();
    await app.stop();
  }

  return failures();
}

main()
  .then((failed) => {
    if (failed > 0) {
      console.error(`\n${failed} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll E2EE recovery checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
