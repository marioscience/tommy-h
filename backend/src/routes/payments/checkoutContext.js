export function getRequestIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0].trim() : req.ip)
    || req.connection?.remoteAddress
    || null;
}

export function getRequestUserAgent(req) {
  return req.headers?.['user-agent'] || null;
}

export function cleanAgreementValue(value = '') {
  return String(value).trim().slice(0, 160);
}
