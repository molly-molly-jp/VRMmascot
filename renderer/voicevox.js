// renderer/voicevox.js — VOICEVOX HTTP API クライアント
import { setupAnalyserFromElement, resetLipSync } from './lipsync.js';

const VOICEVOX_URL = 'http://localhost:50021';
let speakerId = 0; // 0: 四国めたん（あまあま）

/** 現在再生中のAudio要素（停止用） */
let currentAudio = null;

export function setSpeakerId(id) { speakerId = id; }

/**
 * 現在再生中の音声を即座に停止する
 * （グループ・モデル切り替え時に呼ぶ）
 */
export function stopCurrentSpeech() {
  if (currentAudio) {
    currentAudio.pause();
    try { currentAudio.src = ''; } catch (_) {}
    currentAudio = null;
    resetLipSync();
    console.log('[voicevox] 音声停止');
  }
}

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
  currentAudio = audio;

  if (audioCtx) {
    setupAnalyserFromElement(audioCtx, audio);
  }

  return new Promise((resolve, reject) => {
    audio.onended = () => {
      currentAudio = null;
      URL.revokeObjectURL(url);
      resetLipSync();
      resolve();
    };
    audio.onerror = () => {
      currentAudio = null;
      URL.revokeObjectURL(url);
      reject(new Error('audio再生失敗'));
    };
    audio.play().catch(reject);
  });
}
