// 安裝成 App + 自動更新
// - 註冊 Service Worker（sw.js）；每次開啟、回到前景、每小時各檢查一次新版
// - 偵測到新版 → 畫面下方出現「有新版本，點此更新」，點了就重新載入
// - 支援安裝的瀏覽器（Android Chrome / Edge）→ 設定頁出現「安裝成 App」按鈕
const $ = id => document.getElementById(id);

let deferred = null;
addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferred = e;
  $('installRow')?.classList.remove('hidden');
});
addEventListener('appinstalled', () => { deferred = null; $('installRow')?.classList.add('hidden'); });
$('installBtn')?.addEventListener('click', async () => {
  if (!deferred) return;
  deferred.prompt();
  await deferred.userChoice.catch(() => {});
  deferred = null; $('installRow')?.classList.add('hidden');
});
if (matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) $('installRow')?.remove();

function showUpdate() {
  if ($('updbar')) return;
  const b = document.createElement('button');
  b.id = 'updbar'; b.textContent = '🔄 有新版本，點此更新';
  b.onclick = () => location.reload();
  document.body.appendChild(b);
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', async () => {
    let reg;
    try { reg = await navigator.serviceWorker.register('sw.js'); } catch { return; }
    const hadController = !!navigator.serviceWorker.controller;
    // 新的 SW 接手 = 有新版本（第一次安裝不提示）
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdate(); });
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 60 * 60 * 1000);
  });
}
