// 統一風格的線條圖示（24×24、線寬 2、圓角），顏色跟著文字走（currentColor）
const P = {
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3h4M18.5 7l1.5-1.5"/>',
  city: '<path d="M3 21h18"/><path d="M5 21V10h5v11M10 21V4h7v17M17 21v-8h3v8"/><path d="M13 8h1M13 11h1M13 14h1M7 13h1M7 16h1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9"/>',
  car: '<path d="M4 15l1.6-4.8A2 2 0 0 1 7.5 9h9a2 2 0 0 1 1.9 1.2L20 15"/><rect x="3" y="15" width="18" height="4" rx="1.5"/><circle cx="7.5" cy="19.5" r="1.5"/><circle cx="16.5" cy="19.5" r="1.5"/>',
  podium: '<path d="M9 21V9h6v12M3 21v-7h6M15 21v-9h6v9M3 21h18"/><path d="M12 3l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.6-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.9 2.5 2-1.1 2-2.5 2c-1 0-1.9-.4-2.5-1.2M12 6.5V8M12 16v1.5"/>',
  rotate: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/><path d="M2.5 9.5A8 8 0 0 1 6 5M21.5 14.5A8 8 0 0 1 18 19"/>',
  gamepad: '<path d="M6.5 8h11a4 4 0 0 1 3.9 4.9l-.8 3.6a2.3 2.3 0 0 1-4 .9L15 15H9l-1.6 2.4a2.3 2.3 0 0 1-4-.9l-.8-3.6A4 4 0 0 1 6.5 8z"/><path d="M8 10.5v3M6.5 12h3M15.5 11h.01M17.5 13h.01"/>',
  crown: '<path d="M4 18h16M5 18L3.5 7.5 9 11l3-6 3 6 5.5-3.5L19 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  warn: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
  fuel: '<path d="M5 21V4h9v17M5 11h9"/><path d="M14 8l4 3v7a2 2 0 0 0 4 0v-6l-3-3"/>',
  wrench: '<path d="M14.5 5.5a4 4 0 0 0 5 5L11 19a2.1 2.1 0 0 1-3-3l8.5-8.5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8.5 11L6 3h4l2 5 2-5h4l-2.5 8"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}
// 把 HTML 裡的 <i data-ic="名稱"></i> 換成圖示
export function fillIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = icon(el.dataset.ic, el.className); });
}
