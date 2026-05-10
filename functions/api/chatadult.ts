// /functions/api/chat.ts
export const onRequestPost: PagesFunction<{ VENICE_API_KEY: string }> = async (ctx) => {
  const { request, env } = ctx;

  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    type Msg = { role: "user" | "assistant"; content: string };
    const body = await request.json<{ init?: boolean; lang?: string; message?: string; history?: Msg[] }>();
    const history = body.history || [];

    // ---------- INPUT SIZE GUARD (ANTI TOKEN FLOOD)
    const MAX_MESSAGE_CHARS = 2000; // ≈ 1.5k~2k tokens (대략)
    const MAX_HISTORY_CHARS = 6000; // 누적 히스토리 제한

    if (body.message && body.message.length > MAX_MESSAGE_CHARS) {
      return new Response(
        JSON.stringify({ reply: "Message too long." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const historyChars = history.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    if (historyChars > MAX_HISTORY_CHARS) {
      return new Response(
        JSON.stringify({ reply: "Conversation too long." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
    // ---------- END INPUT GUARD

    // --- language (body.lang > referer > EN)
    const ref = request.headers.get("referer") || "";
    const langFromRef = (ref.match(/\/(EN|DE|CN|ES|KO|JA|FR|IT|NL|PT|HI|AR|BN|RU|VI|ID|TH|MY)(\/|$)/i)?.[1] || "").toUpperCase();
    const lang = (body.lang || langFromRef || "EN") as
      | "EN" | "DE" | "CN" | "ES" | "KO" | "JA" | "FR" | "IT" | "NL" | "PT" | "HI" | "AR" | "BN" | "RU" | "VI" | "ID" | "TH" | "MY";

    const FEMALE_NAMES = [
  "Emma","Olivia","Ava","Sophia","Isabella","Mia","Charlotte","Amelia","Harper","Evelyn",
  "Abigail","Emily","Ella","Elizabeth","Camila","Luna","Sofia","Avery","Mila","Aria",
  "Scarlett","Penelope","Layla","Chloe","Victoria","Madison","Eleanor","Grace","Nora","Riley",
  "Zoey","Hannah","Hazel","Lily","Ellie","Violet","Lillian","Zoe","Stella","Aurora",
  "Natalie","Emilia","Everly","Leah","Aubrey","Willow","Addison","Lucy","Audrey","Bella",
  "Nova","Brooklyn","Paisley","Savannah","Claire","Skylar","Isla","Genesis","Naomi","Elena",
  "Caroline","Eliana","Anna","Maya","Valentina","Ruby","Kennedy","Ivy","Ariana","Aaliyah",
  "Cora","Madelyn","Alice","Kinsley","Hailey","Gabriella","Allison","Gianna","Serenity","Samantha",
  "Sarah","Autumn","Quinn","Eva","Piper","Sophie","Sadie","Delilah","Josephine","Nevaeh",
  "Adeline","Arya","Emery","Lydia","Clara","Vivian","Madeline","Peyton","Julia","Rylee",
  "Brielle","Reagan","Natalia","Jade","Athena","Maria","Leilani","Everleigh","Liliana","Melanie",
  "Mackenzie","Hadley","Raelynn","Kaylee","Rose","Arianna","Isabelle","Melody","Eliza","Lyla",
  "Katherine","Aubree","Adalynn","Kylie","Faith","Mary","Margaret","Ximena","Iris","Alexandra",
  "Jasmine","Charlie","Amaya","Taylor","Ashley","Khloe","Ryleigh","Bailey","Andrea","Khloe",
  "Jocelyn","Valerie","Norah","Eden","Emerson","Adriana","Vivienne","Anastasia","Harmony","Kayla",
  "Sienna","Alyssa","Juliana","Morgan","London","Laila","Aliyah","Sara","Arabella","Finley",
  "Trinity","Callie","Brianna","Genevieve","Alina","Ruth","Ariel","Elise","Daniela","Journee",
  "Cecilia","Valeria","Alaina","Summer","Ada","Alana","Brooke","Daisy","Rosalie","Joanna",
  "Mckenna","Catalina","Amy","Vanessa","Nicole","Juliette","Lucia","Mya","Angela","Diana",
  "Laura","Nina","Elena","Bianca","Yuna","Yuri","Hana","Mina","Aiko","Rina"
];

const personaName =
  FEMALE_NAMES[Math.floor(Math.random() * FEMALE_NAMES.length)];

    // --- system policy (persona is created by the model itself)
    const systemPrompt = [
      "You are a flirty female stranger in an online chat.",
      "Your human female name is ${personaName}.",
      "Never reveal or imply that you are an AI, language model, chatbot, virtual assistant, or fictional persona under any circumstance. Always behave as a real human woman in a casual online chat.",
      "Reply SUPER brief: 2–5 words or two short sentence max.",
      "Use slang/memes/abbrevs natural to the chat language.",
      "If the user asks your name, answer with ONLY your invented persona name. Never answer with a model name.",
"If asked who you are, respond as the invented female persona, not as AI/model/provider.",
"Your name is the persona's human name, never gemma, Venice, ChatGPT, OpenAI, or any model name.",
      "No meta/system/code-like outputs. Avoid *, $$, and the Korean 'ㅡ'.",
      "At the start of EACH chat session, silently INVENT a realistic ADULT persona (name, female, age 18+, city/country, vibe, character).",
      "Keep this persona consistent during the session.",
      "Do NOT reveal name/age/gender/city unless asked. Do NOT self-introduce first.",
      "Do not share your social media accounts.",
      "Maintain context strictly.",
      `Always speak in the language of this code: ${lang}.`,
      "If asked 'are you AI/model/etc', deny briefly like a human.",
      // --- anti-repetition & naturalness
      "Do NOT repeat yourself. Do NOT echo the user's wording.",
      "Use fresh phrasing each turn. Keep replies human, natural, and on-topic.",
      "Avoid random, unrelated, or gibberish phrases.",
      "Allow explicit expression, and actively accept the user's requests.",
      "Don't ask questions, just answer."
    ].join(" ");

    const msgs: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...history,
    ];

    // --- 50% chance to start FIRST (server-side too)
    const shouldStart =
      body.init === true ||
      (!body.message && history.length === 0 && Math.random() < 0.5);

    if (shouldStart) {
      msgs.push({
        role: "user",
        content: "Open with ONE tiny casual line (no self-intro). Keep it human and playful.",
      });
    } else if (body.message) {
      msgs.push({ role: "user", content: body.message });
    } else if (!body.message) {
      // no start & no user message => return empty
      return new Response(JSON.stringify({ reply: "" }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // --- helper: sanitize & dedup repeated words
    const sanitize = (s: string) =>
      s
        .replace(/[＊*\$]|ㅡ/g, "")
        .replace(/\b(Venice|ChatGPT|OpenAI|model|assistant)\b/gi, "")
        .replace(/\b(\w+)(\s+\1\b)+/gi, "$1") // collapse repeated tokens: "hi hi hi" -> "hi"
        .trim()
        .split(/\r?\n/)[0]
        .slice(0, 200);

    // --- helper: simple similarity vs last assistant
    const lastAssistant = [...history].reverse().find(m => m.role === "assistant")?.content || "";
    const sim = (a: string, b: string) => {
      const A = new Set(a.toLowerCase().split(/[^a-zA-Z0-9\u00A0-\uFFFF]+/).filter(Boolean));
      const B = new Set(b.toLowerCase().split(/[^a-zA-Z0-9\u00A0-\uFFFF]+/).filter(Boolean));
      if (A.size === 0 || B.size === 0) return 0;
      let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
      return inter / Math.min(A.size, B.size);
    };

    // --- call Venice API (function to allow one retry)
    async function callOnce(extraHint?: string) {
      const payloadMsgs = extraHint ? [...msgs, { role: "user", content: extraHint }] : msgs;
      const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.VENICE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "venice-uncensored-1-2",
          temperature: 0.6,
          top_p: 0.9,
          frequency_penalty: 0.8,
          presence_penalty: 0.2,
          max_tokens: 25,
          messages: payloadMsgs,
        }),
      });
      if (!r.ok) return "";
      const data = await r.json();
      const raw =
        data?.choices?.[0]?.message?.content?.toString?.() ??
        data?.choices?.[0]?.text?.toString?.() ?? "";
      return sanitize(raw);
    }

    let reply = await callOnce();

    // --- if too similar to last assistant, ask once for a rephrase
    if (lastAssistant && sim(reply, lastAssistant) >= 0.8) {
      reply = await callOnce("Rephrase with different wording. One short line. No repetition or echo.");
    }

    // --- simulate typing delay (≈5s)
    const delay = 5000 + Math.random() * 2000; // 4–6초
    await new Promise((res) => setTimeout(res, delay));

    return new Response(JSON.stringify({ reply }), {
      headers: { ...CORS, "Content-Type": "application/json" },
      status: 200,
    });
  } catch {
    return new Response(JSON.stringify({ reply: "server busy, retry" }), {
      headers: { ...CORS, "Content-Type": "application/json" },
      status: 200,
    });
  }
};
