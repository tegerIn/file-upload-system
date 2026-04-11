(async function loadLayout() {
  const parts = [
    ['partial-header', '/partials/header.html'],
    ['partial-auth', '/partials/auth.html'],
    ['partial-recovery', '/partials/recovery.html'],
    ['partial-side-menu', '/partials/side-menu.html'],
    ['partial-drive', '/partials/drive.html'],
    ['partial-mypage', '/partials/mypage.html'],
  ];

  for (const [targetId, url] of parts) {
    const target = document.getElementById(targetId);
    if (!target) continue;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load layout partial: ${url}`);
    }
    target.innerHTML = await res.text();
  }

  const script = document.createElement('script');
  script.src = '/app.js';
  document.body.appendChild(script);
})();
