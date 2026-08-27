const PORT_BIND_CONFLICT_PATTERN = /address already in use|port is already allocated|failed to bind (?:host )?port|portmanager\.addport/i;

function errorChainMessages(error) {
  const messages = [];
  const visited = new Set();
  let current = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === 'string') {
      messages.push(current);
      break;
    }
    if (current.message) messages.push(String(current.message));
    current = current.cause;
  }
  return messages;
}

export function isPortBindingConflict(error) {
  return errorChainMessages(error).some(message => PORT_BIND_CONFLICT_PATTERN.test(message));
}
