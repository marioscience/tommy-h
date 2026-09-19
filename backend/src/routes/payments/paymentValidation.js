/** PayPal subscription identifiers are opaque, but always use the I- prefix. */
export function isPayPalSubscriptionId(value) {
  return typeof value === 'string' && /^I-[A-Z0-9]+$/i.test(value);
}
