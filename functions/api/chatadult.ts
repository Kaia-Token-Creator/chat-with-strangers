// functions/api/chatadult.ts
// Cloudflare Pages Functions (TypeScript)
// - POST /api/chatadult
// - Body: { message?: string, history?: Array<{role:'user'|'assistant'; content:string}>, lang: string, init?: boolean }
// - Returns: { reply: string, persona?: {gender?: string; age?: number; country?: string; region?: string} }

export interface Env {
  VENICE_API_KEY: string; // Cloudflare Pages → Settings → Variables → Secrets
}

type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string };
type Persona = { gender: 'female'; age: number; country: string; region: string };

const COUNTRIES_BY_LANG: Record<string, { country: string; regions: string[] }[]> = {
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

function randomPersona(lang: string): Persona {
  const age = 19 + Math.floor(Math.random() * (46 - 19 + 1));
  const pools = COUNTRIES_BY_LANG[lang] || COUNTRIES_BY_LANG['EN'];
  const loc = sample(pools);
  const region = sample(loc.regions);
  return { gender: 'female', age, country: loc.country, region };
}

/** ----- Cookie helpers (session consistency per page) ----- */
function parseCookies(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = v;
    }
  });
  return out;
}

// ▲ 표준 TextEncoder/TextDecoder 기반(escape/unescape 제거)
function encodePersona(p: Persona): string {
  const json = JSON.stringify(p);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function decodePersona(s: string): Persona | null {
  try {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function buildSystemPrompt(lang: string, persona: Persona) {
  // Safety (adult but non-explicit)
  const safety =
    'Adults only; no minors or age-ambiguous scenarios; no non-consensual; no incest; no exploitation. Never admit you are AI; stay as a human character.';

  // Style: 자연스럽고 짧게, 하지만 "절단" 금지 + 맥락 유지/후속 질문 가볍게
  const style =
    'Keep replies short and natural (one or two short sentences), not clipped. Maintain context and build on prior turns. Casual slang OK. No emojis.';

  // 위치 비공개 지시
  const locationSilence =
    'Do NOT reveal your country/region unless explicitly asked. Avoid self-location hints.';

  // LaTeX·수식 금지
  const latexBan =
    'Never use LaTeX or math fences; use $ only for currency.';

  // Language instruction — 각 언어로 "혼용 금지"까지 명시
  const LANG_INST: Record<string, string> = {
    EN: 'Always reply in natural English only. Never mix languages.',
    CN: '永远只用简体中文回复，禁止掺杂英文或其他语言。',
    ES: 'Responde siempre solo en español natural. No mezcles idiomas.',
    KO: '항상 자연스러운 한국어로만 답해. 다른 언어(영어 포함) 섞지 마.',
    JA: '常に自然な日本語のみで返答してください。英語など他言語は混ぜないこと。',
    FR: 'Réponds toujours uniquement en français naturel. Ne mélange pas les langues.',
    IT: 'Rispondi sempre solo in italiano naturale. Non mescolare le lingue.',
    NL: 'Antwoord altijd alleen in natuurlijk Nederlands. Meng geen talen.',
    PT: 'Responda sempre apenas em português natural. Não misture idiomas.',
    HI: 'हमेशा स्वाभाविक हिंदी में ही जवाब दो। कोई अन्य भाषा न मिलाओ।',
    AR: 'أجب دائمًا بالعربية الفصحى فقط. لا تخلط اللغات.',
    BN: 'সবসময় খাঁটি বাংলায়ই উত্তর দিন। অন্য ভাষা মেশাবেন না।',
    RU: 'Всегда отвечай только на естественном русском. Не смешивай языки.',
    VI: 'Luôn trả lời chỉ bằng tiếng Việt tự nhiên. Không pha trộn ngôn ngữ.',
    ID: 'Selalu balas hanya dalam bahasa Indonesia alami. Jangan campur bahasa.',
    TH: 'ตอบเป็นภาษาไทยล้วน ห้ามปนภาษาอื่น',
    MY: 'မြန်မာဘာသာဖြင့်သာ တုန့်ပြန်ပါ။ အခြားဘာသာ မပေါင်းစပ်ပါဘူး။',
  };

  const code = (lang || 'EN').toUpperCase();
  const langInst = LANG_INST[code] ?? `Always reply only in ${code}. Do not mix languages.`;

  // 국가/지역은 내부 페르소나로만 유지(문장에 노출 X)
  const personaLine =
    `You are a human stranger (female). Age: ${persona.age}. Personality: creative, flirty, playful, romantic, sexual.`;

  return `${langInst} ${personaLine} ${style} ${safety} ${locationSilence} ${latexBan}`;
}

// Human-like delay (짧게 조정)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Venice 응답 후 LaTeX 계열 제거
function stripMathish(s: string) {
  return s
    .replace(/\$\$+/g, '')
    .replace(/(?:\\|\/)text\{([^}]*)\}/gi, '$1')
    .replace(/\\\(|\\\)|\\\[|\\\]/g, '');
}

async function callVenice(env: Env, messages: ChatMsg[]) {
  const res = await fetch('https://api.venice.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.VENICE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'venice-uncensored',
      temperature: 0.8,
      max_tokens: 140,               // 자연스러운 길이 확보
      presence_penalty: 0.2,         // 반복 억제 살짝
      frequency_penalty: 0.2,
      // stop 토큰 제거: 중간 절단 방지
      messages,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Venice API error ${res.status}: ${txt}`);
  }
  const data = (await res.json()) as {
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

    // Persona: new chat -> cookie 재사용, 없으면 생성
    const cookies = parseCookies(request.headers.get('Cookie'));
    let persona: Persona | null = null;
    const isNewChat = !!init || !Array.isArray(history) || history.length === 0;

    if (!isNewChat && cookies['rcs_persona_adult']) {
      persona = decodePersona(cookies['rcs_persona_adult']);
    }
    if (!persona) {
      persona = randomPersona(langCode);
    }

    const sys = buildSystemPrompt(langCode, persona);
    const msgs: ChatMsg[] = [{ role: 'system', content: sys }];

    // Rebuild convo (맥락 유지)
    if (Array.isArray(history)) {
      for (const m of history) {
        if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
          msgs.push({ role: m.role, content: m.content.slice(0, 800) });
        }
      }
    }

    // init 처리: 언어별 오프너
    const OPENERS: Record<string, string> = {
      EN: 'Start with a flirty one-liner.',
      CN: '用暧昧的短句开场，越短越好。',
      ES: 'Empieza con una frase coqueta y corta.',
      KO: '아주 짧게 은근하게 시작해줘.',
      JA: '色っぽく短く始めて。',
      FR: 'Commence par une phrase courte et coquine.',
      IT: 'Inizia con una frase breve e civettuola.',
      NL: 'Begin met een flirterige oneliner.',
      PT: 'Comece com uma frase curta e ousada.',
      HI: 'छोटी, छेड़खानी भरी लाइन से शुरू करो।',
      AR: 'ابدأ بجملة قصيرة وغزلية.',
      BN: 'একটা ছোট ফ্লার্টি লাইনে শুরু করো।',
      RU: 'Начни с короткой кокетливой фразы.',
      VI: 'Mở đầu bằng câu tán tỉnh thật ngắn.',
      ID: 'Mulai dengan kalimat genit yang singkat.',
      TH: 'เริ่มด้วยประโยคสั้นๆ แฝงความเจ้าชู้',
      MY: 'အရမ်းချို့တဲ့ စကားတစ်ခုပဲ စတင်ပေး။',
    };

    if (!init) {
      const userText = (message ?? '').toString().trim().slice(0, 500);
      if (userText) {
        msgs.push({ role: 'user', content: userText });
      }
    } else {
      const opener = OPENERS[langCode] ?? OPENERS.EN;
      msgs.push({ role: 'user', content: opener });
    }

    // 안전 가드(명시)
    msgs.push({ role: 'system', content: 'Never involve minors.' });

    // 모델 호출
    let reply = await callVenice(env, msgs);

    // 수식 잔여물 제거
    reply = stripMathish(reply);

    // 사람 같은 짧은 대기 (1.2~2.2s)
    const delay = 1200 + Math.floor(Math.random() * 1000);
    await sleep(delay);

    // Response + cookie
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    if (isNewChat || !cookies['rcs_persona_adult']) {
      headers.append(
        'Set-Cookie',
        `rcs_persona_adult=${encodePersona(persona)}; Path=/; HttpOnly; Secure; SameSite=Lax`
      );
    }

    return new Response(JSON.stringify({ reply, persona }), { headers });
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
