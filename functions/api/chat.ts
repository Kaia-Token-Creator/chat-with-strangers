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

    async function callOnce(msgs: any[], temp=0.7) {
      const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.VENICE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3-4b",
          messages: msgs,
          max_tokens: 80,
          temperature: temp,
          top_p: 0.9,
          presence_penalty: 0.1,
          frequency_penalty: 0.2,
          // 핵심 옵션: 생각 출력 제거 + 베니스 기본 시스템프롬프트 제거(원하면)
          venice_parameters: {
            strip_thinking_response: true,
            include_venice_system_prompt: false
          }
        }),
      });
      if (!r.ok) return "";
      const data = await r.json();
      return (data?.choices?.[0]?.message?.content ?? "").toString();
    }

    function cleanse(text: string): string {
      let t = (text || "");
      // 1) 남아있을 수 있는 <think> 블록 통째 제거
      t = t.replace(/<think>[\s\S]*?(<\/think>|$)/gi, " ").trim();
      // 2) 금지문자 최소 정리
      t = t.replace(/[`*]|(\$\$)|[\u3161]/g, " ").replace(/\s{2,}/g, " ").trim(); // ㅡ(U+3161) 포함
      // 3) 문장 1개만, 120자 제한
      t = (t.split(/(?<=[.!?。！？…])\s+/)[0] || t).slice(0,120).trim();
      // 4) 비었으면 언어별 짧은 대체문구
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

    // 5~8초 지연
    const delay = 5000 + Math.floor(Math.random() * 3000);
    await new Promise(res => setTimeout(res, delay));

    return new Response(JSON.stringify({ reply }), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
  } catch {
    return new Response(JSON.stringify({ reply: "yo" }), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
  }
};
