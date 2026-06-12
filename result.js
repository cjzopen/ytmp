document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const sourceUrl = urlParams.get('source');

  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const timeStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  document.querySelector('h1 time').textContent = `${dateStr} ${timeStr}`;

  chrome.storage.local.get(['memberPosts', 'pageTitle'], (result) => {
    const posts = result.memberPosts || [];
    const pageTitle = result.pageTitle || 'YouTube 會員貼文';
    const container = document.getElementById('posts-container');
    const filterSelect = document.getElementById('year-filter');

    container.innerHTML = '';

    if (posts.length === 0) {
      document.getElementById('no-data').style.display = 'block';
      document.getElementById('main-app').style.display = 'none';
      
      document.getElementById('retry-btn').addEventListener('click', () => {
        if (sourceUrl) {
          chrome.tabs.create({ url: sourceUrl });
        } else {
          // 尋找最近一個 YouTube 分頁並切換過去，若沒有則關閉當前頁面
          chrome.tabs.query({ url: "*://*.youtube.com/*" }, (tabs) => {
            if (tabs.length > 0) {
              chrome.tabs.update(tabs[0].id, { active: true });
              chrome.windows.update(tabs[0].windowId, { focused: true });
            } else {
              window.close();
            }
          });
        }
      });
      return;
    }

    const numMap = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    let maxYear = 0;

    // 處理資料並找出最大年份 (中、日、英文的「年」單位)
    posts.forEach(post => {
      // 比對數字後方跟著「年」或「year/years」
      const match = post.timeText.match(/(\d+)\s*(?:年|year)/i);
      
      // 若沒有匹配到「年」，代表是月、週、天、小時，統一歸類為 0 (一年內)
      post.yearDiff = match ? parseInt(match[1], 10) : 0;
      
      if (post.yearDiff > maxYear) {
        maxYear = post.yearDiff;
      }
    });

    // 生成選項
    let optionsHtml = '<option value="">全部</option>';
    optionsHtml += '<option value="0">一年內</option>';

    if (maxYear === 1) {
      // 若最舊的資料就是一年前，就只需要一個選項
      optionsHtml += `<option value="1">一年前</option>`;
    } else if (maxYear >= 2) {
      // 限制最大只處理到 11 (代表最多產出「超過十年」的選項)
      const limit = Math.min(maxYear, 11); 
      const specificMax = limit - 1; 
      
      // 產出獨立年份選項 (例如 1年前、2年前)
      for (let i = 1; i <= specificMax; i++) {
        const chineseNum = i <= 10 ? numMap[i] : i;
        optionsHtml += `<option value="${i}">${chineseNum}年前</option>`;
      }
      
      // 產出最後的收容區選項 (例如 超過2年、超過10年)
      const chineseLastNum = specificMax <= 10 ? numMap[specificMax] : specificMax;
      optionsHtml += `<option value=">${specificMax}">超過${chineseLastNum}年</option>`;
    }
    
    filterSelect.innerHTML = optionsHtml;

    // 將年份綁定到 HTML dataset 上
    posts.forEach((post, index) => {
      const card = document.createElement('div');
      card.className = 'post-card';
      card.dataset.year = post.yearDiff;

      const isLCP = index < 8;
      const uniqueImages = [...new Set(post.images)];
      
      const imagesHtml = uniqueImages.map(src => {
        const loadingAttr = isLCP ? '' : 'loading="lazy"';
        return `<img src="${src}" width="600" height="400" ${loadingAttr} alt="*">`;
      }).join('');

      let videoHtml = '';
      if (post.videoData) {
        const loadingAttr = isLCP ? '' : 'loading="lazy"';
        videoHtml = `
          <div class="post-video">
            <a href="${post.videoData.url}" target="_blank">
              <img src="${post.videoData.thumb}" width="600" height="337" ${loadingAttr} alt="*">
              <div class="video-title">${escapeHtml(post.videoData.title)}</div>
            </a>
          </div>
        `;
      }

      let voteHtml = '';
      if (post.voteData) {
        const { totalVotes, voted, choices } = post.voteData;
        const choicesHtml = choices.map(c => {
          if (voted && c.percentage !== null) {
            return `<div class="vote-choice">
              <div class="vote-choice-header">
                <span class="vote-choice-text">${escapeHtml(c.text)}</span>
                <span class="vote-choice-pct">${escapeHtml(c.percentage)}</span>
              </div>
              <div class="vote-bar-bg"><div class="vote-bar-fill" style="width:${c.width}%"></div></div>
            </div>`;
          }
          return `<div class="vote-choice vote-choice-unvoted">
            <span class="vote-choice-text">${escapeHtml(c.text)}</span>
          </div>`;
        }).join('');
        voteHtml = `<div class="post-vote">
          <div class="vote-choices">${choicesHtml}</div>
          ${totalVotes ? `<div class="vote-total">${escapeHtml(totalVotes)}</div>` : ''}
        </div>`;
      }

      const linkHtml = post.postLink ? `<a href="${post.postLink}" target="_blank" class="post-link">前往原文</a>` : '';



      card.innerHTML = `
        <div class="post-header">
          <div class="post-time">${post.timeText}</div>
          ${linkHtml}
        </div>
        <div class="post-text">${post.parsedContent}</div>
        ${imagesHtml ? `<div class="post-images">${imagesHtml}</div>` : ''}
        ${videoHtml}
        ${voteHtml}
      `;

      container.appendChild(card);
    });

    document.getElementById('download-btn').addEventListener('click', () => downloadPosts(posts, pageTitle));

    // 過濾卡片年份
    filterSelect.addEventListener('change', (e) => {
      const selectedValue = e.target.value;
      const cards = document.querySelectorAll('.post-card');
      
      cards.forEach(card => {
        const cardYear = parseInt(card.dataset.year, 10);
        let shouldShow = false;

        if (selectedValue === "") {
          shouldShow = true; // 全部
        } else if (selectedValue.startsWith(">")) {
          const limit = parseInt(selectedValue.substring(1), 10);
          shouldShow = cardYear > limit; // 大於指定年份 (例如 >2 代表三年以上)
        } else {
          shouldShow = cardYear === parseInt(selectedValue, 10); // 匹配年份
        }
        card.style.display = shouldShow ? '' : 'none';
      });
    });
  });
});

