// 安裝成 App + 自動更新
// - 註冊 Service Worker（sw.js）；每次開啟、回到前景、每小時各檢查一次新版
// - 偵測到新版 → 畫面下方出現「有新版本，點此更新」，點了就重新載入
// - 設定頁與主選單都有「安裝 App」入口；支援的瀏覽器一鍵安裝，其餘顯示手動步驟
const $ = id => document.getElementById(id);

const isApp = !!window.Capacitor || /; wv\)/.test(navigator.userAgent);   // Android App 外殼
const standalone = isApp || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isTouch = matchMedia('(pointer: coarse)').matches;
let deferred = null;

// 設定頁的「App 模式」區塊：永遠顯示，依目前狀態告訴使用者該怎麼做
function renderApp() {
  const text = $('appText'), badge = $('appBadge'), inst = $('installBtn'), fs = $('fsBtn');
  if (!text) return;
  const canFs = !!document.documentElement.requestFullscreen && !isIOS;
  inst.classList.toggle('hidden', !deferred || standalone);
  fs.classList.toggle('hidden', standalone || !canFs || !!document.fullscreenElement);
  $('btnInstall')?.classList.toggle('hidden', standalone || !isTouch);
  if (standalone) {
    badge.textContent = '使用中'; badge.className = 'ok';
    text.textContent = isApp
      ? '你正在使用 Android App：全螢幕、橫向、螢幕不會自動變暗，返回鍵會變成暫停。遊戲內容會自動更新到最新版，不需要重新安裝。'
      : '你正在以 App 模式遊玩：全螢幕、橫向、沒有網址列，系統返回鍵會變成暫停。有新版本時畫面下方會出現更新提示。';
  } else if (deferred) {
    badge.textContent = '可安裝'; badge.className = '';
    text.textContent = '安裝後會在桌面出現圖示，開啟就是全螢幕橫向、沒有網址列，單機模式可離線玩，並且自動更新。';
  } else if (isIOS) {
    badge.textContent = '手動安裝'; badge.className = '';
    text.textContent = '用 Safari 開啟，點下方「分享」按鈕 → 「加入主畫面」，之後從桌面圖示開啟就是全螢幕。';
  } else {
    badge.textContent = '手動安裝'; badge.className = '';
    text.textContent = '用 Chrome 開啟，點右上角選單 ⋮ → 「安裝應用程式」（或「加到主畫面」），之後從桌面圖示開啟就是全螢幕。' + (canFs ? '不想安裝的話，也可以按下面的「進入全螢幕」。' : '');
  }
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; renderApp(); });
addEventListener('appinstalled', () => { deferred = null; renderApp(); });
document.addEventListener('fullscreenchange', renderApp);
const install = async () => {
  if (deferred) {
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null; renderApp();
  } else $('btnSettings')?.click();   // 不能一鍵安裝時，帶使用者去看手動步驟
};
$('installBtn')?.addEventListener('click', install);
$('btnInstall')?.addEventListener('click', install);
$('fsBtn')?.addEventListener('click', () => window.goImmersive?.());
renderApp();

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
