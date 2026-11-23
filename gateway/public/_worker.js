export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/downloads/')) {
      if (!env.DOWNLOADS) {
        return new Response(JSON.stringify({ ok: false, error: 'Downloads are unavailable.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
      return env.DOWNLOADS.fetch(request);
    }
    if (!env.API) {
      return new Response(JSON.stringify({ ok: false, error: 'API service binding is unavailable.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
    return env.API.fetch(request);
  }
};
