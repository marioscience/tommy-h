import { listActiveNodeIds } from '../repositories/nodeRepository.js';
import { getNodeConnection } from './dockerNodeService.js';

const TXADMIN_INDEX_PATH = '/opt/fivem/alpine/opt/cfx-server/citizen/system_resources/monitor/panel/index.html';

const BRANDING_MARKUP = `
<!-- RAGENODES_WHITE_LABEL_PATCH_START -->
<style id="ragenodes-white-label-style">
  :root { --primary: #6366f1 !important; --dark: #0f172a !important; }
  a[href*='zap-hosting'], a[href*='zoxhosting'], a[href*='zox-hosting'],
  a[href*='txadmin.gg'], img[src*='zap'], img[src*='zox'],
  img[alt*='zap' i], img[alt*='zox' i], div[class*='Zap'],
  [class*='sponsor'], [class*='Sponsor'], [class*='advert'],
  [class*='Advert'], .footer-text {
    display: none !important; visibility: hidden !important; pointer-events: none !important;
  }
  .navbar-brand img { content: url('https://ragenodes.com/logo.png') !important; height: 30px !important; }
</style>
<script id="ragenodes-white-label-script">
(() => {
  if (window.__RAGENODES_WHITE_LABEL_ACTIVE__) return;
  window.__RAGENODES_WHITE_LABEL_ACTIVE__ = true;
  const blocked = ['zox hosting', 'zap-hosting', 'zap hosting', 'official fivem server provider', 'recommended official fivem'];
  const hideNode = (el) => {
    if (!el || el.id === 'ragenodes-white-label-script') return;
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.setAttribute('data-ragenodes-hidden', 'true');
  };
  const hideBranding = () => {
    if (window.txConsts) window.txConsts.adsData = {};
    document.title = document.title.replace(/txAdmin/gi, 'RageNodes');
    document.querySelectorAll('a, img, svg, picture, source').forEach((el) => {
      const href = String(el.getAttribute?.('href') || el.getAttribute?.('src') || el.getAttribute?.('srcset') || el.getAttribute?.('alt') || '').toLowerCase();
      if (href.includes('zap') || href.includes('zox')) hideNode(el.closest?.('a') || el);
    });
    document.querySelectorAll('a, button, small, span, p, div').forEach((el) => {
      if (el.closest && el.closest('form')) return;
      if (el.querySelector && (el.querySelector('input') || el.querySelector('[role="checkbox"]'))) return;
      const text = String(el.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (text.includes('agree') || text.includes('accept') || text.includes('terms') || text.includes('terminos') || text.includes('términos') || text.includes('acuerdo') || text.includes('acept')) return;
      if (text && text.length < 180 && blocked.some((term) => text.includes(term))) hideNode(el.closest?.('a') || el);
    });
  };
  hideBranding();
  setInterval(hideBranding, 1500);
  new MutationObserver(hideBranding).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
})();
</script>
<!-- RAGENODES_WHITE_LABEL_PATCH_END -->`;

export async function applyRageNodesBranding(container, _name = 'Unknown', retries = 5) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const check = await container.exec({ Cmd: ['ls', TXADMIN_INDEX_PATH] });
      const stream = await check.start();
      const exists = await new Promise((resolve) => {
        stream.on('data', (data) => resolve(data.toString().includes('index.html')));
        stream.on('end', () => resolve(false));
      });
      if (exists) {
        const markup = BRANDING_MARKUP.replace(/"/g, '\\"').replace(/\n/g, '');
        const command = `sed -i "/RAGENODES_WHITE_LABEL_PATCH_START/,/RAGENODES_WHITE_LABEL_PATCH_END/d; /RAGENODES_WHITE_LABEL_PATCH_V[0-9]/,/script>/d" ${TXADMIN_INDEX_PATH}; sed -i "s@</head>@${markup}</head>@g" ${TXADMIN_INDEX_PATH}`;
        const patch = await container.exec({ Cmd: ['sh', '-c', command] });
        await patch.start();
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export async function patchExistingContainers() {
  try {
    const nodeIds = await listActiveNodeIds();
    for (const nodeId of nodeIds) {
      try {
        const docker = await getNodeConnection(nodeId);
        const containers = await docker.listContainers();
        for (const containerInfo of containers) {
          if (containerInfo.Names[0].startsWith('/ragenodes-')) {
            applyRageNodesBranding(docker.getContainer(containerInfo.Id), containerInfo.Names[0]);
          }
        }
      } catch {}
    }
  } catch {}
}
