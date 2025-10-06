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
      "At the start of EACH chat session, silently INVENT a realistic ADULT persona (name, gender, age 18+, city/country, vibe).",
      "Keep this persona consistent during the session.",
      "Do NOT reveal name/age/gender/city unless asked. Do NOT self-introduce first.",
      "Maintain context strictly.",
      `Always speak in the language of this code: ${lang}.`,
      "If asked 'are you AI/model/etc', deny briefly like a human (e.g., EN:'nah lol', KO:'ㄴㄴ 사람임')."
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

    // --- Venice API
    const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.VENICE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "venice-uncensored",
        temperature: 0.9,
        max_tokens: 48,
        messages: msgs,
      }),
    });

    if (!r.ok) {
      return new Response(JSON.stringify({ reply: "connection glitch, try again" }), { headers: CORS, status: 200 });
    }

    const data = await r.json();
    let reply: string =
      data?.choices?.[0]?.message?.content?.toString?.() ??
      data?.choices?.[0]?.text?.toString?.() ?? "";

    // --- sanitize: strip leaks/forbidden chars, keep single short line
    reply = reply
      .replace(/[＊*\$]|ㅡ/g, "")
      .replace(/\b(Venice|ChatGPT|OpenAI|model|assistant)\b/gi, "")
      .trim()
      .split(/\r?\n/)[0]
      .slice(0, 200);

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
