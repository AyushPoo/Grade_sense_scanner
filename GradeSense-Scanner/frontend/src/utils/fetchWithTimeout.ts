export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 5000,
  retries = 1
): Promise<Response> {
  const method = init.method || 'GET';
  const isRetriable = method === 'GET' || method === 'HEAD';

  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
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
      if (attempt > 0) {
        console.log(`[fetchWithTimeout] Retrying request to ${inputUrl} (attempt ${attempt}/${retries}) due to previous failure...`);
      }
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error: any) {
      lastError = error;
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abortFromExternalSignal);
      }
      clearTimeout(timer);

      const wasExternallyAborted = externalSignal?.aborted;
      if (!isRetriable || wasExternallyAborted || attempt === retries) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abortFromExternalSignal);
      }
      clearTimeout(timer);
    }
  }

  const inputUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : String(input);
  if (lastError?.name === 'AbortError') {
    throw new Error(`Request to ${inputUrl} timed out after ${Math.round(timeoutMs / 1000)}s`);
  }
  const message = lastError?.message || String(lastError);
  throw new Error(`Request to ${inputUrl} failed: ${message}`);
}
