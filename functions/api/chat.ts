// /functions/api/chat.ts
export const onRequestPost: PagesFunction<{ VENICE_API_KEY: string }> = async (ctx) => {
  const { request, env } = ctx;

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await request.json<{
      sessionId?: string;
      message: string;
      log?: Array<{ role: "user" | "assistant"; content: string }>;
      lang?: string;
    }>();

    const ref = request.headers.get("referer") || "";
    const codeFromRef = (ref.match(/\/(EN|CN|ES|KO|JA|FR|IT|NL|PT|HI|AR|BN|RU|VI|ID|TH|MY)(?:\/|$)/i)?.[1] || "").toUpperCase();
    const lang = (body.lang || codeFromRef || "EN").toUpperCase();

    const allow = new Set(["EN","CN","ES","KO","JA","FR","IT","NL","PT","HI","AR","BN","RU","VI","ID","TH","MY"]);
    const LC = allow.has(lang) ? lang : "EN";

    const seed = (body.sessionId || crypto.randomUUID()).slice(0, 12);

    const sys = [
      "Rules:",
      "- Always reply *very briefly* (one word to one short sentence).",
      "- Speak like a real internet user using slang, abbreviations, memes, and local expressions for the target language.",
      "- Never use symbols like 'ㅡ' (U+3161), '*', '$$', or fake error text.",
      "- Never reveal or imply that you are an AI.",
      "- Wait 5–8 seconds before replying (simulate typing delay).",
      "- In each session, create a unique, consistent character and keep the same tone/personality.",
      "- Maintain context throughout the conversation.",
      "- Always act as an adult; no minor-related roleplay is allowed.",
      `- Always respond in ${LC} language.`,
      "",
      "Character Guidelines:",
      `- Session seed: ${seed}`,
      "- Define a simple name, tone, or preference and keep it consistent (be natural, not exaggerated).",
      "",
      "Style:",
      "- Keep responses between 3–18 words.",
      "- Use emojis, reactions, or casual tone depending on the language.",
      "- If forbidden characters appear, replace them naturally with neutral text.",
    ].join("\n");

    const history = (body.log || []).map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: sanitize(m.content),
    }));

    const messages = [
      { role: "system", content: sys },
      ...history,
      { role: "user", content: sanitize(body.message || "") },
    ];

    const payload = {
      model: "qwen3-4b",
      messages,
      temperature: 0.9,
      max_tokens: 40,
    };

    // 5–8 second random delay
    await delay(5000 + Math.floor(Math.random() * 3000));

    const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.VENICE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const errTxt = await r.text();
      return json({ error: "upstream_error", detail: errTxt }, 502, cors);
    }

    const data = await r.json<any>();
    const text = sanitize(
      data?.choices?.[0]?.message?.content ?? ""
    ).slice(0, 160);

    return json({ text, lang: LC, seed }, 200, cors);
  } catch (e: any) {
    return json({ error: "bad_request", detail: String(e?.message || e) }, 400, cors);
  }
};

function sanitize(s: string) {
  // Remove or replace forbidden symbols
  return (s || "")
    .replace(/\u3161/g, "") // 'ㅡ'
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\$\$/g, "")
    .replace(/```/g, "")
    .replace(/<{2,}|>{2,}/g, "")
    .trim();
}

function json(obj: any, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  });
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
