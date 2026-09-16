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
    if (!response.ok) {
      Nexus.reportError('No se pudo consultar la configuracion de pagos.', {
        type: 'server',
        source: 'paypal.config',
        context: { status: response.status }
      });
      throw new Error('No se pudo consultar la configuracion de pagos.');
    }
    const paymentConfig = await response.json();
    if (!paymentConfig.enabled || !paymentConfig.clientId) {
      Nexus.reportError('PayPal no esta habilitado en este entorno.', {
        type: 'client',
        source: 'paypal.config'
      });
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
      script.onerror = () => {
        Nexus.reportError('No se pudo cargar el script de PayPal desde CDN.', {
          type: 'client',
          source: 'paypal.sdk'
        });
        reject(new Error('No se pudo cargar la pasarela de PayPal.'));
      };
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
  debugMode: (
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1' ||
      localStorage.getItem('nexus_debug') === 'true'
  ),
  _warnedProdDebug: false,
  showDebugWarningOnce: function() {
    if (this._warnedProdDebug) return;
    this._warnedProdDebug = true;
    console.warn('');
    console.warn('%c⚠️ NEXUS ESTÁ EN MODO DEBUG. ESTO PUEDE AFECTAR EL RENDIMIENTO Y SEGURIDAD. DEBUG MODE DEBE SER APAGADO EN PRODUCCION!!!.\',\n' +
        '      \'color: red; font-size: 13px; font-weight: bold; background: #fff0f0; padding: 4px; border: 1px solid red;')
    console.warn('%c⚠️ ALL CAPS WARNING: CLIENT DEBUG LOGGING IS ACTIVATED IN PRODUCTION! ⚠️\\nDetailed error payloads and debug headers are exposed.\',\n' +
        '      \'color: red; font-size: 13px; font-weight: bold; background: #fff0f0; padding: 4px; border: 1px solid red;')

  },
  api: async (path, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    const hasBody = opts.body !== undefined && opts.body !== null;
    if (hasBody && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    delete headers.Authorization;
    const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });

    // Sync debug state from backend response headers
    if (res.headers.get('X-Debug-Mode') === 'enabled') {
      Nexus.debugMode = true;
    }
    if (res.headers.get('X-Debug-Warning')) {
      Nexus.showDebugWarningOnce();
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/api/auth/')) {
        localStorage.removeItem('nexus_user');
        location.href = '/';
      }
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;

      Nexus.reportError(err, {
        type: 'server',
        source: `api:${opts.method || 'GET'} ${path}`,
        context: {
          status: res.status,
          requestId: res.headers.get('X-Request-ID'),
          response: data
        }
      });

      throw err;
    }
    return data;
  },

  /**
 * Central error reporter.
 * @param {Error|string} error - The error instance or description.
 * @param {Object} [options]
 * @param {'server'|'client'} [options.type='client'] - Error classification.
 * @param {string} [options.source='general'] - Subsystem or component (e.g., 'paypal', 'auth', 'api').
 * @param {boolean} [options.showToast=false] - Whether to surface an on-screen toast.
 * @param {Object} [options.context={}] - Extra metadata (HTTP status, reqId, payload).
 */
  reportError: (error, options = {}) => {
    const {
      type = 'client',
      source = 'general',
      showToast = false,
      context = {}
    } = options;
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const prefix = type === 'server' ? `[Server Error][${source}]` : `[Client Error][${source}]`;
    // 1. DevTools Console Output
    if (Nexus.debugMode) {
      console.error(`${prefix} ${message}`, {
        source,
        type,
        context,
        stack
      });
    }

    // 2. On-screen Toast (if requested and showToast exists in the scope)
    if (showToast && typeof window.showToast === 'function') {
      window.showToast(message, 'danger');
    }
  },

  session: async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) {
        // Explicit 401/403: session expired on server
        localStorage.removeItem('nexus_user');
        return null;
      };
      const user = await res.json();
      localStorage.setItem('nexus_user', JSON.stringify(user));
      return user;
    } catch (err) {
      Nexus.reportError(err, { type: 'client', source: 'session' });
      //localStorage.removeItem('nexus_user'); logging on front end only removed on 401/403.
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

// 🌐 Captura global de promesas rechazadas no manejadas en el frontend
window.addEventListener('unhandledrejection', (event) => {
  Nexus.reportError(event.reason || 'Promesa rechazada no controlada', {
    type: 'client',
    source: 'unhandledrejection',
    showToast: true
  });
});

// 🌐 Captura global de errores JavaScript no controlados en el frontend
window.addEventListener('error', (event) => {
  Nexus.reportError(event.error || event.message || 'Error no controlado en la interfaz', {
    type: 'client',
    source: 'window.onerror',
    showToast: true
  });
});

