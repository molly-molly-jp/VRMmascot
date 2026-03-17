// renderer/control.js — コントロールパネル専用ロジック

const api       = window.electronAPI;
const groupBar  = document.getElementById('group-bar');
const modelBar  = document.getElementById('model-bar');
const textInput = document.getElementById('text-input');
const sendBtn   = document.getElementById('send-btn');
const clearBtn  = document.getElementById('clear-btn');
const pinBtn    = document.getElementById('pin-btn');
const statusEl  = document.getElementById('status-area');

let configData      = null;
let currentGroupIdx = 0;
let alwaysOnTop     = false; // 起動時はOFF（main.jsのctrlWin初期値に合わせる）

// ─── ステータス表示 ──────────────────────────────────────────
function setStatus(text) {
  statusEl.textContent = text || '待機中';
  statusEl.className   = '';
  if (!text || text === '待機中') return;
  statusEl.className = text.startsWith('エラー') ? 'error' : 'busy';
}
api.onStatusUpdate((text) => setStatus(text));

// ─── 最前面トグル（コントロールウィンドウ自身） ──────────────
function updatePinBtn() {
  if (alwaysOnTop) {
    pinBtn.textContent = '📌 最前面 ON';
    pinBtn.classList.add('on');
  } else {
    pinBtn.textContent = '📌 最前面 OFF';
    pinBtn.classList.remove('on');
  }
}

pinBtn.addEventListener('click', async () => {
  alwaysOnTop = await api.toggleAlwaysOnTop();
  updatePinBtn();
});

// 初期表示をOFFに揃える
updatePinBtn();

// ─── グループボタン描画 ──────────────────────────────────────
function renderGroupButtons() {
  groupBar.innerHTML = '';
  configData.groups.forEach((g, i) => {
    const btn = document.createElement('button');
    btn.className   = 'btn' + (i === currentGroupIdx ? ' active' : '');
    btn.textContent = `${g.id}: ${g.label}`;
    btn.title       = `口パク入力: ${g.lipSyncSource}`;
    btn.addEventListener('click', () => {
      if (i === currentGroupIdx) return;
      currentGroupIdx = i;
      configData.groups[i].currentModel = 0;
      renderGroupButtons();
      renderModelButtons();
      api.switchGroup(g.id);
    });
    groupBar.appendChild(btn);
  });
}

// ─── モデルボタン描画 ────────────────────────────────────────
function renderModelButtons() {
  modelBar.innerHTML = '';
  const group = configData.groups[currentGroupIdx];
  group.models.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.className   = 'btn' + (i === group.currentModel ? ' active-model' : '');
    btn.textContent = m.label;
    btn.addEventListener('click', () => {
      if (i === group.currentModel) return;
      group.currentModel = i;
      renderModelButtons();
      api.switchModel(m.path);
    });
    modelBar.appendChild(btn);
  });
}

// ─── テキスト送信 ────────────────────────────────────────────
function sendText() {
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value        = '';
  textInput.style.height = '';
  api.sendTextToVRM(text);
  setStatus('送信しました');
}

sendBtn.addEventListener('click', sendText);
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey && !e.isComposing) {
    e.preventDefault();
    sendText();
  }
});
textInput.addEventListener('input', () => {
  textInput.style.height = 'auto';
  textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
});

// ─── 停止 ────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  api.clearQueue();
  setStatus('停止しました');
  setTimeout(() => setStatus(''), 1500);
});

// ─── 起動 ────────────────────────────────────────────────────
async function main() {
  configData = await api.getConfig();
  renderGroupButtons();
  renderModelButtons();
  textInput.focus();
}

main();
