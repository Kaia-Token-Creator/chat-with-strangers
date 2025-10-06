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

    // --- 시스템 프롬프트
    const sys = [
      "You are a human stranger in a random chat.",
      "Reply strictly in language code: " + LANG + ".",
      "Ultra-short: one word or one sentence max; use local internet slang/memes.",
      "Never reveal AI/meta or inner thoughts. Do NOT narrate what the user said.",
      "18+ only; no minor roleplay. Max 120 chars. If unsure, ask a 2–5 word question.",
      "Output only the final reply text.",
    ].join(" ");

    const history: Msg[] = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const kickoff: Msg[] = body.init ? [{ role: "user", content: "Say hi first, super short." }] : [];
    const messages = [
      { role: "system", content: sys },
      ...kickoff,
      ...history,
      ...(body.message ? [{ role: "user", content: String(body.message) }] : []),
    ];

    // --- Venice 호출(옵션화 + 10s 타임아웃)
    async function callVenice(msgs: any[], opts: { temp:number; stripThink:boolean }) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);
      try {
        const r = await fetch("https://api.venice.ai/api/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: { "Authorization": `Bearer ${env.VENICE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "qwen3-4b",
            messages: msgs,
            max_tokens: 80,
            temperature: opts.temp,
            top_p: 0.95,
            presence_penalty: 0.1,
            frequency_penalty: 0.2,
            venice_parameters: {
              strip_thinking_response: opts.stripThink,      // 1차: false, 2차: true
              include_venice_system_prompt: false
            }
          }),
        });
        if (!r.ok) return "";
        const data = await r.json();
        return (data?.choices?.[0]?.message?.content ?? "").toString();
      } catch { return ""; }
      finally { clearTimeout(t); }
    }

    // --- 클린징
    function cleanse(text: string): string {
      let t = (text || "");
      // 생각 블록 제거
      t = t.replace(/<think>[\s\S]*?(<\/think>|$)/gi, " ");
      // 금지문자
      t = t.replace(/[`*]|(\$\$)|[\u3161]/g, " ").replace(/\s{2,}/g, " ").trim();
      // 1문장/120자
      t = (t.split(/(?<=[.!?。！？…])\s+/)[0] || t).slice(0,120).trim();
      return t;
    }

    // --- 언어별 스마트 대체문구(유저 메시지 참고, 반복 방지)
    function smartFallback(userMsg: string, lang: string): string {
      const m = (userMsg || "").toLowerCase();
      const q = /[?？]$/.test(m) || /who|what|when|where|why|how|wtf|wyd|wdy|누구|뭐|언제|어디|왜|어케|ㅁ|ㄴ|ㄷ/i.test(m);
      const bank: Record<string, string[]> = {
        EN: q ? ["wdym?", "fr?", "say less?", "spill?", "hold up?"] : ["chill.", "same tbh", "lowkey bored", "vibe check?"],
        KO: q ? ["뭔뜻?", "ㄹㅇ?", "왜?", "머라구?", "그래서?"] : ["ㅇㅋ", "그냥 그럼", "심심;","낄낄"],
        JA: q ? ["どゆ意?", "マ?", "で?", "何それ?"] : ["おけ", "草", "まあね", "了解"],
        CN: q ? ["啥意思?", "真吗?", "然后呢?", "咋了?"] : ["好", "行", "emm", "懂了"],
        ES: q ? ["qué dices?", "neta?", "y luego?", "cómo?"] : ["vale", "okas", "jajá", "todo bien"],
        FR: q ? ["hein?", "sérieux?", "pourquoi?", "comment?"] : ["ok", "tranquille", "bof", "grave"],
        IT: q ? ["che intendi?", "davvero?", "perché?", "come?"] : ["ok", "boh", "tranqui", "ci sta"],
        NL: q ? ["wat bedoel je?", "echt?", "waarom?", "hoe dan?"] : ["oké", "tja", "chill", "same"],
        PT: q ? ["como assim?", "sério?", "por quê?", "cadê?"] : ["blz", "suave", "de boa", "ok"],
        HI: q ? ["kya?", "kyu?", "kaise?", "kab?"] : ["ठीक", "theek h", "haan", "sahi"],
        AR: q ? ["شو قصدك؟", "جد؟", "ليه؟", "كيف؟"] : ["تمام", "ماشي", "اوكي", "عال"],
        BN: q ? ["মানে?", "সত্যি?", "কেন?", "কিভাবে?"] : ["ঠিক", "আচ্ছা", "ওকে", "হুম"],
        RU: q ? ["чё?", "серьёзно?", "зачем?", "как?"] : ["ок", "угу", "норм", "лол"],
        VI: q ? ["sao cơ?", "thật à?", "rồi sao?", "như nào?"] : ["ok", "ờ", "hmmm", "đc r"],
        ID: q ? ["maksud?", "serius?", "kenapa?", "gmn?"] : ["sip", "okeh", "wkwk", "santai"],
        TH: q ? ["ไรวะ?", "จริงดิ?", "ทำไม?", "ไง?"] : ["โอเค", "ชิล", "555", "ได้ๆ"],
        MY: q ? ["apa?", "betul?", "kenapa?", "macam mana?"] : ["ok", "chill", "lol", "same"],
      };
      const arr = bank[lang] || bank.EN;
      // 간단한 해시로 다양화
      let idx = 0; for (let i=0;i<m.length;i++) idx = (idx + m.charCodeAt(i)) % arr.length;
      return arr[idx];
    }

    const lastAssistant = [...history].reverse().find(v => v.role === "assistant")?.content || "";

    // 1차: stripThink=false
    let raw = await callVenice(messages, { temp: 0.8, stripThink: false });
    let reply = cleanse(raw);

    // 너무 짧거나 이전과 동일/단답이면 2차 시도
    const tooShort = !reply || /^(yo|ok|ㅇㅋ|おけ|好|vale|oké|blz|ठीक|تمام|ঠিক|ок|ok|sip|โอเค)$/i.test(reply);
    const sameAsBefore = lastAssistant && reply && reply.toLowerCase() === lastAssistant.toLowerCase();

    if (tooShort || sameAsBefore) {
      const nudged = [...messages, { role: "user", content: "Be snappy & slangy. No meta. No narration." }];
      raw = await callVenice(nudged, { temp: 0.9, stripThink: true });
      const cleaned = cleanse(raw);
      if (cleaned && !/^(yo|ok|ㅇㅋ|おけ|好|vale|oké|blz|ठीक|تمام|ঠিক|ок|sip|โอเค)$/i.test(cleaned) && cleaned.toLowerCase() !== lastAssistant.toLowerCase()) {
        reply = cleaned;
      } else {
        // 최종 스마트 대체문구
        const lastUser = [...messages].reverse().find(v => v.role === "user")?.content || "";
        reply = smartFallback(lastUser, LANG);
      }
    }

    // 서버는 즉시 응답 (딜레이는 클라에서)
    const delayMs = 5000 + Math.floor(Math.random() * 3000);
    return new Response(JSON.stringify({ reply, delay_ms: delayMs }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Delay": String(delayMs), ...CORS },
    });
  } catch {
    return new Response(JSON.stringify({ reply: "yo", delay_ms: 0 }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
};
