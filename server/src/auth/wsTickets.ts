import { randomBytes } from "node:crypto";

// Short-lived, single-use tickets that let the desktop app (Bearer-token
// auth, no ambient cookie) open the /ws WebSocket without ever putting its
// real session token -- valid for 30 days -- in a URL, where it could end up
// in proxy/access logs. Minted via an authenticated POST, spent immediately
// by the handshake that follows.
const TICKET_TTL_MS = 30_000;

const tickets = new Map<string, { userId: string; expiresAt: number }>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(ticket);
  }
}

export function createWsTicket(userId: string): string {
  if (tickets.size > 10_000) sweepExpired();
  const ticket = randomBytes(24).toString("base64url");
  tickets.set(ticket, { userId, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

// Consumes (deletes) the ticket regardless of outcome, so it can never be
// replayed even if the caller ignores an expired result.
export function consumeWsTicket(ticket: string): string | null {
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}
