import { expect, type Page, test } from "@playwright/test";
import type {} from "./harness/guided.js";

// Guided layout: the minimal default and the fully enabled `controls` prop.
const optional = [
  { name: "Preview updates", role: "combobox" },
  { name: "Transformation", role: "combobox" },
  { name: "Previous map view", role: "button" },
  { name: "Previous image view", role: "button" },
  { name: "Linked navigation", role: "combobox" },
  { name: "Display adjustment & histogram", role: "text" },
  { name: "Enter coordinates manually", role: "text" },
  { name: "Reference sources", role: "text" },
  { name: "Session files", role: "text" },
  { name: "Unsaved changes", role: "text" },
] as const;
const locate = (page: Page, { name, role }: (typeof optional)[number]) =>
  role === "button"
    ? page.getByRole("button", { name, exact: true })
    : role === "combobox"
      ? page.getByRole("combobox", { name, exact: true })
      : page.getByText(name, { exact: true });

async function matchPoints(page: Page, controls: "minimal" | "all") {
  await page.goto(
    controls === "all" ? "/guided.html?controls=all" : "/guided.html",
  );
  await page.waitForFunction(() => Boolean(window.guided?.controller));
  await page
    .getByLabel("Choose image file", { exact: true })
    .setInputFiles("tests/fixtures/grid.png");
  await page.waitForFunction(() =>
    Boolean(window.guided.controller!.getSnapshot().imageUrl),
  );
  await page.evaluate(() =>
    window.guided.controller!.replaceGcps(
      window.guided.fixture("polynomial1").slice(0, 4),
    ),
  );
}

test("UI-01 minimal default hides expert controls in every step", async ({
  page,
}) => {
  await matchPoints(page, "minimal");
  for (const control of optional)
    await expect(locate(page, control)).toHaveCount(0);
  await expect(page.getByLabel("Target X 1", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Run alignment" }).click();
  await expect(page.locator(".rg-accuracy")).toContainText("Good fit");
  await page.getByRole("button", { name: "Looks good, continue" }).click();
  await expect(page.locator('[data-export-format="geotiff"]')).toBeEnabled();
  await expect(page.getByText("Output settings", { exact: true })).toHaveCount(
    0,
  );
  // Both download groups share one progress bar and cancel button.
  await page.evaluate(() => {
    const c = window.guided.controller!;
    c.setExportFormats([
      ...c.getSnapshot().exportFormats,
      {
        id: "slow",
        label: "Slow export",
        requiresFit: false,
        load: async () => ({ run: () => new Promise(() => {}) }),
      },
    ]);
  });
  await page.getByRole("button", { name: "Slow export", exact: true }).click();
  await expect(page.locator("progress")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Cancel export", exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Cancel export", exact: true })
    .click();
  await expect(page.locator("progress")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to check" }).click();
  await expect(page.locator(".rg-instruction")).toContainText(
    "Does the image line up",
  );
});

test("UI-02 ALL_CONTROLS shows every optional control at its step", async ({
  page,
}) => {
  await matchPoints(page, "all");
  for (const control of optional)
    await expect(locate(page, control).first()).toBeVisible();
  await expect(page.getByLabel("Target X 1", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Transformation", exact: true })
    .selectOption("helmert");
  expect(
    await page.evaluate(
      () => window.guided.controller!.getSnapshot().document.model,
    ),
  ).toBe("helmert");
  await page.getByRole("button", { name: "Run alignment" }).click();
  await page.getByRole("button", { name: "Looks good, continue" }).click();
  await page.getByText("Output settings", { exact: true }).click();
  await expect(page.getByLabel("Output CRS", { exact: true })).toBeVisible();
});
