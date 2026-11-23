export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (!url.pathname.startsWith("/downloads/")) {
      return json({ ok: false, error: "Not found." }, 404);
    }
    if (!env.PUBLIC_DOWNLOADS) {
      return json({ ok: false, error: "Downloads are unavailable." }, 503);
    }

    let objectKey = "";
    try {
      objectKey = decodeURIComponent(url.pathname.slice("/downloads/".length));
    } catch {
      return json({ ok: false, error: "Not found." }, 404);
    }
    objectKey = objectKey.replace(/^\/+/, "").replace(/\/+/g, "/");
    if (
      !objectKey
      || objectKey.includes("\\")
      || objectKey.split("/").some((part) => !part || part === "." || part === "..")
      || !/^[A-Za-z0-9._/-]+$/.test(objectKey)
      || objectKey.length > 500
    ) {
      return json({ ok: false, error: "Not found." }, 404);
    }

    const object = request.method === "HEAD"
      ? await env.PUBLIC_DOWNLOADS.head(objectKey)
      : await env.PUBLIC_DOWNLOADS.get(objectKey, {
        onlyIf: request.headers,
        range: request.headers
      });
    if (object === null) return json({ ok: false, error: "Not found." }, 404);

    const headers = new Headers();
    object.writeHttpMetadata?.(headers);
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    if (Number.isFinite(object.size)) headers.set("Content-Length", String(object.size));
    const filename = String(objectKey.split("/").pop() || "download")
      .replace(/[^\x20-\x7e]+/g, "_")
      .replace(/["\\/]+/g, "_")
      .trim()
      .slice(0, 180) || "download";
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");
    if (object.range) {
      const { offset, length } = object.range;
      if (Number.isFinite(offset) && Number.isFinite(length) && Number.isFinite(object.size)) {
        headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      }
      headers.set("Accept-Ranges", "bytes");
    }

    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    if (!("body" in object)) return new Response(undefined, { status: 412, headers });
    return new Response(object.body, { status: object.range ? 206 : 200, headers });
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
