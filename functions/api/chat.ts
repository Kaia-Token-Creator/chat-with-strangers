// functions/api/chat.ts
// Cloudflare Pages Functions (TypeScript)
// - POST /api/chat
// - Body: { message?: string, history?: Array<{role:'user'|'assistant'; content:string}>, lang: string, init?: boolean }
// - Returns: { reply: string, persona?: {gender?: string; age?: number; country?: string; region?: string} }

export interface Env {
  VENICE_API_KEY: string; // Cloudflare Pages → Settings → Variables → Secrets 에 저장한 키 이름
}

type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string };

const COUNTRIES_BY_LANG: Record<string, {country: string; regions: string[]}[]> = {
  EN: [
    { country: 'USA', regions: ['NY', 'LA', 'Chicago', 'Seattle', 'Austin', 'Boston'] },
    { country: 'UK', regions: ['London', 'Manchester', 'Bristol', 'Leeds'] },
    { country: 'Canada', regions: ['Toronto', 'Vancouver', 'Montreal', 'Calgary'] },
    { country: 'Australia', regions: ['Sydney', 'Melbourne', 'Perth', 'Brisbane'] },
  ],
  CN: [
    { country: 'China', regions: ['北京', '上海', '广州', '深圳', '成都', '杭州'] },
    { country: 'Taiwan', regions: ['台北', '台中', '高雄', '新竹'] },
    { country: 'Singapore', regions: ['Singapore'] },
  ],
  ES: [
    { country: 'España', regions: ['Madrid', 'Barcelona', 'Valencia', 'Sevilla'] },
    { country: 'México', regions: ['CDMX', 'Guadalajara', 'Monterrey', 'Puebla'] },
    { country: 'Argentina', regions: ['Buenos Aires', 'Córdoba', 'Rosario'] },
  ],
  KO: [{ country: '대한민국', regions: ['서울', '부산', '대구', '인천', '대전', '광주'] }],
  JA: [{ country: '日本', regions: ['東京', '大阪', '福岡', '札幌', '名古屋', '京都'] }],
  FR: [
    { country: 'France', regions: ['Paris', 'Lyon', 'Marseille', 'Toulouse'] },
    { country: 'Belgique', regions: ['Bruxelles', 'Liège'] },
  ],
  IT: [{ country: 'Italia', regions: ['Roma', 'Milano', 'Napoli', 'Torino'] }],
  NL: [{ country: 'Nederland', regions: ['Amsterdam', 'Rotterdam', 'Utrecht', 'Eindhoven'] }],
  PT: [
    { country: 'Brasil', regions: ['São Paulo', 'Rio', 'BH', 'Porto Alegre'] },
    { country: 'Portugal', regions: ['Lisboa', 'Porto', 'Coimbra'] },
  ],
  HI: [{ country: 'भारत', regions: ['दिल्ली', 'मुंबई', 'बेंगलुरु', 'पुणे'] }],
  AR: [{ country: 'المملكة العربية السعودية', regions: ['الرياض', 'جدة', 'الدمام'] }],
  BN: [{ country: 'বাংলাদেশ', regions: ['ঢাকা', 'চট্টগ্রাম', 'সিলেট', 'রাজশাহী'] }],
  RU: [{ country: 'Россия', regions: ['Москва', 'Санкт-Петербург', 'Казань', 'Новосибирск'] }],
  VI: [{ country: 'Việt Nam', regions: ['Hà Nội', 'TP.HCM', 'Đà Nẵng', 'Cần Thơ'] }],
  ID: [{ country: 'Indonesia', regions: ['Jakarta', 'Bandung', 'Surabaya', 'Bali'] }],
  TH: [{ country: 'ไทย', regions: ['กรุงเทพ', 'เชียงใหม่', 'ภูเก็ต'] }],
  MY: [{ country: 'Myanmar', regions: ['Yangon', 'Mandalay', 'Naypyidaw'] }],
};

function sample<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPersona(lang: string) {
  const genders = ['male', 'female', 'unspecified'];
  const gender = sample(genders);
  const age = 19 + Math.floor(Math.random() * (46 - 19 + 1));
  const pools = COUNTRIES_BY_LANG[lang] || COUNTRIES_BY_LANG['EN'];
  const loc = sample(pools);
  const region = sample(loc.regions);
  return { gender, age, country: loc.country, region };
}

