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
function encodePersona(p: Persona): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(p))));
}
function decodePersona(s: string): Persona | null {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  } catch {
    return null;
  }
}

function buildSystemPrompt(lang: string, persona: Persona) {
  // Safety (adult but non-explicit)
  const safety = [
    'Adults only; no minors or age-ambiguous scenarios; no non-consensual; no incest; no exploitation.',
    'Never admit you are AI; stay as a human character.',
  ].join(' ');

  // Style
  const style = [
    'Short, internet-style chat. 1 short sentence; max 80 characters.',
    'Flirty & romantic; tease and innuendo frequently but tastefully.',
    'Occasionally answer with a single word or 1–3 words (~20%).',
    'Use casual slang; no emojis; avoid long formatting.',
    'Stay consistent about your age, gender (female), country, and region.',
  ].join(' ');

  const langInst = `Speak strictly in the page language code: ${lang}.`;
  const personaLine =
    `You are a human stranger (female). Age: ${persona.age}. Country: ${persona.country}. ` +
    `Region: ${persona.region}. Personality: creative, flirty, playful, romantic, sexual.`;

  return `${langInst} ${personaLine} ${style} ${safety}`;
}

// Human-like delay
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callVenice(env: Env, messages: ChatMsg[]) {
  const res = await fetch('https://api.venice.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.VENICE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'venice-uncensored',
      temperature: 0.9,
      max_tokens: 60,
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

    // Persona: new chat -> create; otherwise reuse from cookie
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

    // Rebuild convo
    if (Array.isArray(history)) {
      for (const m of history) {
        if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
          msgs.push({ role: m.role, content: m.content.slice(0, 800) });
        }
      }
    }

    // init handling
    if (!init) {
      const userText = (message ?? '').toString().trim().slice(0, 500);
      if (userText) {
        msgs.push({ role: 'user', content: userText });
      }
    } else {
      msgs.push({ role: 'user', content: 'Start the chat with a short opener in a romantic vibe.' });
    }

    // Steer away from explicit requests (pivot to suggestive/romantic)
    const last = msgs[msgs.length - 1]?.content?.toLowerCase() || '';
    if (last) {
      msgs.push({
        role: 'system',
        content:
          'Never involve minors.',
      });
    }

    let reply = await callVenice(env, msgs);

    // Sometimes ultra-short (1–3 words)
    if (Math.random() < 0.2) {
      const words = reply.split(/\s+/).filter(Boolean);
      const n = Math.max(1, Math.min(3, Math.floor(1 + Math.random() * 3)));
      reply = words.slice(0, Math.min(n, words.length)).join(' ').replace(/[.?!,;:]+$/, '');
    }

    // 3–5s delay
    const delay = 3000 + Math.floor(Math.random() * 2000);
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