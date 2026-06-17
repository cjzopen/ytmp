// 點擊擴充功能 icon 後顯示的選單：選擇擷取範圍（會員 / 全部）

const warn = document.getElementById('warn');
const actions = document.getElementById('actions');
const btnMember = document.getElementById('btn-member');
const btnAll = document.getElementById('btn-all');

// 先確認目前分頁是否在 YouTube，不是的話停用按鈕並提示
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const onYouTube = tab && tab.url && tab.url.includes('youtube.com');
  if (!onYouTube) {
    warn.style.display = 'block';
    btnMember.disabled = true;
    btnAll.disabled = true;
  }
});

const start = (mode) => {
  // 不等待回應（background 的 start 為非同步且不回傳），直接送出後關閉 popup，
  // 避免 "message port closed before a response was received" 錯誤
  chrome.runtime.sendMessage({ action: 'start', mode });
  window.close();
};

btnMember.addEventListener('click', () => start('member'));
btnAll.addEventListener('click', () => start('all'));
