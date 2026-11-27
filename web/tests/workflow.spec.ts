import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";

test.beforeEach(({}, testInfo) => {
  execFileSync("../scripts/reset-data", {
    env: {
      ...process.env,
      HAWK_DB: testInfo.config.metadata.db,
      HAWK_CLOCK: "demo",
    },
  });
});

async function login(page: Page, name: string) {
  await page.goto("/session");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL("**/");
  await expect(
    page.locator("header").getByRole("link", { name: new RegExp(name) }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Watchboard" })).toBeVisible();
}
test("manager, coordinator and source owner complete the watch", async ({
  page,
}) => {
  await login(page, "Mira Vale");
  await page
    .getByLabel("What should Hawk watch?")
    .fill("I need to see if the Q4 annual report is ready for my signature");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByLabel("Outcome")).toHaveValue(
    "The Q4 annual report is ready for signature.",
  );
  await page.getByLabel("Outcome").fill("Make things better");
  await page.getByRole("button", { name: "Preview rules" }).click();
  await expect(page.getByText("Changes needed", { exact: true })).toBeVisible();
  await page
    .getByLabel("Outcome")
    .fill("The final Q4 annual report is ready for signature.");
  await page
    .getByRole("button", { name: "Review and approve version 1" })
    .click();
  const confirmation = page.getByRole("dialog", { name: "Approve version 1?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).not.toBeVisible();
  await page
    .getByRole("button", { name: "Review and approve version 1" })
    .click();
  await confirmation.getByRole("button", { name: "Confirm approval" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Version approved" }),
  ).toBeVisible();
  await page.goto("/");
  const first = page.locator("article.watch-card").filter({ hasText: "H-001" });
  await expect(first).toContainText("iPhone");
  await expect(first).toContainText("Confirmed");
  await expect(first).toContainText("Android thread is blocked");
  await expect(first.locator("blockquote")).toContainText("I can test iPhone.");
  await expect(first).toContainText("Android confirmation needed");
  await expect(page.getByText("Hawk online", { exact: true })).toBeVisible();
  await login(page, "Ellis Reed");
  await first.getByRole("link", { name: "Open watcher" }).click();
  await expect(
    page.getByRole("region", { name: "Watcher health" }).getByText(
      "25 Nov 2026, 00:00", { exact: true },
    ),
  ).toBeVisible();
  const duplicate = page.locator("details").filter({
    has: page.locator('a[href$="/messages/05"]'),
  });
  await duplicate.locator("summary").click();
  await expect(duplicate).toContainText("No new alert");
  await page.goto("/watchers/H-002");
  await page.getByRole("button", { name: "Edit rules" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit watcher rules" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Continue editing" }),
  ).toBeVisible();
  await page
    .getByLabel("Outcome")
    .fill("The revised Q4 annual report is ready for signature.");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText(/Awaiting manager approval/)).toBeVisible();
  await login(page, "Mira Vale");
  await page.getByRole("link", { name: "H-002 · Review draft ↗" }).click();
  await expect(
    page.getByRole("button", { name: "Review and approve version 2" }),
  ).toBeVisible();
  await expect(page.locator("del")).toContainText(
    "The final Q4 annual report is ready for signature.",
  );
  await page.getByRole("link", { name: "← Watchboard" }).click();
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByRole("button", { name: "Simulate missed check" }).click();
  const missedCheck = first.locator(".missed-check");
  await expect(missedCheck).toContainText("Scheduled check missed");
  await expect(missedCheck.locator("time")).toBeVisible();
  await first.getByRole("link", { name: "Open watcher" }).click();
  await expect(
    page.getByRole("region", { name: "Watcher health" }).locator(".missed-check"),
  ).toContainText("Scheduled check missed");
  await page.getByRole("link", { name: "← Watchboard" }).click();
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByRole("button", { name: "Resume worker" }).click();
  await expect(missedCheck).not.toBeVisible({
    timeout: 10000,
  });
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Advance clock" }).click();
    await expect
      .poll(async () => {
        const b = await (await page.request.get("/api/dashboard")).json();
        const w = b.cards.find((c: { id: string }) => c.id === "H-001");
        return w.status === "stopped" || w.next_due > b.instant;
      })
      .toBeTruthy();
  }
  await expect(page.locator("#group2")).toContainText("H-001", {
    timeout: 10000,
  });
  await page.goto("/watchers/H-001");
  await page.getByRole("link", { name: /I'm in the Android app/ }).click();
  await expect(
    page.getByRole("heading", { name: "Android releases" }),
  ).toBeVisible();
  await expect(page.locator("blockquote")).toContainText(
    "I'm in the Android app.",
  );
  await page.goto("/session");
  await expect(page.getByRole("button", { name: /Mira Vale/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ellis Reed/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Rowan Lin|Ari Moss/ }),
  ).toHaveCount(0);
});
test("mobile keyboard access and stale refresh preserve evidence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "Mira Vale");
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const card = page.locator("article.watch-card").filter({ hasText: "H-001" });
  const link = card.getByRole("link", { name: "Open watcher" });
  await link.focus();
  await page.route("**/api/dashboard", (r) => r.abort());
  await expect(page.getByText(/Dashboard refresh failed/)).toBeVisible({
    timeout: 10000,
  });
  await expect(link).toBeFocused();
  await expect(card).toContainText("Confirmed");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("discard returns to Watchboard and announces the removed draft", async ({
  page,
}) => {
  await login(page, "Mira Vale");
  await page
    .getByLabel("What should Hawk watch?")
    .fill("improve the process");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL("**/watchers/H-*");
  const outcome = page.getByLabel("Outcome", { exact: true });
  await expect(outcome).toBeFocused();
  await expect(outcome).toHaveValue("");
  await expect(outcome).toHaveAccessibleDescription(
    /What specific result should Hawk watch for/,
  );
  await outcome.fill("The revised intake checklist is approved and published.");
  await expect(page.getByText("Hawk needs a specific outcome")).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1);
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Discard this draft?" })
    .getByRole("button", { name: "Confirm discard" })
    .click();
  await page.waitForURL("**/");
  await expect(
    page.getByText(`Watcher draft ${id} discarded.`, { exact: true }),
  ).toBeVisible({ timeout: 8000 });
  await expect(
    page.getByRole("link", { name: new RegExp(id + " · Review draft") }),
  ).toHaveCount(0);
});

test("leaving a draft offers to stay, save, or discard", async ({ page }) => {
  await login(page, "Mira Vale");
  await page
    .getByLabel("What should Hawk watch?")
    .fill("Tell me when the checklist is approved.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL("**/watchers/H-*");
  const path = new URL(page.url()).pathname;
  const id = path.split("/").at(-1);
  await page.getByLabel("Outcome").fill("The final checklist is approved.");
  const leave = page.getByRole("dialog", { name: "Leave this draft?" });
  await page.evaluate(() => history.back());
  await leave.getByRole("button", { name: "Stay here" }).click();
  await expect(leave).not.toBeVisible();
  await page.getByRole("link", { name: "← Watchboard" }).click();
  await leave.getByRole("button", { name: "Save draft and exit" }).click();
  await page.waitForURL("**/");
  await page.getByRole("link", { name: `${id} · Review draft ↗` }).click();
  await expect(page.getByLabel("Outcome")).toHaveValue(
    "The final checklist is approved.",
  );
  await page.getByRole("link", { name: "← Watchboard" }).click();
  await leave.getByRole("button", { name: "Discard and exit" }).click();
  await page.waitForURL("**/");
  await expect(page.getByText(`Watcher draft ${id} discarded.`)).toBeVisible();
});
