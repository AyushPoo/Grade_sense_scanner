import { getBackendUrl, getWebappUrl } from '../config';

export interface PortalJsonRequest {
  token: string;
  scannerPath: string;
  webappPath: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  scannerBaseUrl?: string;
  webappBaseUrl?: string;
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function authHeaders(token: string, hasJsonBody: boolean): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Bypass-Tunnel-Reminder': 'true',
    ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function readPortalResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return { success: true };

  try {
    return JSON.parse(text);
  } catch {
    return { data: text };
  }
}

function errorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const data = payload as Record<string, unknown>;
    const detail = data.detail ?? data.message;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object') return JSON.stringify(detail);
  }
  return `Request failed with status ${status}`;
}

async function requestJson(url: string, request: PortalJsonRequest): Promise<{ status: number; ok: boolean; payload: unknown }> {
  const hasJsonBody = Boolean(request.body);
  const res = await fetch(url, {
    method: request.method ?? 'GET',
    headers: authHeaders(request.token, hasJsonBody),
    body: hasJsonBody ? JSON.stringify(request.body) : undefined,
  });

  return {
    status: res.status,
    ok: res.ok,
    payload: await readPortalResponse(res),
  };
}

export async function fetchPortalJson(request: PortalJsonRequest): Promise<unknown> {
  const scannerUrl = buildUrl(request.scannerBaseUrl ?? getBackendUrl(), request.scannerPath);
  const scannerResult = await requestJson(scannerUrl, request);

  if (scannerResult.ok) {
    const payload = scannerResult.payload as Record<string, unknown>;
    return payload && typeof payload === 'object' && 'data' in payload ? payload.data : scannerResult.payload;
  }

  if (scannerResult.status !== 404) {
    throw new Error(errorMessage(scannerResult.status, scannerResult.payload));
  }

  const webappUrl = buildUrl(request.webappBaseUrl ?? getWebappUrl(), request.webappPath);
  const webappResult = await requestJson(webappUrl, request);
  if (!webappResult.ok) {
    throw new Error(errorMessage(webappResult.status, webappResult.payload));
  }

  const payload = webappResult.payload as Record<string, unknown>;
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : webappResult.payload;
}
