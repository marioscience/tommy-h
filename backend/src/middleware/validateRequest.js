const REQUEST_PARTS = ['params', 'query', 'body'];

export function validateRequest(contract, options = {}) {
  const status = options.status || 400;
  const publicError = options.error || 'Datos de solicitud inválidos.';

  return function requestContractMiddleware(req, res, next) {
    for (const part of REQUEST_PARTS) {
      const schema = contract?.[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        return res.status(status).json({ error: publicError });
      }
      req[part] = result.data;
    }
    return next();
  };
}

