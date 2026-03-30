document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['memberPosts'], (result) => {
    const posts = result.memberPosts || [];
    const container = document.getElementById('posts-container');

    container.innerHTML = '';

    if (posts.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: white;">沒有找到任何會員貼文。</p>';
      return;
    }

    posts.forEach((post, index) => {
      const card = document.createElement('div');
      card.className = 'post-card';

      const isLCP = index < 8;
      const uniqueImages = [...new Set(post.images)];
      
      const imagesHtml = uniqueImages.map(src => {
        const loadingAttr = isLCP ? '' : 'loading="lazy"';
        return `<img src="${src}" width="600" height="400" ${loadingAttr} alt="*">`;
      }).join('');

      // 若有影片/直播資料，組裝對應的 HTML
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

      const linkHtml = post.postLink ? `<a href="${post.postLink}" target="_blank" class="post-link">前往原文</a>` : '';

      card.innerHTML = `
        <div class="post-header">
          <div class="post-time">${post.timeText}</div>
          ${linkHtml}
        </div>
        <div class="post-text">${post.parsedContent}</div>
        ${imagesHtml ? `<div class="post-images">${imagesHtml}</div>` : ''}
        ${videoHtml}
      `;

      container.appendChild(card);
    });
  });
});

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}