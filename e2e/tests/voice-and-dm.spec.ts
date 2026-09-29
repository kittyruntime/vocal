import { expect, test, type Browser, type Page } from "@playwright/test";

// Two independent browser contexts (separate cookies, separate WebSockets,
// separate LiveKit connections) against one real server + LiveKit SFU.
// Chromium's fake media devices stand in for a microphone.

const CHANNEL = "Lounge";

async function openUser(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[${page.url()}] page error:`, error));
  await page.goto("/");
  return page;
}

async function fillCredentials(page: Page, username: string) {
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(`${username}-password`);
}

async function joinVoice(page: Page) {
  const sidebar = page.getByRole("navigation", { name: "Channels" });
  await sidebar.getByRole("button", { name: CHANNEL, exact: true }).click();
  const voiceView = page.getByRole("region", { name: `Voice channel ${CHANNEL}` });
  await voiceView.getByRole("button", { name: "Join", exact: true }).click();
  await expect(voiceView.getByRole("button", { name: "Leave" })).toBeVisible();
  return voiceView;
}

// Remote audio tracks are attached as <audio data-track-sid=…> elements; one
// showing up means the SFU actually forwarded the other browser's microphone.
async function expectRemoteAudio(page: Page) {
  await expect.poll(
    () => page.evaluate(() => document.querySelectorAll("audio[data-track-sid]").length),
    { message: "a remote audio track should be attached" },
  ).toBeGreaterThan(0);
}

test("two browsers join a voice channel and exchange a direct message", async ({ browser }) => {
  const alice = await openUser(browser);
  const bob = await openUser(browser);

  await test.step("alice sets up the server and creates a voice channel", async () => {
    await expect(alice.getByRole("heading", { name: "Welcome to Vocal" })).toBeVisible();
    await fillCredentials(alice, "alice");
    await alice.getByRole("button", { name: "Create admin account" }).click();

    await alice.getByRole("button", { name: "Create channel" }).click();
    const dialog = alice.getByRole("dialog", { name: "Create a channel" });
    await dialog.getByRole("radio", { name: /Voice/ }).click();
    await dialog.getByLabel("Channel name").fill(CHANNEL);
    await dialog.getByRole("button", { name: "Create channel" }).click();
    await expect(dialog).toBeHidden();
    await expect(alice.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: CHANNEL, exact: true })).toBeVisible();
  });

  await test.step("bob registers an account", async () => {
    await bob.reload();
    await bob.getByRole("button", { name: "Create an account" }).click();
    await fillCredentials(bob, "bob");
    await bob.getByRole("button", { name: "Create my account" }).click();
    await expect(bob.getByRole("navigation", { name: "Channels" })).toBeVisible();
  });

  await test.step("both join the voice channel and see each other", async () => {
    const aliceVoice = await joinVoice(alice);
    const bobVoice = await joinVoice(bob);

    // In-call participant grid: driven by LiveKit room events.
    const aliceGrid = aliceVoice.getByLabel("Call participants");
    const bobGrid = bobVoice.getByLabel("Call participants");
    await expect(aliceGrid.getByText("bob", { exact: true })).toBeVisible();
    await expect(aliceGrid.getByText("alice (you)")).toBeVisible();
    await expect(bobGrid.getByText("alice", { exact: true })).toBeVisible();
    await expect(bobGrid.getByText("bob (you)")).toBeVisible();

    await expectRemoteAudio(alice);
    await expectRemoteAudio(bob);

    // Sidebar occupancy: driven by LiveKit's webhook → server → WebSocket.
    for (const [page, other] of [[alice, "bob"], [bob, "alice"]] as const) {
      const occupants = page.getByRole("list", { name: `Participants in ${CHANNEL}` });
      await expect(occupants.getByText(other, { exact: true })).toBeVisible();
    }
  });

  await test.step("alice starts a DM with bob and they exchange messages", async () => {
    await alice.getByRole("button", { name: "New message" }).click();
    const dialog = alice.getByRole("dialog", { name: "Start a conversation" });
    await dialog.getByLabel("Search members").fill("bob");
    await dialog.getByRole("list", { name: "Search results" }).getByRole("button", { name: "bob" }).click();
    await dialog.getByRole("button", { name: "Message", exact: true }).click();
    await expect(dialog).toBeHidden();

    const aliceComposer = alice.getByLabel("Message in bob");
    await aliceComposer.fill("hey bob, can you hear me?");
    await alice.getByRole("button", { name: "Send", exact: true }).click();
    const aliceHistory = alice.getByLabel("Message history");
    await expect(aliceHistory.getByText("hey bob, can you hear me?")).toBeVisible();

    // Bob gets the conversation pushed over the WebSocket, unread.
    const dmEntry = bob.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: /^alice(, unread messages)?$/ });
    await expect(dmEntry).toBeVisible();
    await dmEntry.click();
    const bobHistory = bob.getByLabel("Message history");
    await expect(bobHistory.getByText("hey bob, can you hear me?")).toBeVisible();

    await bob.getByLabel("Message in alice").fill("loud and clear");
    await bob.getByRole("button", { name: "Send", exact: true }).click();
    await expect(bobHistory.getByText("loud and clear")).toBeVisible();
    await expect(aliceHistory.getByText("loud and clear")).toBeVisible();
  });

  await test.step("leaving the call updates the other side", async () => {
    // Voice stays connected while browsing DMs; go back to the channel to leave.
    await bob.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: CHANNEL, exact: true }).click();
    await bob.getByRole("region", { name: `Voice channel ${CHANNEL}` }).getByRole("button", { name: "Leave" }).click();

    const occupants = alice.getByRole("list", { name: `Participants in ${CHANNEL}` });
    await expect(occupants.getByText("bob", { exact: true })).toBeHidden();
    await expect(occupants.getByText("alice (you)")).toBeVisible();
  });
});
