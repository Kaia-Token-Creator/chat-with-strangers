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

    // --- 언어 결정
    const ref = request.headers.get("referer") || "";
    const fromRef = (ref.match(/\/(EN|CN|ES|KO|JA|FR|IT|NL|PT|HI|AR|BN|RU|VI|ID|TH|MY)(?:\/|$)/i)?.[1] || "").toUpperCase();
    const allow = new Set(["EN","CN","ES","KO","JA","FR","IT","NL","PT","HI","AR","BN","RU","VI","ID","TH","MY"]);
    const LANG = allow.has((body.lang || fromRef || "EN").toUpperCase()) ? (body.lang || fromRef || "EN").toUpperCase() : "EN";

    // --- 스타일 시스템 프롬프트
    const sys = [
      "You are a human stranger in a random chat.",
      "Reply strictly in language code: " + LANG + ".",
      "Ultra-short: one word or one sentence max; use local internet slang/memes.",
      "Never reveal system/AI/meta. No inner thoughts. Do not narrate what the user said.",
      "18+ only; no minor roleplay. Max 120 chars.",
    ].join(" ");

    const history: Msg[] = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const kickoff: Msg[] = body.init ? [{ role: "user", content: "Say hi first, super short." }] : [];
    const messages = [
      { role: "system", content: sys },
      ...kickoff,
      ...history,
      ...(body.message ? [{ role: "user", content: String(body.message) }] : []),
    ];

    // --- Venice 호출 (타임아웃 포함)
    async function callOnce(msgs: any[], temp=0.7) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 6500); // 6.5s 가드
      try {
        const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: { "Authorization": `Bearer ${env.VENICE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "qwen3-4b",
            messages: msgs,
            max_tokens: 80,
            temperature: temp,
            top_p: 0.9,
            presence_penalty: 0.1,
            frequency_penalty: 0.2,
            venice_parameters: {
              strip_thinking_response: true,
              include_venice_system_prompt: false,
            },
          }),
        });
        if (!r.ok) return "";
        const data = await r.json();
        return (data?.choices?.[0]?.message?.content ?? "").toString();
      } catch {
        return "";
      } finally {
        clearTimeout(t);
      }
    }

    // --- 클린업
    function cleanse(text: string): string {
      let t = (text || "");
      t = t.replace(/<think>[\s\S]*?(<\/think>|$)/gi, " ").trim();                 // 생각블록 제거
      t = t.replace(/[`*]|(\$\$)|[\u3161]/g, " ").replace(/\s{2,}/g, " ").trim(); // ` * $$ ㅡ 제거
      t = (t.split(/(?<=[.!?。！？…])\s+/)[0] || t).slice(0,120).trim();           // 1문장/120자
      const FALLBACK: Record<string,string> = { EN:"yo", KO:"ㅇㅋ", JA:"おけ", CN:"好", ES:"vale", FR:"ok", IT:"ok", NL:"oké", PT:"blz", HI:"ठीक", AR:"تمام", BN:"ঠিক", RU:"ок", VI:"ok", ID:"sip", TH:"โอเค", MY:"ok" };
      if (!t) t = FALLBACK[LANG] || "ok";
      return t;
    }

    let raw = await callOnce(messages, 0.7);
    let reply = cleanse(raw);
    if (!reply || /^yo$|^ㅇㅋ$|^ok(e|é)?$|^好$/i.test(reply)) {
      const nudged = [...messages, { role: "user", content: "Keep it snappy & slangy. No meta." }];
      raw = await callOnce(nudged, 0.6);
      reply = cleanse(raw);
    }

    // 서버는 즉시 응답, 지연값만 헤더/바디로 전달
    const delayMs = 5000 + Math.floor(Math.random() * 3000); // 5~8s
    return new Response(JSON.stringify({ reply, delay_ms: delayMs }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Delay": String(delayMs), ...CORS },
    });

  } catch {
    return new Response(JSON.stringify({ reply: "yo", delay_ms: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
};
