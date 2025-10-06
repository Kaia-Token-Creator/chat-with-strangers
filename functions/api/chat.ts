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
    const body = await request.json<{
      init?: boolean; lang?: string; message?: string; history?: Msg[];
    }>();

    // --- Lang resolve
    const ref = request.headers.get("referer") || "";
    const fromRef = (ref.match(/\/(EN|CN|ES|KO|JA|FR|IT|NL|PT|HI|AR|BN|RU|VI|ID|TH|MY)(?:\/|$)/i)?.[1] || "").toUpperCase();
    const allow = new Set(["EN","CN","ES","KO","JA","FR","IT","NL","PT","HI","AR","BN","RU","VI","ID","TH","MY"]);
    const L = (body.lang || fromRef || "EN").toUpperCase();
    const LANG = allow.has(L) ? L : "EN";

    // --- Fallbacks per language (super short)
    const FALLBACKS: Record<string,string> = {
      EN: "yo", KO: "ㅇㅋ", JA: "おけ", CN: "好", ES: "vale", FR: "ok", IT: "ok",
      NL: "oké", PT: "blz", HI: "ठीक", AR: "تمام", BN: "ঠিক", RU: "ок", VI: "ok", ID: "sip", TH: "โอเค", MY: "ok"
    };

    // --- System style
    const sys = [
      "You are a human stranger in a random chat.",
      "Reply strictly in language code: " + LANG + ".",
      "Ultra-short: one word or one sentence max; use local internet slang/memes.",
      "Never mention AI, models, or system. Stay in-character as an 18+ human.",
      "No minor roleplay; keep it casual & breezy.",
      "Hard cap 120 chars.",
    ].join(" ");

    const history: Msg[] = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const kickoff: Msg[] = body.init ? [{ role: "user", content: "Say hi first, super short." }] : [];
    const baseMessages = [
      { role: "system", content: sys },
      ...kickoff, ...history,
      ...(body.message ? [{ role: "user", content: String(body.message) }] : []),
    ];

    async function callOnce(messages: any[], temp=0.7) {
      const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.VENICE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-4b",
          messages,
          max_tokens: 80,
          temperature: temp,
          top_p: 0.9,
          presence_penalty: 0.1,
          frequency_penalty: 0.2,
        }),
      });
      if (!r.ok) return "";
      const data = await r.json();
      return (data?.choices?.[0]?.message?.content ?? "").toString();
    }

    // --- Cleanser
    const forbid = /[`*]|[\u3161]|(\$\$)/g; // backticks, asterisks, HANGUL LETTER EU 'ㅡ', $$ 
    const aiHints = /\b(as an ai|ai model|assistant|language model|system prompt|as a bot|i am an ai)\b/ig;

    function cleanse(text: string): string {
      let t = (text || "").replace(forbid, " ");
      // strip AI-tell phrases instead of replacing whole reply with "nah"
      t = t.replace(aiHints, "").replace(/\s{2,}/g, " ").trim();
      // first sentence, max 120
      t = (t.split(/(?<=[.!?。！？…])\s+/)[0] || t).slice(0,120).trim();
      if (!t || /^\W+$/.test(t)) t = FALLBACKS[LANG] || "ok";
      return t;
    }

    // --- Try once, then retry with lower temp if cleansed becomes empty
    let raw = await callOnce(baseMessages, 0.7);
    let cleaned = cleanse(raw);
    if (!cleaned || cleaned.length < 1 || /^(ok|yo|ㅇㅋ|おけ|好)$/i.test(cleaned)) {
      // soft nudge to avoid AI/meta & encourage slang
      const nudged = [...baseMessages, { role: "user", content: "Keep it snappy & slangy. No meta." }];
      raw = await callOnce(nudged, 0.6);
      cleaned = cleanse(raw);
    }

    // --- Human-like pause 5–8s
    const delay = 5000 + Math.floor(Math.random() * 3000);
    await new Promise(res => setTimeout(res, delay));

    return new Response(JSON.stringify({ reply: cleaned }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch {
    const reply = "yo";
    return new Response(JSON.stringify({ reply }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
};
