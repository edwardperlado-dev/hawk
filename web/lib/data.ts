import type { components } from "./api";
type Models = components["schemas"];
export type Card = Models["Card"];
export type Detail = Models["Detail"];
export type Board = Models["Dashboard"];
export type Config = Models["Config-Input"] &
  Partial<Pick<Models["Config-Output"], "item_rules">>;
export type Preview = Models["Preview"];
export type Evidence = Models["Evidence"];
export const people: Record<string, string> = {
  mgr: "Mira Vale",
  coord: "Ellis Reed",
  lead: "Rowan Lin",
  dev: "Ari Moss",
};
export const roles: Record<string, string> = {
  mgr: "Manager",
  coord: "Coordinator",
  lead: "Dev lead",
  dev: "Developer",
};
export const sources: Record<string, string> = {
  ios: "iPhone releases",
  android: "Android releases",
};
export const values: Record<string, string> = {
  not_recorded: "Not recorded",
  access_details_provided: "Access details supplied",
  confirmed: "Confirmed",
  claimed: "Claimed",
  unclear: "Unclear",
};
export function stamp(date: string | null | undefined) {
  if (!date) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
}
export function proofUrl(id: string, mid: string) {
  return (
    "/watchers/" +
    encodeURIComponent(id) +
    "/messages/" +
    encodeURIComponent(mid)
  );
}
export async function post<T>(path: string, body: unknown): Promise<T> {
  const token =
    document.cookie
      .split("; ")
      .find((c) => c.startsWith("hawk_csrf="))
      ?.split("=")[1] || "";
  const r = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hawk-CSRF": token },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => undefined);
  if (!r.ok) {
    const detail = data?.detail;
    const messages =
      typeof detail === "string"
        ? [detail]
        : Array.isArray(detail)
          ? detail.flatMap((entry) =>
              typeof entry?.msg === "string" ? [entry.msg] : [],
            )
          : detail && typeof detail === "object"
            ? Object.values(detail).filter((entry) => typeof entry === "string")
            : [];
    throw new Error(messages.join(" ") || `Request failed (${r.status}).`);
  }
  if (data === undefined)
    throw new Error("Hawk returned an unreadable response.");
  return data;
}
