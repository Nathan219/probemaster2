// Authentication utility for API access
const ACCESS_KEY_STORAGE_KEY = 'pm_access_key';
const DEFAULT_ACCESS_KEY = 'justathing';

/**
 * Get the access key from localStorage, or return the default
 */
export function getAccessKey(): string {
  const stored = localStorage.getItem(ACCESS_KEY_STORAGE_KEY);
  if (stored && stored.trim() !== '') {
    return stored;
  }
  // Set default if not found or empty
  setAccessKey(DEFAULT_ACCESS_KEY);
  return DEFAULT_ACCESS_KEY;
}

/**
 * Set the access key in localStorage
 */
export function setAccessKey(key: string): void {
  localStorage.setItem(ACCESS_KEY_STORAGE_KEY, key);
}

/**
 * Get headers with the access key for API requests
 */
export function getAuthHeaders(): Record<string, string> {
  return {
    'X-Access-Key': getAccessKey(),
  };
}

/**
 * Make an authenticated fetch request
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  Object.entries(getAuthHeaders()).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return fetch(url, {
    ...options,
    headers,
  });
}
