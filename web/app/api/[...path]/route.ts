import type { NextRequest } from "next/server";

// Resolve the private API address at runtime so a single build works on any local port.
async function forward(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  if (!path.every((s) => /^[A-Za-z0-9_-]+$/.test(s)))
    return new Response(null, { status: 404 });
  const headers = new Headers();
  for (const key of ["origin", "cookie", "x-hawk-csrf", "content-type"]) {
    const value = req.headers.get(key);
    if (value) headers.set(key, value);
  }
  const target =
    (process.env.HAWK_API || "http://127.0.0.1:8000") +
    "/api/" +
    path.join("/");
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === "POST" ? await req.text() : undefined,
    cache: "no-store",
    redirect: "error",
  });
  const result = new Headers({
    "Content-Type": upstream.headers.get("content-type") || "application/json",
    "Cache-Control": "no-store",
  });
  for (const value of upstream.headers.getSetCookie())
    result.append("Set-Cookie", value);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: result,
  });
}
export { forward as GET, forward as POST };
