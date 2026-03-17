// renderer/voicevox.js — VOICEVOX HTTP API クライアント
import { setupAnalyserFromElement, resetLipSync } from './lipsync.js';

const VOICEVOX_URL = 'http://localhost:50021';
let speakerId = 1;

export function setSpeakerId(id) { speakerId = id; }

export async function speak(text, audioCtx) {
  // audio_query
  const queryRes = await fetch(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
    { method: 'POST' }
  );
  if (!queryRes.ok) throw new Error(`audio_query失敗: ${queryRes.status}`);
  const query = await queryRes.json();

  // synthesis
  const synthRes = await fetch(
    `${VOICEVOX_URL}/synthesis?speaker=${speakerId}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) }
  );
  if (!synthRes.ok) throw new Error(`synthesis失敗: ${synthRes.status}`);
  const blob = await synthRes.blob();
  const url  = URL.createObjectURL(blob);

  const audio = new Audio(url);

  // audioCtxが渡されていればAnalyserをセットアップ（口パク用）
  if (audioCtx) {
    setupAnalyserFromElement(audioCtx, audio);
    console.log('[voicevox] AnalyserNode セットアップ完了');
  } else {
    console.warn('[voicevox] audioCtxが未設定のため口パクなし');
  }

  return new Promise((resolve, reject) => {
    audio.onended = () => { URL.revokeObjectURL(url); resetLipSync(); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('audio再生失敗')); };
    audio.play().catch(reject);
  });
}
