/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/** Latest-known device state (no history). DO blob store. */

import { rt } from "../runtime";

interface DeviceRecord {
  level?: number;
  charging?: boolean;
  lowPowerMode?: boolean;
  wifi?: string | null;
  watch?: boolean;
  airpods?: boolean;
  location?: string | null;
  updated_at: string;
}

/** Fields a caller may set. All optional — only provided fields are updated. */
type DevicePatch = Pick<DeviceRecord, "level" | "charging" | "lowPowerMode" | "wifi" | "watch" | "airpods" | "location">;

type DevicesMap = Record<string, DeviceRecord>;

const KEY = "battery_levels";

export async function getAllLevels(): Promise<DevicesMap> {
  return rt().store.get<DevicesMap>(KEY, {});
}

export async function saveAllLevels(levels: DevicesMap): Promise<void> {
  await rt().store.put(KEY, levels);
}

export async function getDeviceLevel(device: string): Promise<DeviceRecord | null> {
  const levels = await getAllLevels();
  return levels[device] ?? null;
}

/** Merge `patch` into the device's record, preserving any fields not supplied. */
export async function setDeviceLevel(
  device: string,
  patch: DevicePatch,
): Promise<{ device: string } & DeviceRecord> {
  const levels = await getAllLevels();
  const existing = levels[device] ?? {};

  const record: DeviceRecord = {
    ...existing,
    ...(patch.level !== undefined ? { level: patch.level } : {}),
    ...(patch.charging !== undefined ? { charging: patch.charging } : {}),
    ...(patch.lowPowerMode !== undefined ? { lowPowerMode: patch.lowPowerMode } : {}),
    ...(patch.wifi !== undefined ? { wifi: patch.wifi } : {}),
    ...(patch.watch !== undefined ? { watch: patch.watch } : {}),
    ...(patch.airpods !== undefined ? { airpods: patch.airpods } : {}),
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    updated_at: new Date().toISOString(),
  };

  levels[device] = record;
  await saveAllLevels(levels);
  return { device, ...record };
}

/** Remove a device's record. Returns true if it existed and was deleted. */
export async function deleteDevice(device: string): Promise<boolean> {
  const levels = await getAllLevels();
  if (!(device in levels)) return false;
  delete levels[device];
  await saveAllLevels(levels);
  return true;
}
