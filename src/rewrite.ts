/** Undo a platform rewrite: restore the path carried in `__path`, keep the other query params. */
export function originalRequest(request: Request): Request {
  const url = new URL(request.url);
  const path = url.searchParams.get('__path');
  if (!path) return request;
  url.searchParams.delete('__path');
  url.pathname = path.startsWith('/') ? path : `/${path}`;
  return new Request(url, request);
}
