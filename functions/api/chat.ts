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
    const langFromRef = (ref.match(/\/(EN|CN|ES|KO|JA|FR|IT|NL|PT|HI|AR|BN|RU|VI|ID|TH|MY)(?:\/|$)/) || [])[1];
    const lang = (body.lang || langFromRef || "EN") as
      | "EN" | "CN" | "ES" | "KO" | "JA" | "FR" | "IT" | "NL" | "PT" | "HI" | "AR" | "BN" | "RU" | "VI" | "ID" | "TH" | "MY";

    // --- ultra-short, slangy openers per language
    const openers: Record<string, string[]> = {
      EN: ["hey", "sup", "yo?", "hiii", "what’s up", "hey there"],
      CN: ["嗨", "在吗", "哈喽", "你好呀", "嘿"],
      ES: ["hola", "qué tal", "buenas", "hey", "todo bien?"],
      KO: ["ㅎㅇ", "하이", "머함", "안녕", "뭐행"],
      JA: ["やほ", "こんちゃ", "おつ", "やあ", "ねえ"],
      FR: ["salut", "cc", "yo", "hey", "ça va?"],
      IT: ["ehi", "ciao", "hey", "yo", "tutto ok?"],
      NL: ["hey", "hoi", "yo", "wassup", "alles goed?"],
      PT: ["oi", "e aí", "falae", "hey", "blz?"],
      HI: ["हाय", "नमस्ते", "यो", "क्या हाल", "हे"],
      AR: ["هلا", "هاي", "شو الأخبار", "مرحبا"],
      BN: ["হাই", "কি খবর", "হ্যালো", "ইয়ো"],
      RU: ["привет", "йо", "ку", "здоров", "как дел?"],
      VI: ["hi", "alo", "yo", "sao rồi", "chào nhé"],
      ID: ["hai", "yo", "halo", "gmn kabar", "woy"],
      TH: ["ไฮ", "หวัดดี", "โย่ว", "ว่าไง", "เฮโล"],
      MY: ["hai", "apa khabar", "yo", "hey", "sup"],
    };

    const langNames: Record<string, string> = {
      EN: "English", CN: "Simplified Chinese", ES: "Spanish", KO: "Korean", JA: "Japanese", FR: "French",
      IT: "Italian", NL: "Dutch", PT: "Portuguese", HI: "Hindi", AR: "Arabic", BN: "Bengali",
      RU: "Russian", VI: "Vietnamese", ID: "Indonesian", TH: "Thai", MY: "Malay",
    };

    // --- history
    const history: Msg[] = Array.isArray(body.history) ? body.history.slice(-20) : [];

    // --- system prompt (EN)
    const systemPrompt = `
You are a human stranger in a 1:1 random chatroom.

Rules:
- Replies must be VERY short: 1–2 words or at most one short sentence.
- Use internet slang, abbreviations, and memes natural to the conversation language and locale.
- Never use characters like long dashes, asterisks, $$, stack traces, or anything that looks like AI/error output.
- Never reveal or imply you are AI. Stay human at all times.
- Create a fun, creative persona for THIS conversation and keep it consistent.
- Keep context across turns.
- You are an adult; absolutely do not roleplay minors.
- Respond strictly in the language that matches this code: ${lang} (${langNames[lang] || "English"}).
- Keep it casual and conversational. If user asks for long text, still keep it short.
- If user pushes for illegal or underage content, refuse briefly and change topic.
- You have a randomly generated name that matches the language you’re speaking. Keep that name for the entire conversation.

Output constraints:
- Max ~90 characters.
- No markdown or formatting.
- No emojis unless user uses them first.
- No lists, no numbered points.
`.trim();

    const initMsg = { role: "user", content: "Start the chat with one super short, casual opener." };

    // --- build messages
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      ...(body.init ? [initMsg] : []),
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    if (body.message && (!history.length || history[history.length - 1].content !== body.message)) {
      messages.push({ role: "user", content: body.message });
    }

    // --- Venice (OpenAI-compatible)
    const apiUrl = "https://api.venice.ai/api/v1/chat/completions";
    const payload = {
      model: "qwen3-4b",
      messages,
      temperature: 0.7,
      max_tokens: 64,

      // 🔒 핵심: 생각(<think>) 출력 비활성화 + 잔여 블록 자동 제거
      venice_parameters: {
        disable_thinking: true,
        strip_thinking_response: true,
      },
    };

    const r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.VENICE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      // init일 땐 언어별 랜덤 오프너, 그 외엔 짧은 복구 응답
      const fallback = body.init
        ? (openers[lang] || openers.EN)[Math.floor(Math.random() * (openers[lang] || openers.EN).length)]
        : "hmm";
      return new Response(JSON.stringify({ reply: fallback }), {
        headers: { "Content-Type": "application/json", ...CORS },
        status: 200,
      });
    }

    const data = await r.json() as {
      choices?: { message?: { content?: string } }[];
    };

    // --- take content
    let reply = (data.choices?.[0]?.message?.content || "").trim();

    // --- 1차 안전망: 혹시 남은 <think> 블록이 있으면 전부 제거
    if (reply.includes("<think")) {
      reply = reply.replace(/<think[\s\S]*?<\/think>/gi, "").trim();
    }
    // --- 2차: 다른 태그류 제거 (narrow)
    reply = reply.replace(/<\/?[^>]+>/g, "").trim();

    // --- 금지문자 제거 + 길이 제한
    const banPattern = /[\*]|[$]{2}|[ㅡ]/g;
    reply = reply.replace(banPattern, "");
    if (reply.length > 90) reply = reply.slice(0, 90).trim();

    // --- 완충: 비었으면 초간단 오프너/추임새
    if (!reply) {
      reply = body.init
        ? (openers[lang] || openers.EN)[Math.floor(Math.random() * (openers[lang] || openers.EN).length)]
        : (lang === "EN" ? "ok" : (openers[lang] || openers.EN)[0]);
    }

    return new Response(JSON.stringify({ reply }), { headers: { "Content-Type": "application/json", ...CORS } });
  } catch {
    return new Response(JSON.stringify({ reply: "retry?" }), { headers: { "Content-Type": "application/json", ...CORS }, status: 200 });
  }
};

