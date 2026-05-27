chrome.action.onClicked.addListener((tab) => {
  if (!tab.url.includes('youtube.com')) return;

  chrome.storage.local.get(['isRunning'], (result) => {
    if (result.isRunning) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showToast,
        args: ['已有頁面執行中']
      });
      return;
    }

    chrome.storage.local.set({ isRunning: true, sourceUrl: tab.url }, () => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: autoScrollAndExtract
      });
    });
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openReader') {
    chrome.storage.local.get(['sourceUrl'], (result) => {
      const sourceUrl = result.sourceUrl || '';
      chrome.tabs.create({ url: chrome.runtime.getURL('result.html') + '?source=' + encodeURIComponent(sourceUrl) });
      chrome.storage.local.remove(['isRunning', 'sourceUrl']);
    });
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
    memberKeywords: ['會員', '会员', 'member', 'sponsor', 'メンバー', '멤버', '후원자', 'membre', 'miembro', 'membro', 'mitglied', 'участник', 'anggota', 'สมาชิก', 'thành viên', 'सदस्य', 'عضو'],
    
    // 貼文時間與內容
    timeLink: 'yt-formatted-string#published-time-text a, yt-formatted-string#video-time-text a',
    content: '#content-text',
    
    // 圖片
    images: 'ytd-backstage-image-renderer img',
    
    // 影片/直播區塊
    videoWrapper: 'ytd-video-renderer, ytd-post-uploaded-video-renderer',
    videoTitle: '#video-title',
    videoLink: 'a#thumbnail, a#video-title',
    videoThumb: 'ytd-thumbnail img, #thumbnail-container img',

    // 投票區塊
    pollContainer: 'ytd-backstage-poll-renderer',
    pollTotalVotes: '#vote-info',
    pollChoices: 'tp-yt-paper-item.vote-choice',
    pollChoiceText: 'yt-formatted-string.choice-text',
    pollChoicePercentage: 'yt-formatted-string.vote-percentage',
    pollProgressBar: '.progress-bar'
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
    // console.log('Processing post:', postNode);

    // 1. 判定會員資格
    const badge = postNode.querySelector(SELECTORS.memberBadge);
    // console.log('Badge found:', badge);
    if (!badge) {
      // console.log('No badge, skipping');
      return;
    }

    // console.log('Badge outerHTML:', badge.outerHTML);

    const badgeText = badge.textContent.toLowerCase();
    const badgeLabel = badge.getAttribute('aria-label') || '';
    const badgeTooltip = badge.querySelector('tp-yt-paper-tooltip') ? badge.querySelector('tp-yt-paper-tooltip').textContent : '';
    // console.log('Badge text:', badgeText, 'Label:', badgeLabel, 'Tooltip:', badgeTooltip);

    const isMember = SELECTORS.memberKeywords.some(keyword => 
      badgeText.includes(keyword.toLowerCase()) || 
      badgeLabel.toLowerCase().includes(keyword.toLowerCase()) ||
      badgeTooltip.toLowerCase().includes(keyword.toLowerCase())
    );
    console.log('Is member:', isMember);
    if (!isMember) {
      // console.log('Not member, skipping');
      return;
    }

    // 2. 取得 ID (以此為基準合併資料)
    const timeLinkNode = postNode.querySelector(SELECTORS.timeLink);
    const postLink = timeLinkNode ? timeLinkNode.href : '';
    const postId = postLink || postNode.id || (postNode.textContent ? postNode.textContent.trim().substring(0, 50) : Date.now().toString());
    if (!postId) return;

    // 取得現有資料以便後續「合併更新」
    const existing = collectedPosts.get(postId) || {};
    const timeText = timeLinkNode ? timeLinkNode.textContent.trim() : (existing.timeText || '未知時間');

    // 3. 解析文字與超連結
    let parsedContent = existing.parsedContent || '';
    const contentNode = postNode.querySelector(SELECTORS.content);
    if (contentNode) {
      let tempContent = '';
      const walkDOM = (node) => {
        if (node.nodeName === 'A') {
          let url = node.href;
          if (url.includes('/redirect?')) {
            try { url = new URL(url).searchParams.get('q') || url; } catch (e) {}
          }
          tempContent += `<a href="${url}" target="_blank">${escapeText(url)}</a>`;
        } else if (node.nodeType === 3) { // TEXT_NODE
          tempContent += escapeText(node.textContent);
        } else if (node.nodeType === 1) { // ELEMENT_NODE
          node.childNodes.forEach(walkDOM);
        }
      };
      walkDOM(contentNode);
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

    // 檢查是否有「多張圖片」的指示器（右箭頭）
    const hasMultipleImages = !!postNode.querySelector('ytd-post-multi-image-renderer #right-arrow-container') || existing.hasMultipleImages;

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

    // 6. 解析投票區塊
    let voteData = existing.voteData || null;
    const pollNode = postNode.querySelector(SELECTORS.pollContainer);
    if (pollNode) {
      const totalVotesNode = pollNode.querySelector(SELECTORS.pollTotalVotes);
      const totalVotes = totalVotesNode ? totalVotesNode.textContent.trim() : '';
      const choiceNodes = Array.from(pollNode.querySelectorAll(SELECTORS.pollChoices));
      const choices = choiceNodes.map(item => {
        const text = item.querySelector(SELECTORS.pollChoiceText)?.textContent.trim() || '';
        const pctNode = item.querySelector(SELECTORS.pollChoicePercentage);
        const hasResult = pctNode && pctNode.getAttribute('hidden') === null;
        const percentage = hasResult ? pctNode.textContent.trim() : null;
        const barStyle = hasResult ? (item.querySelector(SELECTORS.pollProgressBar)?.getAttribute('style') || '') : '';
        const widthMatch = barStyle.match(/width:([\d.]+)%/);
        const width = widthMatch ? parseFloat(widthMatch[1]) : 0;
        return { text, percentage, width };
      });
      if (choices.length > 0) {
        const voted = choices.some(c => c.percentage !== null);
        voteData = { totalVotes, voted, choices };
      }
    }

    // 每次掃描都覆蓋/更新 Map 裡的資料
    collectedPosts.set(postId, { parsedContent, timeText, postLink, images: mergedImages, videoData, hasMultipleImages, voteData });
  };

  const scrollInterval = setInterval(() => {
    const mainContainer = document.querySelector(SELECTORS.container);
    
    // 取消邊滾邊抓，只負責滾動
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    window.dispatchEvent(new Event('scroll'));
    
    const currentHeight = document.documentElement.scrollHeight;
    // 這裡的 currentPostCount 可以改用畫面上總貼文數來幫助判斷滾動是否停止
    const currentPostCount = mainContainer ? mainContainer.querySelectorAll(SELECTORS.postWrapper).length : 0;

    if (currentHeight === lastHeight && currentPostCount === lastPostCount) {
      noChangeCount++;
      if (noChangeCount >= 8) {
        clearInterval(scrollInterval);
        
        // 滾動確定結束後，再一次性抓取所有貼文
        if (mainContainer) {
          const posts = mainContainer.querySelectorAll(SELECTORS.postWrapper);
          // console.log('Found posts:', posts.length);
          posts.forEach(extractPost);
        }
        
        const results = Array.from(collectedPosts.values());
        // console.log('Collected results:', results.length, results);
        
        toast.textContent = `擷取完畢！共 ${results.length} 篇，準備開啟閱讀器...`;
        toast.style.background = '#000';
        
        chrome.storage.local.set({ memberPosts: results, pageTitle: document.title }, () => {
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

function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed; top:80px; left:50%; transform:translateX(-50%); background:#ff4444; color:#fff; padding:10px 20px; border-radius:20px; z-index:9999; font-weight:bold;';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}