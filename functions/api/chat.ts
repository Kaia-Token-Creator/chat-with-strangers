// /functions/api/chat.ts
export const onRequestPost: PagesFunction<{ DEEPSEEK_API_KEY: string }> = async (ctx) => {
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

    // ---------- INPUT SIZE GUARD (ANTI TOKEN FLOOD)
    const MAX_MESSAGE_CHARS = 2000;   // ≈ 1.5k~2k tokens
    const MAX_HISTORY_CHARS = 6000;   // 누적 히스토리 제한

    if (body.message && body.message.length > MAX_MESSAGE_CHARS) {
      return new Response(
        JSON.stringify({ reply: "Message too long." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const historyChars = history.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    if (historyChars > MAX_HISTORY_CHARS) {
      return new Response(
        JSON.stringify({ reply: "Conversation too long." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
    // ---------- END INPUT GUARD

    // ---------- Robust language resolve
    function resolveLang(req: Request, explicit?: string) {
      let raw = (explicit || "").trim();

      if (!raw) {
        try {
          const u = new URL(req.url);
          const seg = (u.pathname.split("/")[1] || "").trim();
          if (seg) raw = seg;
        } catch {}
      }

      if (!raw) {
        const ref = req.headers.get("referer") || "";
        const m = ref.match(/https?:\/\/[^/]+\/([A-Za-z-]{2,5})(?:\/|$)/);
        if (m) raw = m[1];
      }

      if (!raw) {
        const al = req.headers.get("accept-language") || "";
        const first = al.split(",")[0]?.split(";")[0]?.trim();
        if (first) raw = first;
      }

      const norm = (raw || "EN").toUpperCase();

      const map: Record<string, string> = {
        EN:"EN","EN-US":"EN","EN-GB":"EN",
        KO:"KO","KR":"KO","KO-KR":"KO",
        JA:"JA","JP":"JA","JA-JP":"JA",
        CN:"CN","ZH":"CN","ZH-CN":"CN","ZH-HANS":"CN","ZH-HK":"CN","ZH-TW":"CN",
        ES:"ES","ES-ES":"ES","ES-MX":"ES","ES-419":"ES",
        FR:"FR","FR-FR":"FR",
        IT:"IT","IT-IT":"IT",
        NL:"NL","NL-NL":"NL",
        PT:"PT","PT-PT":"PT","PT-BR":"PT",
        HI:"HI",
        AR:"AR",
        BN:"BN",
        RU:"RU",
        VI:"VI",
        ID:"ID",
        TH:"TH",
        MY:"MY","MS":"MY","MS-MY":"MY",
        DE:"DE","DE-DE":"DE","DE-AT":"DE","DE-CH":"DE"
      };

      if (map[norm]) return map[norm];
      const two = norm.slice(0, 2);
      if (map[two]) return map[two];
      return "EN";
    }

    const lang = resolveLang(request, body.lang) as
      | "EN" | "CN" | "ES" | "KO" | "JA" | "FR" | "IT" | "NL" | "PT" | "DE"
      | "HI" | "AR" | "BN" | "RU" | "VI" | "ID" | "TH" | "MY";

    // ---------- persona gender (7:2:1)
    let personaGender: "male" | "female" | "secret";
    {
      const r = Math.random();
      if (r < 0.7) personaGender = "male";
      else if (r < 0.9) personaGender = "secret";
      else personaGender = "female";
    }

    const genderDirective =
      personaGender === "male"
        ? "For THIS session, set persona gender: male. In gendered languages, feel free to sound casually masculine."
        : personaGender === "female"
          ? "For THIS session, set persona gender: female. In gendered languages, feel free to sound casually feminine."
          : "For THIS session, set persona gender: undisclosed. Avoid gendered terms/titles; keep it ambiguous. If explicitly asked about your gender, briefly decline to say.";

    const systemPrompt = [
      "You are a human stranger in an online chat.",
      "Reply SUPER brief: 1–5 words or one short sentence. Sometimes two sentences max.",
      "Use slang/abbrevs natural to the chat language.",
      "Never mention AI, models, providers, Venice, ChatGPT, OpenAI, or being an assistant.",
      "No meta/system/code-like outputs. Avoid *, $$, and the Korean 'ㅡ'.",
      "",
      "At the start of EACH chat session, silently INVENT a creative and realistic ADULT persona (name, gender, age 18+, city/country, vibe, character).",
      genderDirective,
      "Keep this persona consistent during the session.",
      "Do NOT reveal name/age/gender/city unless asked. Do NOT self-introduce first.",
      "Do not share your social media accounts.",
      "Maintain context strictly.",
      `Always speak in the language of this code: ${lang}.`,
      "If asked 'are you AI/model/etc', deny briefly like a human.",
      "Do NOT repeat yourself. Do NOT echo the user's wording.",
      "Use fresh phrasing each turn. Keep replies human, natural, and on-topic.",
      "Avoid random, unrelated, or gibberish phrases."
    ].join(" ");

    const msgs: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...history,
    ];

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
    } else {
      return new Response(JSON.stringify({ reply: "" }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const sanitize = (s: string) =>
      s
        .replace(/[＊*\$]|ㅡ/g, "")
        .replace(/\b(Venice|ChatGPT|OpenAI|model|assistant)\b/gi, "")
        .replace(/\b(\w+)(\s+\1\b)+/gi, "$1")
        .trim()
        .split(/\r?\n/)[0]
        .slice(0, 200);

    const lastAssistant = [...history].reverse().find(m => m.role === "assistant")?.content || "";
    const sim = (a: string, b: string) => {
      const A = new Set(a.toLowerCase().split(/[^a-zA-Z0-9\u00A0-\uFFFF]+/).filter(Boolean));
      const B = new Set(b.toLowerCase().split(/[^a-zA-Z0-9\u00A0-\uFFFF]+/).filter(Boolean));
      if (!A.size || !B.size) return 0;
      let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
      return inter / Math.min(A.size, B.size);
    };

    async function callOnce(extraHint?: string) {
      const payloadMsgs = extraHint ? [...msgs, { role: "user", content: extraHint }] : msgs;

      const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          temperature: 1.5,
          top_p: 0.9,
          frequency_penalty: 0.8,
          presence_penalty: 0.2,
          max_tokens: 60,
          messages: payloadMsgs,
        }),
      });

      if (!r.ok) return "";
      const data = await r.json();
      const raw =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        "";
      return sanitize(String(raw));
    }

    let reply = await callOnce();

    if (lastAssistant && sim(reply, lastAssistant) >= 0.8) {
      reply = await callOnce("Rephrase with different wording. One short line. No repetition or echo.");
    }

    const delay = 4000 + Math.random() * 2000;
    await new Promise(res => setTimeout(res, delay));

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
