// /functions/api/chat.ts

// 환경 변수 및 요청/응답 타입 정의
interface Env {
  VENICE_API_KEY: string;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  init?: boolean;
  history: Message[];
  lang: string;
}

// 지원 언어 맵
const langMap: { [key: string]: string } = {
  EN: 'English', CN: 'Chinese', ES: 'Spanish', KO: 'Korean', JA: 'Japanese',
  FR: 'French', IT: 'Italian', NL: 'Dutch', PT: 'Portuguese', HI: 'Hindi',
  AR: 'Arabic', BN: 'Bengali', RU: 'Russian', VI: 'Vietnamese',
  ID: 'Indonesian', TH: 'Thai', MY: 'Malay'
};

// 딜레이 함수
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// Cloudflare Pages 라우트 핸들러
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { init, history, lang } = await request.json<ChatRequestBody>();
    const language = langMap[lang.toUpperCase()] || 'English';

    // 시스템 프롬프트: AI의 정체성과 규칙 설정 (페르소나 부분 삭제됨)
    const systemPrompt = `You are a human chatting online. You are an adult.
    ABSOLUTELY follow these rules:
    1. Reply in EXTREMELY SHORT sentences. Often just one word.
    2. Use tons of modern internet slang, abbreviations, and memes.
    3. NEVER use formatting like *, -, or $. Just plain text.
    4. NEVER say you are an AI. You are a real person.
    5. Remember the chat history to stay consistent.
    6. Your replies MUST be in ${language} ONLY.`;

    const messages: Message[] = [{ role: 'system', content: systemPrompt }];

    // AI가 대화를 시작할 경우
    if (init) {
        messages.push({ role: 'user', content: "Start the conversation with a short, casual greeting." });
    } else {
        messages.push(...history);
    }

    // Venice AI API 호출
    const apiResponse = await fetch('https://api.venice.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.VENICE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen3-4b',
        messages: messages,
        max_tokens: 50,
        temperature: 0.9,
      }),
    });

    if (!apiResponse.ok) {
        throw new Error(`API call failed: ${apiResponse.status}`);
    }

    const data = await apiResponse.json();
    const reply = data.choices[0]?.message?.content?.trim() || '...';

    // 5~8초 랜덤 딜레이
    const randomDelay = Math.floor(Math.random() * 3001) + 5000;
    await delay(randomDelay);

    // 프론트엔드로 응답 전송
    return new Response(JSON.stringify({ reply }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Chat API Error:', error);
    return new Response(JSON.stringify({ reply: '아, 렉 걸린 듯. 다시 ㄱㄱ' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
