import { config } from '../config.js';

// Configuracion de PayPal: en produccion debe venir solo desde .env.
const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_API = process.env.PAYPAL_MODE === 'sandbox' ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

function assertPayPalConfigured() {
    if (!PAYPAL_CLIENT || !PAYPAL_SECRET) {
        throw new Error('PayPal no esta configurado. Define PAYPAL_CLIENT y PAYPAL_SECRET en .env antes de habilitar pagos.');
    }
}

/**
 * Obtiene el Token de Acceso de PayPal (OAuth2)
 */
async function getAccessToken() {
    assertPayPalConfigured();
    const auth = Buffer.from(`${PAYPAL_CLIENT}:${PAYPAL_SECRET}`).toString("base64");
    const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
        method: "POST",
        body: "grant_type=client_credentials",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) {
        throw new Error(`PayPal OAuth fallo (${response.status}).`);
    }
    return data.access_token;
}

async function paypalJson(path, options = {}) {
    const token = await getAccessToken();
    const response = await fetch(`${PAYPAL_API}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(`PayPal API fallo (${response.status}).`);
        error.status = response.status;
        error.details = data;
        throw error;
    }
    return data;
}

/**
 * Crea una Orden de Pago (Para Marketplace/Pagos Únicos)
 */
export async function createOrder(amount, description, customId) {
    const token = await getAccessToken();
    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            intent: "CAPTURE",
            purchase_units: [{
                custom_id: customId,
                description: description,
                amount: {
                    currency_code: "USD",
                    value: amount.toString()
                }
            }]
        })
    });
    return await response.json();
}

/**
 * Captura una Orden de Pago ya aprobada
 */
export async function captureOrder(orderId) {
    return paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: "POST",
        body: JSON.stringify({})
    });
}

export async function getOrderDetails(orderId) {
    return paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
}

/**
 * Obtiene detalles de una Suscripción
 */
export async function getSubscriptionDetails(subscriptionId) {
    return paypalJson(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "GET" });
}

export async function verifyWebhookSignature(headers, event) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
        throw new Error('PAYPAL_WEBHOOK_ID no esta configurado.');
    }

    const required = {
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time']
    };
    if (Object.values(required).some(value => !value)) return false;

    const result = await paypalJson('/v1/notifications/verify-webhook-signature', {
        method: 'POST',
        body: JSON.stringify({ ...required, webhook_id: webhookId, webhook_event: event })
    });
    return result.verification_status === 'SUCCESS';
}

/**
 * Cambia una Suscripción de Plan (Upgrade/Downgrade)
 */
export async function reviseSubscription(subscriptionId, newPlanId) {
    const token = await getAccessToken();
    const response = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}/revise`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: newPlanId })
    });
    return await response.json();
}

/**
 * Crea un Producto en el catálogo de PayPal
 */
export async function createProduct(id, name, description, imageUrl) {
    const token = await getAccessToken();
    const payload = {
        id: `RAGE_${id}_${Date.now()}`,
        name: name,
        description: description || name,
        type: "SERVICE",
        category: "SOFTWARE"
    };
    if (imageUrl) payload.image_url = imageUrl;

    const response = await fetch(`${PAYPAL_API}/v1/catalogs/products`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    return await response.json();
}

/**
 * Crea un Plan de Suscripción (Billing Plan) en PayPal asociado a un Producto
 */
export async function createBillingPlan(productId, name, price) {
    const token = await getAccessToken();
    const payload = {
        product_id: productId,
        name: name,
        description: `Suscripción mensual para ${name}`,
        status: "ACTIVE",
        billing_cycles: [
            {
                frequency: { interval_unit: "MONTH", interval_count: 1 },
                tenure_type: "REGULAR",
                sequence: 1,
                total_cycles: 0, // 0 = infinito
                pricing_scheme: {
                    fixed_price: { value: parseFloat(price).toFixed(2), currency_code: "USD" }
                }
            }
        ],
        payment_preferences: {
            auto_bill_outstanding: true,
            setup_fee: { value: "0", currency_code: "USD" },
            setup_fee_failure_action: "CONTINUE",
            payment_failure_threshold: 3
        }
    };

    const response = await fetch(`${PAYPAL_API}/v1/billing/plans`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify(payload)
    });
    return await response.json();
}

export default {
    createOrder,
    getOrderDetails,
    captureOrder,
    getSubscriptionDetails,
    verifyWebhookSignature,
    reviseSubscription,
    createProduct,
    createBillingPlan
};
