export default {
  async fetch(request, env) {
    if (!env.API) {
      return new Response(JSON.stringify({ ok: false, error: 'API service binding is unavailable.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
    return env.API.fetch(request);
  }
};

