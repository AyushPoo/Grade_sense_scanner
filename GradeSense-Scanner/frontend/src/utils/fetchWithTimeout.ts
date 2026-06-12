export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  const inputUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : String(input);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = init.signal;
  const abortFromExternalSignal = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', abortFromExternalSignal);
    }
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request to ${inputUrl} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    const message = error?.message || String(error);
    throw new Error(`Request to ${inputUrl} failed: ${message}`);
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener('abort', abortFromExternalSignal);
    }
    clearTimeout(timer);
  }
}
