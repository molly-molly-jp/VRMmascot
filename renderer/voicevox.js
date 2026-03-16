// renderer/voicevox.js — VOICEVOX HTTP API クライアント

const VOICEVOX_URL = 'http://localhost:50021';
let speakerId = 1;

export function setSpeakerId(id) { speakerId = id; }

/**
 * テキストをVOICEVOXで音声合成して再生する
 * Phase2: <audio>要素で再生（シンプル・安定）
 * Phase3: AudioContextに切り替えてAnalyserNodeで口パク
 * @returns {Promise} 再生終了で resolve
 */
export async function speak(text) {
  // Step1: audio_query
  const queryRes = await fetch(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
    { method: 'POST' }
  );
  if (!queryRes.ok) throw new Error(`audio_query失敗: ${queryRes.status}`);
  const query = await queryRes.json();

  // Step2: synthesis → WAVバイナリ
  const synthRes = await fetch(
    `${VOICEVOX_URL}/synthesis?speaker=${speakerId}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) }
  );
  if (!synthRes.ok) throw new Error(`synthesis失敗: ${synthRes.status}`);
  const blob = await synthRes.blob();

  // Step3: <audio>要素で再生
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  return new Promise((resolve, reject) => {
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error('audio再生失敗')); };
    audio.play().catch(reject);
  });
}
