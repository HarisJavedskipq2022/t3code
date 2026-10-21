import "../../index.css";

import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { ComposerBannerStack } from "./ComposerBannerStack";

const sidekickBanner = (descriptionDetails: boolean) => (
  <ComposerBannerStack
    items={[
      {
        id: "sidekick",
        variant: "warning",
        icon: null,
        title: "Sidekick stopped",
        description: "POST /alpha/generate → 403 error: the free tier has been retired.",
        descriptionDetails,
      },
    ]}
  />
);

it("never offers details for a clipped description that opts out of them", async () => {
  const container = document.createElement("div");
  container.style.width = "300px";
  await using screen = await render(sidekickBanner(true), { container, router: false });
  const hasDetails = () =>
    screen.container.querySelector('[aria-label="Show notice details"]') !== null;
  // The details button appears once the banner has measured its clipped description.
  await vi.waitFor(() => expect(hasDetails()).toBe(true));

  await screen.rerender(sidekickBanner(false));
  await vi.waitFor(() => expect(hasDetails()).toBe(false));
});
