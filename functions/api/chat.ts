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
      "- Create a unique, consistent character for each session.",
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
      stream: false, // 중요: JSON 응답 강제
    };

    // 클라이언트에서 출력 지연 적용
    const delayMs = 5000 + Math.floor(Math.random() * 3000);

    const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.VENICE_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const errTxt = await safeText(r);
      return json({ error: "upstream_error", detail: errTxt || `status ${r.status}` }, 502, cors);
    }

    // content-type이 혹시 text/event-stream으로 오는 경우까지 방어
    const ct = r.headers.get("content-type") || "";
    let textOut = "";

    if (ct.includes("application/json")) {
      const data = await r.json<any>();
      textOut = sanitize(data?.choices?.[0]?.message?.content ?? "");
    } else {
      // SSE 등 비표준 케이스: 마지막 data: 라인 파싱
      const raw = await safeText(r);
      const last = (raw || "").trim().split("\n").reverse().find(l => l.startsWith("data:"));
      if (last) {
        try {
          const parsed = JSON.parse(last.replace(/^data:\s*/, ""));
          textOut = sanitize(parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? "");
        } catch {
          textOut = sanitize(raw || "");
        }
      } else {
        textOut = sanitize(raw || "");
      }
    }

    return json({ text: textOut.slice(0, 160), lang: LC, seed, delayMs }, 200, cors);
  } catch (e: any) {
    return json({ error: "bad_request", detail: String(e?.message || e) }, 400, cors);
  }
};

function sanitize(s: string) {
  return (s || "")
    .replace(/\u3161/g, "") // 'ㅡ'
    .replace(/\*\*\*/g, "") // ***
    .replace(/\*\*/g, "")   // **
    .replace(/\*/g, "")     // *
    .replace(/\$\$/g, "")   // $$
    .replace(/```/g, "")    // code fences
    .replace(/<{2,}|>{2,}/g, "") // << >>
    .trim();
}

async function safeText(r: Response) {
  try { return await r.text(); } catch { return ""; }
}

function json(obj: any, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  });
}
