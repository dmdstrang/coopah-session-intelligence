/** Safely get JSON from a response. Avoids "Unexpected end of JSON input" when body is empty. */
export async function parseJson<T = unknown>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const defaultInit: RequestInit = { credentials: "include" };

/** Fetch with credentials. If response is 401, calls on401 and throws. */
export async function apiFetch(
  url: string,
  init?: RequestInit,
  on401?: () => void
): Promise<Response> {
  const res = await fetch(url, { ...defaultInit, ...init });
  if (res.status === 401) {
    on401?.();
    throw new Error("Unauthorized");
  }
  return res;
}
