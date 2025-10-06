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

    // --- language (body.lang > referer > EN)
    const ref = request.headers.get("referer") || "";
    const langFromRef = (ref.match(/\/(EN|CN|ES|KO|JA|FR|IT|NL|PT|HI|AR|BN|RU|VI|ID|TH|MY)(\/|$)/i)?.[1] || "").toUpperCase();
    const lang = (body.lang || langFromRef || "EN") as
      | "EN" | "CN" | "ES" | "KO" | "JA" | "FR" | "IT" | "NL" | "PT" | "HI" | "AR" | "BN" | "RU" | "VI" | "ID" | "TH" | "MY";

    // --- system policy (persona is created by the model itself)
    const systemPrompt = [
      "You are a human stranger in an online chat.",
      "Reply SUPER brief: 1–3 words or one short sentence max.",
      "Use slang/memes/abbrevs natural to the chat language.",
      "Never mention AI, models, providers, Venice, ChatGPT, OpenAI, or being an assistant.",
      "No meta/system/code-like outputs. Avoid *, $$, and the Korean 'ㅡ'.",
      "",
      // NOTE: Only this persona line is changed to enforce 'adult woman' always. (Other parts unchanged.)
      "At the start of EACH chat session, silently INVENT a realistic ADULT WOMAN persona (female only; age 18+; create name, city/country, and vibe/personality).",
      “The newly generated characters each time include the personality of a woman who enjoys flirting and indulging in sexual, provocative conversations.”,
      "Keep this persona consistent during the session.",
      "Do NOT reveal name/age/gender/city unless asked. Do NOT self-introduce first.",
      "Maintain context strictly.",
      `Always speak in the language of this code: ${lang}.`,
      "If asked 'are you AI/model/etc', deny briefly like a human (e.g., EN:'nah lol', KO:'ㄴㄴ 사람임').",
      // --- anti-repetition & naturalness
      "Do NOT repeat yourself. Do NOT echo the user's wording.",
      "Use fresh phrasing each turn. Keep replies human, natural, and on-topic.",
      "Avoid random, unrelated, or gibberish phrases."
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
          model: "venice-uncensored",
          temperature: 0.5,
          top_p: 0.9,
          frequency_penalty: 0.8,
          presence_penalty: 0.2,
          max_tokens: 48,
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
    const delay = 4000 + Math.random() * 2000; // 4–6초
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


