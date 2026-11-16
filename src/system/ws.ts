/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Broadcast helpers. The old backend had a ConnectionManager holding a Set
 * of `ws` sockets; here the sockets live on the SystemState DO (hibernatable
 * WebSockets) exposed at /v2/ws, and `rt().broadcast` fans a { type, data }
 * payload out to every connected client. Presence updates are the one
 * exception — they're relayed in from the GatewayManager DO and filtered per
 * subscription (see do.ts), not sent through here.
 */

import { rt } from "./runtime";

/** A device/battery state change ({ device, level, charging, ... }). */
export function broadcastDeviceUpdate(deviceData: unknown): void {
  rt().broadcast({ type: "device_update", data: deviceData });
}
