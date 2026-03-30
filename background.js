chrome.action.onClicked.addListener((tab) => {
  if (!tab.url.includes('youtube.com')) return;

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: autoScrollAndExtract
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openReader') {
    chrome.tabs.create({ url: chrome.runtime.getURL('result.html') });
  }
});

function autoScrollAndExtract() {
  if (window.isYtScrollerRunning) return;
  window.isYtScrollerRunning = true;

  // ==========================================
  // [集中設定區] 未來 YouTube 改版，只需修改這裡
  // ==========================================
  const SELECTORS = {
    // 佈局與外層
    container: '#contents',
    postWrapper: 'ytd-backstage-post-thread-renderer, ytd-post-renderer',
    
    // 會員判定
    memberBadge: '#sponsors-only-badge, ytd-sponsors-only-badge-renderer',
    memberKeywords: ['會員', 'member', 'sponsor', 'メンバー',],
    
    // 貼文時間與內容
    timeLink: 'yt-formatted-string#published-time-text a, yt-formatted-string#video-time-text a',
    content: '#content-text',
    
    // 圖片
    images: 'ytd-backstage-image-renderer img',
    
    // 影片/直播區塊
    videoWrapper: 'ytd-video-renderer, ytd-post-uploaded-video-renderer',
    videoTitle: '#video-title',
    videoLink: 'a#thumbnail, a#video-title',
    videoThumb: 'ytd-thumbnail img, #thumbnail-container img'
  };

  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed; top:80px; left:50%; transform:translateX(-50%); background:#2ba640; color:#fff; padding:10px 20px; border-radius:20px; z-index:9999; font-weight:bold;';
  toast.textContent = '截取中...請勿離開此分頁';
  document.body.appendChild(toast);

  const collectedPosts = new Map();
  let lastHeight = 0;
  let lastPostCount = 0;
  let noChangeCount = 0;

  const escapeText = (str) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const extractPost = (postNode) => {
    // 1. 判定會員資格
    const badge = postNode.querySelector(SELECTORS.memberBadge);
    if (!badge) return;

    const badgeText = badge.textContent.toLowerCase();
    const isMember = SELECTORS.memberKeywords.some(keyword => badgeText.includes(keyword.toLowerCase()));
    if (!isMember) return;

    // 2. 取得 ID (以此為基準合併資料)
    const timeLinkNode = postNode.querySelector(SELECTORS.timeLink);
    const postLink = timeLinkNode ? timeLinkNode.href : '';
    const postId = postLink || postNode.id || postNode.querySelector(SELECTORS.content)?.textContent.substring(0, 50);
    if (!postId) return;

    // 取得現有資料以便後續「合併更新」
    const existing = collectedPosts.get(postId) || {};
    const timeText = timeLinkNode ? timeLinkNode.textContent.trim() : (existing.timeText || '未知時間');

    // 3. 解析文字與超連結
    let parsedContent = existing.parsedContent || '';
    const contentNode = postNode.querySelector(SELECTORS.content);
    if (contentNode) {
      let tempContent = '';
      contentNode.childNodes.forEach(child => {
        if (child.nodeName === 'A') {
          let url = child.href;
          if (url.includes('/redirect?')) {
            try { url = new URL(url).searchParams.get('q') || url; } catch (e) {}
          }
          tempContent += `<a href="${url}" target="_blank">${escapeText(url)}</a>`;
        } else {
          tempContent += escapeText(child.textContent);
        }
      });
      if (tempContent) parsedContent = tempContent;
    }

    // 4. 解析圖片：過濾懶加載的假圖片，並與既有圖片聯集
    const currentImages = Array.from(postNode.querySelectorAll(SELECTORS.images))
      .map(img => {
        let src = img.src;
        // 若沒有 src 或是 base64 佔位圖，直接略過，等它載入好下次再抓
        if (!src || src.startsWith('data:')) return null; 
        if (src.includes('=s')) src = src.replace(/=s\d+-.*/, '=s0'); 
        return src;
      })
      .filter(src => src);

    const mergedImages = existing.images ? [...existing.images] : [];
    currentImages.forEach(src => {
      if (!mergedImages.includes(src)) mergedImages.push(src);
    });

    // 5. 解析影片或直播區塊
    let videoData = existing.videoData || null;
    const videoNode = postNode.querySelector(SELECTORS.videoWrapper);
    if (videoNode) {
      const titleNode = videoNode.querySelector(SELECTORS.videoTitle);
      const title = titleNode ? titleNode.textContent.trim() : '觀看影片/直播';
      
      const linkNode = videoNode.querySelector(SELECTORS.videoLink);
      const url = linkNode ? linkNode.href : postLink; // 若沒抓到 a 標籤則退回貼文原文連結
      
      const thumbNode = videoNode.querySelector(SELECTORS.videoThumb);
      let thumb = thumbNode ? thumbNode.src : '';
      
      if (thumb && !thumb.startsWith('data:')) {
        if (thumb.includes('=s')) thumb = thumb.replace(/=s\d+-.*/, '=s0');
        videoData = { title, url, thumb };
      }
    }

    // 每次掃描都覆蓋/更新 Map 裡的資料
    collectedPosts.set(postId, { parsedContent, timeText, postLink, images: mergedImages, videoData });
  };

  const scrollInterval = setInterval(() => {
    const mainContainer = document.querySelector(SELECTORS.container);
    if (mainContainer) {
      mainContainer.querySelectorAll(SELECTORS.postWrapper).forEach(extractPost);
    }

    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    window.dispatchEvent(new Event('scroll'));
    
    const currentHeight = document.documentElement.scrollHeight;
    const currentPostCount = collectedPosts.size;

    if (currentHeight === lastHeight && currentPostCount === lastPostCount) {
      noChangeCount++;
      if (noChangeCount >= 8) {
        clearInterval(scrollInterval);
        toast.textContent = `擷取完畢！共 ${collectedPosts.size} 篇，準備開啟閱讀器...`;
        toast.style.background = '#000';
        
        const results = Array.from(collectedPosts.values());
        chrome.storage.local.set({ memberPosts: results }, () => {
          chrome.runtime.sendMessage({ action: 'openReader' });
          setTimeout(() => toast.remove(), 3000);
          window.isYtScrollerRunning = false;
        });
      }
    } else {
      lastHeight = currentHeight;
      lastPostCount = currentPostCount;
      noChangeCount = 0;
    }
  }, 1000);
}