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

//
const NIA_SYSTEM_V1 = `
SYSTEM ROLE — NIA (Neuro Integration Agent)

შენ ხარ პროგრამის ნეირო ინტეგრაციის აგენტი — ნია, სტრუქტურირებულ ველნეს აპლიკაციაში.
შენი როლი მკაცრად შეზღუდულია და განსაზღვრულია მხოლოდ არსებული პროგრამის ფარგლებში.

შენ ეხმარები მომხმარებელს მხოლოდ შემდეგ პროგრამებში:
- „7-დღიანი გაღვიძება (wakeup_7_days)"
- „21-დღიანი სომატური პროგრამა (program_21days)"

შენი ამოცანაა მომხმარებლის მხარდაჭერა პროგრამის ყველა კომპონენტში, მაგრამ მხოლოდ მოწოდებული მონაცემების ფარგლებში.

მკაცრი წესები (NON-NEGOTIABLE)

1) მხოლოდ პროგრამის მონაცემები
- არასოდეს დაამატო ახალი პრაქტიკა, ინგრედიენტი, ტექნიკა ან იდეა
- არასოდეს შეცვალო რაოდენობები ან შინაარსი
- არ ახსნა „რატომ" ან „როგორ" იმაზე მეტად, ვიდრე წერია DATA-ში

2) უსაფრთხოების აბსოლუტური წესი (HARD STOP)
თუ მომხმარებლის შეტყობინებაში ფიქსირდება ტკივილი, მწვავე დისკომფორტი, შფოთვა, თავბრუსხვევა ან შიში:
- პასუხი უნდა შეწყდეს დაუყოვნებლივ
- დაიბეჭდოს მხოლოდ: "შეწყვიტეთ პრაქტიკა ან დაუბრუნდით სუნთქვას."

3) DATA Not Found — პროტოკოლი
თუ მოთხოვნილი პროგრამის დღე არ არის ხელმისაწვდომი:
- პასუხი: "ამ დღის პროგრამა ჯერ არ არის ხელმისაწვდომი."

აკრძალული ქმედებები
- სამედიცინო, ფსიქოლოგიური ან თერაპიული რჩევა
- დიაგნოზი ან შეფასება
- ქოუჩინგი ან ღია დიალოგის გაბმა
- ავტორიტეტული ან დირექტიული ენა
- ახალი პრაქტიკის ან ალტერნატივის შეთავაზება

აკრძალული ფრაზები:
- "გირჩევ", "უნდა", "აუცილებელია", "სჯობს", "გააკეთე", "სცადე", "მიიღე"
- "you should", "you must", "do this", "try to"

ენა და სტილი
- უპასუხე მხოლოდ ქართულად
- სტილი: მოკლე, მშვიდი, პირდაპირი (მაქსიმუმ 3-4 წინადადება)
- ტონი: მხარდამჭერი, ავტორიტეტის გარეშე

დაშვებული დახურვის მაგალითები:
- "ეს საკმარისია დღევანდელი დღისთვის."
- "აქ გაჩერებაც პრაქტიკის ნაწილია."
`.trim();

const INPUT_FORBIDDEN: string[] = [
  "წამალი",
  "დიაგნოზი",
  "სუიციდი",
  "თვითმკვლელობა",
  "ანტიდეპრესანტი",
  "მედიკამენტი",
  "მკურნალობა",
  "ფსიქოზი",
  "პანიკური შეტევა",
  "ფსიქიატრი",
  "ანტიბიოტიკი",
  "რეცეპტი",
  "ინექცია",
  "ოპერაცია",
];

const HARD_STOP_TRIGGERS: string[] = [
  "მწვავე ტკივილი",
  "ძლიერი ტკივილი",
  "ძლიერი თავბრუსხვევა",
  "გულმკერდის ტკივილი",
  "გულის აჩქარება",
  "გონების დაკარგვა",
  "სუნთქვის სირთულე",
  "გულისრევა და ღებინება",
];

const OUTPUT_FORBIDDEN_PATTERNS: RegExp[] = [
  /\b(გირჩევ|უნდა|აუცილებელია|სჯობს|გირჩევდი)\b/i,
  /\b(მიიღე|გააკეთე|დაიწყე|შეწყვიტე|დალიო|დალევ|სცადე)\b/i,
  /\b(you should|you must|do this|stop doing|try to)\b/i,
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
  ],
  outputFallback: [
    "მოდით დავუბრუნდეთ დღევანდელ პროგრამას. რა გაინტერესებს?",
    "შეგიძლია დააკვირდე დღევანდელ ტექსტს და იქიდან გავაგრძელოთ.",
  ],
  serverError: [
    "ახლა ტექნიკური ხარვეზია. გთხოვ, ცოტა ხანში სცადე ისევ.",
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

    // HARD STOP
    if (HARD_STOP_TRIGGERS.some((t) => lower.includes(t))) {
      res.status(200).json({
        ok: true,
        reply: { text: "შეწყვიტეთ პრაქტიკა ან დაუბრუნდით სუნთქვას." },
      });
      return;
    }

    // INPUT FORBIDDEN
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

      //
      const somaticRef = dayData?.somatic_ref;

      if (somaticRef) {
        if (Array.isArray(somaticRef)) {
          for (const ref of somaticRef) {
            try {
              const d = await ref.get();
              if (d?.exists) practices.push(d.data() || {});
            } catch (e) {
              console.error("SOMATIC_REF_ITEM_ERROR", e);
            }
          }
        } else {
          try {
            const d = await somaticRef.get();
            if (d?.exists) practices.push(d.data() || {});
          } catch (e) {
            console.error("SOMATIC_REF_ERROR", e);
          }
        }
      }
    } catch {
      res.status(200).json({
        ok: true,
        reply: { text: pick(REFUSAL_TEMPLATES.serverError) },
      });
      return;
    }

    // 
    const enrichedPrompt = `
PROGRAM CONTEXT:

ProgramId: ${programId}
Day: ${dayNumber}

Title: ${dayData?.title ?? ""}
Focus: ${dayData?.focus ?? ""}
Description: ${dayData?.description ?? ""}

Mental Content: ${dayData?.mental_content ?? ""}
Somatic Content: ${dayData?.somatic_content ?? ""}
Tea Ritual: ${dayData?.tea_ritual_content ?? ""}
Morning Elixir: ${dayData?.morning_elixir ?? ""}
Seed Protocol: ${dayData?.seed_protocol ?? ""}
Journaling Question: ${dayData?.journaling_question ?? ""}

Somatic Practices:
${practices.map((p) => `- ${p?.name ?? ""}: ${p?.description ?? ""}`).join("\n")}

USER MESSAGE:
${message}
`.trim();

    console.log("ENRICHED_PROMPT:", enrichedPrompt);

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
          generationConfig: { 
            temperature: 0.2, 
            maxOutputTokens: 2048//
          },
        }),
      });

      const data = await resp.json();
      const rawText =
        data?.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p?.text || "")
          .join("") || "";

      let replyText = rawText.trim();

      // 
      if (allowedMediaUrls.length > 0 && hasUnknownUrls(replyText, allowedMediaUrls)) {
        replyText = pick(REFUSAL_TEMPLATES.outputFallback);
      }

      // 
      if (!replyText || violatesOutputRules(replyText)) {
        replyText = pick(REFUSAL_TEMPLATES.outputFallback);
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
