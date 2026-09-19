/** Bound an external operation without coupling callers to a transport. */
export function promiseWithTimeout(promise, ms, timeoutErrorMsg = 'Operation timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutErrorMsg)), ms))
  ]);
}
