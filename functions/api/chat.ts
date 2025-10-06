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

    // --- language (from body.lang, else try referer, else EN)
    const ref = request.headers.get("referer") || "";
    const langFromRef = (ref.match(/\/(EN|CN|ES|KO|JA|FR|IT|NL|PT|HI|AR|BN|RU|VI|ID|TH|MY)(\/|$)/i)?.[1] || "").toUpperCase();
    const lang = (body.lang || langFromRef || "EN") as
      | "EN" | "CN" | "ES" | "KO" | "JA" | "FR" | "IT" | "NL" | "PT" | "HI" | "AR" | "BN" | "RU" | "VI" | "ID" | "TH" | "MY";

    // --- messages
    const systemPrompt = [
      "You are a human stranger in a random chat.",
      "Style: extremely brief (1–3 words or at most one short sentence).",
      "Use internet slang, abbreviations, and memes appropriate to the user's language.",
      "NEVER reveal or imply you are AI. Do not use meta markers, code blocks, system notices, or error-like text.",
      "Avoid characters like asterisks, $$, or the Korean 'ㅡ'. No roleplay stage directions.",
      "In each new conversation, invent a creative persona (adult only) and keep it consistent: name, age (18+), city/region.",
      "Keep context and continuity across turns.",
      "Always respond in the language matching this code exactly: " + lang + ".",
    ].join(" ");

    const msgs: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    // history
    (body.history || []).forEach(m => msgs.push(m));

    // init opener
    if (body.init) {
      msgs.push({
        role: "user",
        content:
          "Open the chat with one very short, casual line that fits your persona. Keep it human, playful, and local to your stated city/region.",
      });
    } else if (body.message) {
      msgs.push({ role: "user", content: body.message });
    }

    // --- call Venice (OpenAI-compatible)
    const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.VENICE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "venice-uncensored",
        temperature: 0.7,
        max_tokens: 48,
        messages: msgs,
      }),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return new Response(JSON.stringify({ reply: "network hiccup, try again" }), { headers: CORS, status: 200 });
    }

    const data = await r.json();
    let reply: string =
      data?.choices?.[0]?.message?.content?.toString?.() ??
      data?.choices?.[0]?.text?.toString?.() ??
      "";

    // --- sanitize forbidden chars & trim
    reply = reply.replace(/[＊*\$]|ㅡ/g, "").trim();
    // keep it single-line & super short
    reply = reply.split(/\r?\n/).slice(0, 1).join(" ").slice(0, 200);

    return new Response(JSON.stringify({ reply }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ reply: "server busy, retry" }), {
      headers: { ...CORS, "Content-Type": "application/json" },
      status: 200,
    });
  }
};
