// renderer/index.js  — エントリーポイント
import { initVRM } from './vrm.js';

const statusEl = document.getElementById('status');

async function main() {
  try {
    await initVRM('vrm-canvas');
    statusEl.textContent = '';
  } catch (err) {
    console.error('VRM初期化失敗:', err);
    statusEl.textContent = `エラー: ${err.message}`;
  }
}

main();
