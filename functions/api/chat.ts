// /functions/api/chat.ts
export const onRequestPost: PagesFunction<{ VENICE_API_KEY: string }> = async (ctx) => {
  const { request, env } = ctx;

  // --- CORS
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    type Msg = { role: "user" | "assistant"; content: string };
    const body = await request.json<{
      init?: boolean;
      lang?: string;              // "EN" | "KO" ...
      message?: string;
      history?: Msg[];
    }>();

    // --- Lang resolve (body.lang 우선, 없으면 referrer 경로에서 추출)
    const ref = request.headers.get("referer") || "";
    const fromRef = (ref.match(/\/(EN|CN|ES|KO|JA|FR|IT|NL|PT|HI|AR|BN|RU|VI|ID|TH|MY)(?:\/|$)/i)?.[1] || "").toUpperCase();
    const allow = new Set(["EN","CN","ES","KO","JA","FR","IT","NL","PT","HI","AR","BN","RU","VI","ID","TH","MY"]);
    const lang = (body.lang || fromRef || "EN").toUpperCase();
    const L = allow.has(lang) ? lang : "EN";

    // --- Ultra-short style guide (system prompt)
    const sys = [
      "You are a human stranger in a random chat.",
      "Reply in the exact language of code: " + L + ".",
      "Style: VERY short (one word or one sentence max). Use internet slang/memes of that language.",
      "No AI vibes. Never admit being AI. No system/meta talk.",
      "Never output characters: 'ㅡ', '*', '$$', backticks, or error-like markers.",
      "Keep context consistent; invent a fun adult (18+) persona for this chat and stay in character.",
      "No minor roleplay. No illegal stuff.",
      "If user greets, greet back briefly. Keep it breezy.",
      "Hard cap length: <= 120 chars. Trim extra sentences.",
    ].join(" ");

    // --- Build messages
    const history: Msg[] = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const userKickOff: Msg[] = body.init ? [{ role: "user", content: "Start the convo. Say hi first, super short." }] : [];
    const messages = [
      { role: "system", content: sys },
      ...userKickOff,
      ...history,
      ...(body.message ? [{ role: "user", content: String(body.message) }] : []),
    ];

    // --- Call Venice AI (model: qwen3-4b)
    const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.VENICE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3-4b",
        messages,
        max_tokens: 80,
        temperature: 0.8,
        top_p: 0.9,
        presence_penalty: 0.1,
        frequency_penalty: 0.2,
      }),
    });

    // --- Fallback text if API hiccups
    let text = "";
    if (r.ok) {
      const data = await r.json();
      text = (data?.choices?.[0]?.message?.content ?? "").toString();
    }
    if (!text) text = L === "KO" ? "다시 ㄱ?" : "retry?";

    // --- Sanitize: forbid certain chars & AI tells; keep super short
    const forbid = /[`*]|[\u3137\u3139\u3141\u318D]|(\$\$)/g; // includes Korean "ㅡ" via block catch
    text = text.replace(forbid, " ");
    const aiHints = /\b(ai|language model|assistant|system prompt|as an ai)\b/i;
    if (aiHints.test(text)) text = L === "KO" ? "노코멘트" : "nah";

    // one sentence max, 120 chars max
    const firstSentence = text.split(/(?<=[.!?。！？…])\s+/)[0] || text;
    text = firstSentence.slice(0, 120).trim();

    // --- Add human-like pause 5–8s
    const delay = 5000 + Math.floor(Math.random() * 3000);
    await new Promise((res) => setTimeout(res, delay));

    return new Response(JSON.stringify({ reply: text }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (e) {
    // 절대 에러 원문 노출 금지
    const msg = "ping?";
    return new Response(JSON.stringify({ reply: msg }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
};
