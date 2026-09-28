/* 浏览器里的标题栏颜色跟着主题走；程序窗口的标题栏由后台负责（见 app.py 的 paint_title_bar） */
window.syncTitleBar = function () {
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = document.documentElement.dataset.theme === 'light' ? '#eceef8' : '#0c0e16';
};

(function () {
  // 优先用后台保存的主题：程序每次启动端口不同，浏览器按端口存的 localStorage 会丢
  var t = document.documentElement.getAttribute('data-saved-theme');
  if (!t) try { t = localStorage.getItem('theme'); } catch (e) { /* 无痕模式等 */ }
  if (!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  window.syncTitleBar();
})();
