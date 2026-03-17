// renderer/ui.js — グループ・モデル切り替えUI（Phase 7）

/**
 * グループ・モデル切り替えUIを初期化する
 * @param {object} config - config.json の内容
 * @param {function} onGroupSwitch - (group) => void  グループ切り替え時コールバック
 * @param {function} onModelSwitch - (model) => void  モデル切り替え時コールバック
 * @returns {{ getCurrentGroup, getCurrentModel }}
 */
export function setupUI(config, onGroupSwitch, onModelSwitch) {
  const groupBar = document.getElementById('group-bar');
  const modelBar = document.getElementById('model-bar');

  if (!groupBar || !modelBar) {
    console.error('[ui] #group-bar または #model-bar が見つかりません');
    return null;
  }

  let currentGroupIdx = 0;

  // ─── グループボタン描画 ───────────────────────────────────
  function renderGroupButtons() {
    groupBar.innerHTML = '';
    config.groups.forEach((g, i) => {
      const btn = document.createElement('button');
      btn.textContent = g.label || g.id;
      btn.className = 'group-btn' + (i === currentGroupIdx ? ' active' : '');
      btn.dataset.groupIdx = i;
      btn.addEventListener('click', () => {
        if (i === currentGroupIdx) return;
        currentGroupIdx = i;
        // グループ切り替え時はモデル選択を先頭に戻す
        config.groups[i].currentModel = 0;
        renderGroupButtons();
        renderModelButtons();
        onGroupSwitch(config.groups[i]);
      });
      groupBar.appendChild(btn);
    });
  }

  // ─── モデルボタン描画 ─────────────────────────────────────
  function renderModelButtons() {
    modelBar.innerHTML = '';
    const group = config.groups[currentGroupIdx];
    group.models.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.textContent = m.label;
      btn.className = 'model-btn' + (i === group.currentModel ? ' active' : '');
      btn.dataset.modelIdx = i;
      btn.addEventListener('click', () => {
        if (i === group.currentModel) return;
        group.currentModel = i;
        renderModelButtons();
        onModelSwitch(m);
      });
      modelBar.appendChild(btn);
    });
  }

  // 初期描画
  renderGroupButtons();
  renderModelButtons();

  return {
    getCurrentGroup: () => config.groups[currentGroupIdx],
    getCurrentModel: () => {
      const g = config.groups[currentGroupIdx];
      return g.models[g.currentModel];
    },
  };
}
