import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
export async function serverGet<T>(path: string): Promise<T> {
  const jar = await cookies();
  const r = await fetch(
    (process.env.HAWK_API || "http://127.0.0.1:8000") + "/api/" + path,
    { cache: "no-store", headers: { Cookie: jar.toString() } },
  );
  if (r.status === 401) redirect("/session");
  if (r.status === 404) notFound();
  if (!r.ok) throw new Error("Workspace could not be loaded.");
  return r.json();
}
