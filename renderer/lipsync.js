// renderer/lipsync.js — Web Audio API を使ったリアルタイム口パク制御

let analyser  = null;
let dataArray = null;

/**
 * <audio>要素からAnalyserNodeをセットアップ
 * MediaElementAudioSourceNode を使うことでデコード不要・安定動作
 */
export function setupAnalyserFromElement(audioCtx, audioElement) {
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;

  const source = audioCtx.createMediaElementSource(audioElement);
  // audio要素 → analyser → destination
  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  dataArray = new Uint8Array(analyser.frequencyBinCount);
}

/**
 * 現在の音量を 0.0〜1.0 で返す
 * vrm.js のアニメーションループから毎フレーム呼ばれる
 */
export function getLipSyncValue() {
  if (!analyser || !dataArray) return 0;

  analyser.getByteFrequencyData(dataArray);

  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i] * dataArray[i];
  }
  const rms = Math.sqrt(sum / dataArray.length) / 255;

  return Math.min(1.0, rms * 3.5);
}

/** 再生終了時にリセット */
export function resetLipSync() {
  analyser  = null;
  dataArray = null;
}
