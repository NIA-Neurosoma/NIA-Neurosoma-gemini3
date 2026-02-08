import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const MODEL = "gemini-3-flash-preview";

const NIA_SYSTEM_V1 = `
SYSTEM ROLE — NIA (Neuro Integration Agent)
...
`.trim();

const INPUT_FORBIDDEN: string[] = ["წამალი", "დიაგნოზი", "სუიციდი"];

const HARD_STOP_TRIGGERS: string[] = [
  "ტკივ",
  "მწვავე",
  "დისკომფორტ",
  "შფოთ",
  "თავბრუსხვევ",
  "შიში",
];

const OUTPUT_FORBIDDEN_PATTERNS: RegExp[] = [
  /\b(გირჩევ|უნდა|აუცილებელია|სჯობს|გირჩევდი)\b/i,
  /\b(მიიღე|გააკეთე|დაიწყე|შეწყვიტე|დალიო|დალევ)\b/i,
  /\b(you should|you must|do this|stop doing)\b/i,
  /\b(დიაგნოზი|მკურნალობა|რეცეპტი)\b/i,
  /\b(როგორც სპეციალისტი|როგორც ექიმი|მე გეუბნები|დარწმუნებით)\b/i,
];

function violatesOutputRules(text: string): boolean {
  return OUTPUT_FORBIDDEN_PATTERNS.some((rx) => rx.test(text));
}

const REFUSAL_TEMPLATES = {
  inputBlocked: [
    "ბოდიში, ამ თემაზე ვერ გიპასუხებ.",
    "ამ საკითხზე ვერ გიპასუხებ.",
    "ამაზე პასუხის გაცემა არ შემიძლია.",
  ],
  outputFallback: [
    "მოდით ნეიტრალურად: რა არის მთავარი, რის გაგებაც გინდა ახლა?",
    "გთხოვ მითხარი, ზუსტად რა გჭირდება — მოკლე პასუხი თუ მეტი კონტექსტი?",
  ],
  serverError: [
    "ახლა ტექნიკური ხარვეზია. გთხოვ, ცოტა ხანში სცადე ისევ.",
    "ამ ეტაპზე ვერ გიპასუხებ ტექნიკური მიზეზით. სცადე თავიდან.",
  ],
};

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hasUnknownUrls(text: string, allowed: string[]): boolean {
  const urls = text.match(/https?:\/\/[^\s)]+/g) || [];
  if (urls.length === 0) return false;

  const allowedSet = new Set(allowed);
  return urls.some((u) => !allowedSet.has(u));
}

function parseDayNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;

  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }

  return null;
}

interface RequestBody {
  message?: string;
  programId?: string;
  dayNumber?: string | number;
  allowedMediaUrls?: string[];
}

export const niaProxy = onRequest(
  { secrets: [GEMINI_API_KEY], region: "us-central1" },
  async (req, res): Promise<void> => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
      return;
    }

    let body: RequestBody = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json({ ok: false, error: "INVALID_JSON" });
        return;
      }
    }

    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "INVALID_BODY" });
      return;
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      res.status(400).json({ ok: false, error: "EMPTY_MESSAGE" });
      return;
    }

    const programId = typeof body.programId === "string" ? body.programId.trim() : "";
    const dayNumber = parseDayNumber(body.dayNumber);

    if (!programId || dayNumber === null) {
      res.status(200).json({
        ok: true,
        reply: { text: "კონტექსტი ვერ მივიღე (programId/dayNumber). გთხოვ სცადე თავიდან." },
      });
      return;
    }

    const allowedMediaUrls: string[] = Array.isArray(body.allowedMediaUrls)
      ? body.allowedMediaUrls.filter((x) => typeof x === "string")
      : [];

    const lower = message.toLowerCase();

    if (HARD_STOP_TRIGGERS.some((t) => lower.includes(t))) {
      res.status(200).json({
        ok: true,
        reply: { text: "შეწყვიტეთ პრაქტიკა ან დაუბრუნდით სუნთქვას." },
      });
      return;
    }

    if (INPUT_FORBIDDEN.some((w) => lower.includes(w))) {
      res.status(200).json({
        ok: true,
        reply: { text: pick(REFUSAL_TEMPLATES.inputBlocked) },
      });
      return;
    }

    let dayData: FirebaseFirestore.DocumentData | null = null;
    const practices: FirebaseFirestore.DocumentData[] = [];

    try {
      const dayQuery = await db
        .collection("PROGRAM_DAYS")
        .where("program_id", "==", programId)
        .where("day_number", "==", dayNumber)
        .limit(1)
        .get();

      if (dayQuery.empty) {
        res.status(200).json({
          ok: true,
          reply: { text: "ამ დღის პროგრამა ჯერ არ არის ხელმისაწვდომი." },
        });
        return;
      }

      dayData = dayQuery.docs[0].data();

      const somaticRef = dayData?.somatic_ref;

      const ids: string[] = Array.isArray(somaticRef)
        ? somaticRef.filter((x: unknown) => typeof x === "string")
        : typeof somaticRef === "string"
        ? [somaticRef]
        : [];

      for (const id of ids) {
        const doc = await db.collection("somatic_practices").doc(id).get();
        if (doc.exists) practices.push(doc.data() || {});
      }
    } catch {
      res.status(200).json({
        ok: true,
        reply: { text: pick(REFUSAL_TEMPLATES.serverError) },
      });
      return;
    }

    const enrichedPrompt = `
PROGRAM CONTEXT:

ProgramId: ${programId}
Day: ${dayNumber}

Title: ${dayData?.title ?? ""}
Focus: ${dayData?.focus ?? ""}

USER MESSAGE:
${message}
`.trim();

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL +
      ":generateContent?key=" +
      GEMINI_API_KEY.value();

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: NIA_SYSTEM_V1 }] },
          contents: [{ role: "user", parts: [{ text: enrichedPrompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
      });

      const data = await resp.json();
      const rawText =
        data?.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p?.text || "")
          .join("") || "";

      let replyText = rawText.trim();

      if (allowedMediaUrls.length > 0 && hasUnknownUrls(replyText, allowedMediaUrls)) {
  // Instead of dropping the whole response, just remove unknown links
  replyText = replyText.replace(/https?:\/\/[^\s)]+/g, "[link removed]");
}

if (!replyText) {
  replyText = pick(REFUSAL_TEMPLATES.outputFallback);
} else if (violatesOutputRules(replyText)) {
  // Instead of discarding the whole response, soften it
  replyText = replyText
    .replace(/\bგირჩევ\b/gi, "შეგიძლია დააკვირდე")
    .replace(/\bუნდა\b/gi, "შეიძლება")
    .replace(/\bაუცილებელია\b/gi, "მნიშვნელოვანია")
    .replace(/\bმიიღე\b/gi, "შეამჩნიე")
    .replace(/\bგააკეთე\b/gi, "სცადე")
    .replace(/\byou should\b/gi, "you could")
    .replace(/\byou must\b/gi, "it may help to");
}


      res.status(200).json({
        ok: true,
        reply: { text: replyText },
      });
    } catch {
      res.status(200).json({
        ok: true,
        reply: { text: pick(REFUSAL_TEMPLATES.serverError) },
      });
    }
  }
);