async function downloadPosts(posts, pageTitle) {
  const btn = document.getElementById('download-btn');
  btn.disabled = true;
  btn.textContent = 'Downloading...';

  const zipName = pageTitle.replace(/ - YouTube$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'yt-member-posts';
  const zip = new JSZip();
  const imagesFolder = zip.folder('images');

  const allImageUrls = new Set();
  posts.forEach(post => {
    (post.images || []).forEach(src => allImageUrls.add(src));
    if (post.videoData?.thumb) allImageUrls.add(post.videoData.thumb);
  });

  const imageUrlToLocal = new Map();
  let imgIndex = 0;
  for (const url of allImageUrls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error();
      const blob = await resp.blob();
      let ext = 'jpg';
      if (blob.type === 'image/png') ext = 'png';
      else if (blob.type === 'image/webp') ext = 'webp';
      imgIndex++;
      const filename = `img_${String(imgIndex).padStart(3, '0')}.${ext}`;
      imagesFolder.file(filename, blob, { compression: 'STORE' });
      imageUrlToLocal.set(url, filename);
    } catch {
      // 保留原始 URL
    }
  }

  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('script').forEach(s => s.remove());
  clone.querySelector('.download-area')?.remove();
  clone.querySelectorAll('img').forEach(img => {
    const local = imageUrlToLocal.get(img.getAttribute('src'));
    if (local) img.setAttribute('src', `images/${local}`);
  });
  zip.file('index.html', '<!DOCTYPE html>\n' + clone.outerHTML, { compression: 'DEFLATE' });

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const blobUrl = URL.createObjectURL(zipBlob);
  await new Promise(resolve => {
    chrome.downloads.download({ url: blobUrl, filename: `${zipName}.zip`, conflictAction: 'overwrite' },
      () => { URL.revokeObjectURL(blobUrl); resolve(); });
  });

  btn.textContent = 'Done';
  setTimeout(() => { btn.disabled = false; btn.textContent = 'Download All Posts'; }, 3000);
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}