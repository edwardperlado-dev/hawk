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
export const appUsers = { mgr: people.mgr, coord: people.coord };
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
export const SYDNEY_TIME_ZONE = "Australia/Sydney";

const sydneyTimestamp = new Intl.DateTimeFormat("en-AU", {
  timeZone: SYDNEY_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function stamp(date: string | null | undefined) {
  return date ? sydneyTimestamp.format(new Date(date)) : "Not recorded";
}

export function formatAlert(message: string) {
  return message.replace(
    /^Missed scheduled check at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\.$/,
    (_, scheduled: string) => `Missed scheduled check at ${stamp(scheduled)}.`,
  );
}

export function proofUrl(id: string, mid: string) {
  return (
    "/watchers/" +
    encodeURIComponent(id) +
    "/messages/" +
    encodeURIComponent(mid)
  );
}
export class HawkRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
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
    throw new HawkRequestError(
      messages.join(" ") || `Request failed (${r.status}).`,
      r.status,
    );
  }
  if (data === undefined)
    throw new Error("Hawk returned an unreadable response.");
  return data;
}
