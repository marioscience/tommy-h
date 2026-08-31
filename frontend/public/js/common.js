localStorage.removeItem('nexus_token');

const RAGENODES_PANEL_ORIGIN = 'https://panel.ragenodes.app';

window.redirectPublicLoginToPanelApp = function redirectPublicLoginToPanelApp(path = '/') {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname !== 'ragenodes.com' && hostname !== 'www.ragenodes.com') return false;
  const target = new URL(path, RAGENODES_PANEL_ORIGIN);
  window.location.assign(target.toString());
  return true;
};

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (window.location.hostname.toLowerCase() === 'panel.ragenodes.app' && params.get('login') === '1') {
    window.history.replaceState({}, document.title, '/');
    window.openLogin?.();
  }
});

let paypalSdkPromise = null;
const pageScriptNonce = document.currentScript?.nonce || '';

window.loadPayPalSdk = async function loadPayPalSdk() {
  if (window.paypal) return window.paypal;
  if (paypalSdkPromise) return paypalSdkPromise;

  paypalSdkPromise = (async () => {
    const response = await fetch('/api/payments/client-config', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('No se pudo consultar la configuracion de pagos.');
    const paymentConfig = await response.json();
    if (!paymentConfig.enabled || !paymentConfig.clientId) {
      throw new Error('PayPal no esta habilitado en este entorno.');
    }

    const params = new URLSearchParams({
      'client-id': paymentConfig.clientId,
      vault: 'true',
      intent: 'subscription'
    });
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
      script.async = true;
      if (pageScriptNonce) {
        script.nonce = pageScriptNonce;
        // PayPal propaga este valor a los scripts y estilos que genera dentro
        // de sus componentes de pago.
        script.dataset.cspNonce = pageScriptNonce;
      }
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      script.dataset.ragenodesPaymentSdk = 'paypal';
      script.onload = resolve;
      script.onerror = () => reject(new Error('No se pudo cargar la pasarela de PayPal.'));
      document.head.appendChild(script);
    });
    if (!window.paypal) throw new Error('El SDK de PayPal no se inicializo correctamente.');
    return window.paypal;
  })().catch((error) => {
    paypalSdkPromise = null;
    throw error;
  });

  return paypalSdkPromise;
};

window.Nexus = {
  api: async (path, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    const hasBody = opts.body !== undefined && opts.body !== null;
    if (hasBody && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    delete headers.Authorization;
    const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/api/auth/')) {
        localStorage.removeItem('nexus_user');
        location.href = '/';
      }
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },

  session: async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const user = await res.json();
      localStorage.setItem('nexus_user', JSON.stringify(user));
      return user;
    } catch {
      localStorage.removeItem('nexus_user');
      return null;
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      localStorage.removeItem('nexus_token');
      localStorage.removeItem('nexus_user');
      location.href = '/';
    }
  },

  copyToClipboard: (text) => {
    navigator.clipboard.writeText(text);
    alert('¡Copiado al portapapeles!');
  }
};
