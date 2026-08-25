import { describe, it, expect } from "vitest";
import { appReducer, initialAppState, type AppState } from "./appState";
import type { Channel, Message } from "../api/client";

const channelA: Channel = { id: "c1", name: "général", type: "text", requiredCapability: null, position: 0, createdAt: "now" };
const channelB: Channel = { id: "c2", name: "staff", type: "text", requiredCapability: "moderate", position: 1, createdAt: "now" };

function msg(id: string, channelId: string, content: string): Message {
  return { id, channelId, userId: "u1", username: "theo", content, createdAt: "now" };
}

describe("appReducer", () => {
  it("channels/set auto-selects the first channel when none is selected", () => {
    const state = appReducer(initialAppState, { type: "channels/set", channels: [channelA, channelB] });
    expect(state.channels).toEqual([channelA, channelB]);
    expect(state.selectedChannelId).toBe("c1");
  });

  it("channels/set keeps the current selection if still present", () => {
    const withSelection: AppState = { ...initialAppState, selectedChannelId: "c2" };
    const state = appReducer(withSelection, { type: "channels/set", channels: [channelA, channelB] });
    expect(state.selectedChannelId).toBe("c2");
  });

  it("channels/set does not steal selection away from an open conversation", () => {
    // Channels and conversations load in parallel on mount; if the user opens
    // a DM before the (independent, sometimes slower) channel list finishes
    // loading, channels/set must not auto-pick a default channel out from
    // under them -- that silently swaps their open conversation for a channel.
    const withConversation: AppState = { ...initialAppState, selectedChannelId: null, selectedConversationId: "conv1" };
    const state = appReducer(withConversation, { type: "channels/set", channels: [channelA, channelB] });
    expect(state.selectedChannelId).toBeNull();
    expect(state.selectedConversationId).toBe("conv1");
  });

  it("channel/added ignores a channel that's already present", () => {
    const withChannel: AppState = { ...initialAppState, channels: [channelA] };
    const state = appReducer(withChannel, { type: "channel/added", channel: channelA });
    expect(state.channels).toEqual([channelA]);
  });

  it("channel/removed reselects the first remaining channel if the selected one is deleted", () => {
    const withChannels: AppState = { ...initialAppState, channels: [channelA, channelB], selectedChannelId: "c1" };
    const state = appReducer(withChannels, { type: "channel/removed", channelId: "c1" });
    expect(state.channels).toEqual([channelB]);
    expect(state.selectedChannelId).toBe("c2");
  });

  it("messages/loaded replaces the channel's message list", () => {
    const state = appReducer(initialAppState, { type: "messages/loaded", channelId: "c1", messages: [msg("1", "c1", "hi")] });
    expect(state.messagesByChannel.c1).toEqual([msg("1", "c1", "hi")]);
  });

  it("messages/prepended adds older messages before the existing ones", () => {
    const withMessages: AppState = { ...initialAppState, messagesByChannel: { c1: [msg("2", "c1", "b")] } };
    const state = appReducer(withMessages, { type: "messages/prepended", channelId: "c1", messages: [msg("1", "c1", "a")] });
    expect(state.messagesByChannel.c1).toEqual([msg("1", "c1", "a"), msg("2", "c1", "b")]);
  });

  it("message/received appends to the right channel", () => {
    const state = appReducer(initialAppState, { type: "message/received", message: msg("1", "c1", "hi") });
    expect(state.messagesByChannel.c1).toEqual([msg("1", "c1", "hi")]);
  });

  it("presence/sync replaces the online list", () => {
    const state = appReducer(initialAppState, { type: "presence/sync", userIds: ["u1", "u2"] });
    expect(state.onlineUserIds).toEqual(["u1", "u2"]);
  });

  it("presence/online is idempotent", () => {
    const withPresence: AppState = { ...initialAppState, onlineUserIds: ["u1"] };
    const state = appReducer(withPresence, { type: "presence/online", userId: "u1" });
    expect(state.onlineUserIds).toEqual(["u1"]);
  });

  it("presence/offline removes the user", () => {
    const withPresence: AppState = { ...initialAppState, onlineUserIds: ["u1", "u2"] };
    const state = appReducer(withPresence, { type: "presence/offline", userId: "u1" });
    expect(state.onlineUserIds).toEqual(["u2"]);
  });

  it("voice/sync replaces voice occupancy", () => {
    const state = appReducer(initialAppState, {
      type: "voice/sync",
      channels: { c2: [{ userId: "u1", username: "theo" }, { userId: "u2", username: "alice" }] },
    });
    expect(state.voiceOccupancy).toEqual({
      c2: [{ userId: "u1", username: "theo" }, { userId: "u2", username: "alice" }],
    });
  });

  it("does not let a stale websocket snapshot erase the active LiveKit room", () => {
    const liveParticipants = [{ userId: "u1", username: "theo" }, { userId: "u2", username: "alice" }];
    const current: AppState = { ...initialAppState, voiceOccupancy: { c2: liveParticipants } };
    const state = appReducer(current, { type: "voice/sync", channels: {}, preserveChannelId: "c2" });
    expect(state.voiceOccupancy.c2).toEqual(liveParticipants);
  });

  it("replaces one channel with a LiveKit participant snapshot", () => {
    const initial: AppState = {
      ...initialAppState,
      voiceOccupancy: { c1: [{ userId: "u3", username: "bob" }], c2: [{ userId: "stale", username: "stale" }] },
    };
    const participants = [{ userId: "u1", username: "theo" }, { userId: "u2", username: "alice" }];
    const state = appReducer(initial, { type: "voice/channel-synced", channelId: "c2", participants });
    expect(state.voiceOccupancy).toEqual({ c1: initial.voiceOccupancy.c1, c2: participants });
  });

  it("voice join and leave events are idempotent and remove empty rooms", () => {
    const participant = { userId: "u1", username: "theo" };
    const joined = appReducer(initialAppState, { type: "voice/joined", channelId: "c2", participant });
    const duplicate = appReducer(joined, { type: "voice/joined", channelId: "c2", participant });
    expect(duplicate.voiceOccupancy).toEqual({ c2: [participant] });
    const left = appReducer(duplicate, { type: "voice/left", channelId: "c2", userId: "u1" });
    expect(left.voiceOccupancy).toEqual({});
  });

  it("updates a voice occupant's media status without adding unknown occupants", () => {
    const participant = { userId: "u1", username: "theo" };
    const joined = appReducer(initialAppState, { type: "voice/joined", channelId: "c2", participant });
    const updatedParticipant = { ...participant, microphoneMuted: true, deafened: true };
    const updated = appReducer(joined, { type: "voice/updated", channelId: "c2", participant: updatedParticipant });
    expect(updated.voiceOccupancy.c2).toEqual([updatedParticipant]);
    expect(appReducer(updated, { type: "voice/updated", channelId: "c2", participant: { userId: "u2", username: "alice" } })).toBe(updated);
  });

  it("connection/status updates the status", () => {
    const state = appReducer(initialAppState, { type: "connection/status", status: "open" });
    expect(state.connectionStatus).toBe("open");
  });

  it("marks background messages unread and clears them when the channel opens", () => {
    const base: AppState = { ...initialAppState, currentUser: { id: "u1", username: "theo", capabilities: [] }, selectedChannelId: "c1" };
    const incoming = { ...msg("m2", "c2", "hello"), userId: "u2" };
    const unread = appReducer(base, { type: "message/received", message: incoming });
    expect(unread.unreadChannelIds).toEqual(["c2"]);
    const opened = appReducer(unread, { type: "channel/selected", channelId: "c2" });
    expect(opened.unreadChannelIds).toEqual([]);
  });

  it("does not mark the open channel or the current user's messages unread", () => {
    const base: AppState = { ...initialAppState, currentUser: { id: "u1", username: "theo", capabilities: [] }, selectedChannelId: "c1" };
    const visible = appReducer(base, { type: "message/received", message: { ...msg("m2", "c1", "visible"), userId: "u2" } });
    const own = { ...msg("m3", "c2", "own"), userId: "u1" };
    expect(appReducer(visible, { type: "message/received", message: own }).unreadChannelIds).toEqual([]);
  });
});
