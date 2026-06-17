// 將 chrome.i18n 訊息套用到頁面：
//   data-i18n="key"            → 取代元素 textContent
//   data-i18n-attr="attr:key"  → 設定屬性（多組以 ; 分隔，例如 "title:foo;aria-label:bar"）
(function () {
  const apply = () => {
    document.documentElement.lang = chrome.i18n.getUILanguage();

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const msg = chrome.i18n.getMessage(el.dataset.i18n);
      if (msg) el.textContent = msg;
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      el.dataset.i18nAttr.split(';').forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s.trim());
        const msg = key && chrome.i18n.getMessage(key);
        if (attr && msg) el.setAttribute(attr, msg);
      });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