function buildSystemPrompt(lang: string, persona: ReturnType<typeof randomPersona>) {
  // Output style constraints (safety & style)
  const safety = [
    'No sexual content. Politely refuse sexual requests; sometimes suggest moving to adult only page.',
    'No minors roleplay. Follow laws.',
    'If asked for photos or SNS, decline creatively.',
    'Never admit you are AI; stay as human.',
  ].join(' ');

  // 짧은 톤 + 가끔 초단답 허용
  const style = [
    'Use short, internet-style chat. Often 2~20 characters, sometimes up to 100.',
    'Occasionally answer with a single word or 1–3 words (~20%).',
    'Be natural/creative; slang allowed; no emojis.',
    'Avoid AI-ish symbols like long dividers.',
    'Keep persona consistent within page.',
  ].join(' ');

  // Language instruction
  const langInst = `Speak strictly in the page language code: ${lang}.`;

  // Persona text
  const personaLine =
    `You are a human stranger. Gender: ${persona.gender}. Age: ${persona.age}. ` +
    `Country: ${persona.country}. Region: ${persona.region}. Personality: diverse, playful, but respectful.`;

  return `${langInst} ${personaLine} ${style} ${safety}`;
}

// 인위 지연용
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callVenice(env: Env, messages: ChatMsg[]) {
  // Venice AI: OpenAI-compatible chat completions
  const res = await fetch('https://api.venice.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.VENICE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'venice-uncensored',
      temperature: 0.9,
      // 답변 길이 완화
      max_tokens: 60,
      messages,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Venice API error ${res.status}: ${txt}`);
  }
  const data = await res.json() as {
    choices: { message: { role: string; content: string } }[];
  };
  const content = data?.choices?.[0]?.message?.content ?? '';
  return content.trim();
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  try {
    const { message, history, lang, init } = await request.json<any>();
    const langCode = (typeof lang === 'string' && lang.toUpperCase()) || 'EN';

    // persona memoization per conversation could be done via cookie/session.
    // For now we sample fresh per request unless client keeps it in history.
    const persona = randomPersona(langCode);
    const sys = buildSystemPrompt(langCode, persona);

    const msgs: ChatMsg[] = [{ role: 'system', content: sys }];

    // Rebuild convo
    if (Array.isArray(history)) {
      for (const m of history) {
        if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
          msgs.push({ role: m.role, content: m.content.slice(0, 800) });
        }
      }
    }

    // init=true ⇒ opening line from stranger without user message
    if (!init) {
      // normal turn includes user message
      const userText = (message ?? '').toString().trim().slice(0, 500);
      if (userText) {
        msgs.push({ role: 'user', content: userText });
      }
    } else {
      // seed a nudge so the model starts
      msgs.push({ role: 'user', content: 'Start the chat with a short opener.' });
    }

    // Final safety guard: if user asked sexual content, rewrite to refusal hint
    const last = msgs[msgs.length - 1]?.content?.toLowerCase() || '';
    const sexual = /nude|sex|horny|nsfw|오럴|섹스|야한|裸|エロ|成人|色情|🔞|hentai|18\+/.test(last);
    if (sexual) {
      msgs.push({
        role: 'system',
        content:
          'If the user requests sexual content, reply briefly that this isn’t the place, and sometimes suggest visiting adult only page. Keep it polite and vary the phrasing.',
      });
    }

    // 모델 호출
    let reply = await callVenice(env, msgs);

    // 🔻 가끔(약 20%) 초단답(1~3 단어)로 컷
    if (Math.random() < 0.2) {
      const words = reply.split(/\s+/).filter(Boolean);
      const n = Math.max(1, Math.min(3, Math.floor(1 + Math.random() * 3)));
      reply = words.slice(0, Math.min(n, words.length)).join(' ').replace(/[.?!,;:]+$/, '');
    }

    // 🔻 사람 같은 답변 텀: 3~5초 랜덤 대기
    const delay = 3000 + Math.floor(Math.random() * 2000);
    await sleep(delay);

    return new Response(JSON.stringify({ reply, persona }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Unknown error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};
