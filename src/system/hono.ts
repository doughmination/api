/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import type { Hono } from "hono";

export type Env = Record<string, never>;
export type App = Hono<Env>;
