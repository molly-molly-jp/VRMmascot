// renderer/ai.js — AI APIクライアント（OpenAI互換）
// LM Studio: http://localhost:1234/v1/chat/completions

const AI_URL   = 'http://localhost:1234/v1/chat/completions';
const AI_MODEL = 'local-model'; // LM Studioは起動中のモデルに自動ルーティング

// 会話履歴（Phase4はシンプルにシステムプロンプト+1ターンのみ）
const SYSTEM_PROMPT = 'あなたは親切なAIアシスタントです。日本語で簡潔に答えてください。';

/**
 * テキストをAIに送信して返答を取得する
 * @param {string} userText
 * @returns {Promise<string>} AIの返答テキスト
 */
export async function askAI(userText) {
  const res = await fetch(AI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      stream: false,   // 全文受信（要件定義書通り）
      messages: [
        { role: 'system',  content: SYSTEM_PROMPT },
        { role: 'user',    content: userText },
      ],
    }),
  });

  if (!res.ok) throw new Error(`AI API失敗: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('AIからの返答が空でした');

  console.log('[AI] 返答:', text);
  return text;
}
