/* =====================================================================
 * openapi.ts — generates /openapi.json from the apidata.ts catalogue.
 *
 * One source of truth: the same GROUPS structure that renders /docs is
 * converted here into an OpenAPI 3.1 document at module load. WebSocket
 * endpoints and the auth-overview pseudo-group are represented in the
 * info/securitySchemes sections rather than as paths.
 * ===================================================================== */

import { GROUPS, type EndpointDef } from "./apidata";
import { ABUSE_CONTACT } from "./abuse";

const BASE = "https://doughmination.uk";

type JsonObj = Record<string, unknown>;

const ENVELOPE_OK: JsonObj = {
  type: "object",
  required: ["success", "data"],
  properties: {
    success: { type: "boolean", const: true },
    data: { description: "Endpoint-specific payload." },
  },
};

const ENVELOPE_ERR: JsonObj = {
  type: "object",
  required: ["success", "error"],
  properties: {
    success: { type: "boolean", const: false },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
};

const RESPONSES: JsonObj = {
  "200": {
    description: "Success envelope.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } },
  },
  "4XX": {
    description: "Error envelope.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
  },
};

/** Map the docs auth tag to OpenAPI security requirements. */
function security(auth: EndpointDef["auth"]): JsonObj[] | undefined {
  switch (auth) {
    case "public":
      return undefined;
    case "key":
      return [{ batteryKey: [] }];
    case "bot":
      return [{ bearerAuth: [] }];
    default: // auth / admin / owner / pet / jwt
      return [{ bearerAuth: [] }];
  }
}

/** "/guestbook?limit=50&offset=0" → { path: "/guestbook", query: ["limit","offset"] };
 *  ":param" segments become "{param}". */
function normalizePath(raw: string): { path: string; query: string[]; pathParams: string[] } {
  const [pathPart, queryPart] = raw.split("?");
  const pathParams: string[] = [];
  const path = pathPart
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        pathParams.push(seg.slice(1));
        return `{${seg.slice(1)}}`;
      }
      return seg;
    })
    .join("/");
  const query = queryPart
    ? queryPart.split("&").map((kv) => kv.split("=")[0]).filter(Boolean)
    : [];
  return { path, query, pathParams };
}

/** Build the parameters array from the endpoint's documented params plus any
 *  query keys embedded in the illustrative path. */
function parameters(ep: EndpointDef, pathParams: string[], queryKeys: string[]): JsonObj[] {
  const out: JsonObj[] = [];
  const seen = new Set<string>();

  for (const [rawName, desc] of ep.params ?? []) {
    // "?fresh / ?nocache / ?refresh" documents several optional query flags.
    const names = rawName.split("/").map((n) => n.trim().replace(/^\?/, "")).filter(Boolean);
    const isQueryDoc = rawName.trimStart().startsWith("?");
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      const inPath = pathParams.includes(name) && !isQueryDoc;
      out.push({
        name,
        in: inPath ? "path" : "query",
        required: inPath,
        description: desc,
        schema: { type: "string" },
      });
    }
  }

  // Path params that had no docs row still must be declared.
  for (const p of pathParams) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ name: p, in: "path", required: true, schema: { type: "string" } });
  }
  // Query keys shown in the illustrative path but not documented separately.
  for (const q of queryKeys) {
    if (seen.has(q)) continue;
    seen.add(q);
    out.push({ name: q, in: "query", required: false, schema: { type: "string" } });
  }
  return out;
}

function buildSpec(): JsonObj {
  const paths: Record<string, JsonObj> = {};

  for (const group of GROUPS) {
    if (group.id === "auth-overview") continue; // described in securitySchemes
    for (const ep of group.endpoints) {
      if (ep.m === "WS") continue; // not representable as an HTTP operation
      const { path, query, pathParams } = normalizePath(ep.path);
      const fullPath = ep.root ? path : `/v2${path}`;
      const item = (paths[fullPath] ??= {});
      const op: JsonObj = {
        tags: [group.name],
        summary: ep.desc.split(". ")[0].slice(0, 120),
        description: ep.desc + (ep.note ? `\n\n${ep.note}` : "") + (ep.example ? `\n\nExample: ${ep.example}` : ""),
        responses: RESPONSES,
      };
      const params = parameters(ep, pathParams, query);
      if (params.length) op.parameters = params;
      const sec = security(ep.auth);
      if (sec) op.security = sec;
      if (ep.m === "POST" || ep.m === "PUT") {
        op.requestBody = {
          required: false,
          content: { "application/json": { schema: { type: "object" } } },
        };
      }
      item[ep.m.toLowerCase()] = op;
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Doughmination API",
      version: "2.0.0",
      description:
        "Combined Discord presence + profile/badges API, Minecraft/Hypixel lookups, git contribution heatmaps, and the Doughmination plural-system API — one Cloudflare Worker.\n\n" +
        "All JSON responses share one envelope: `{ success, data }` or `{ success: false, error: { code, message } }`.\n\n" +
        "**Realtime:** live updates (presence, fronting, mental state, devices) are pushed over a single WebSocket at `wss://doughmination.uk/v2/ws` — see /docs for the frame protocol. WebSocket endpoints are not listed as paths below.\n\n" +
        "**Terms:** be reasonable with request volume or your IP gets blocked — https://doughmination.uk/terms",
      contact: { email: ABUSE_CONTACT, url: `${BASE}/abuse` },
      termsOfService: `${BASE}/terms`,
    },
    servers: [{ url: BASE, description: "Production. Most routes live under /v2 (included in the paths below)." }],
    externalDocs: { url: `${BASE}/docs`, description: "Human-readable API reference" },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "JWT from POST /v2/plural/login (24h expiry) for user endpoints; the operator-set bot token (plus a 'User-Agent: CloveShortcuts/<version>' header) for /v2/plural/bot/* endpoints. Some routes additionally require an admin, owner, or pet role.",
        },
        batteryKey: {
          type: "apiKey",
          in: "header",
          name: "X-Battery-Key",
          description: "Device key for reporting/deleting device state and managing guestbook entries.",
        },
      },
      schemas: { Envelope: ENVELOPE_OK, ErrorEnvelope: ENVELOPE_ERR },
    },
  };
}

/** Serialised once at module load — the catalogue is static per deploy. */
export const OPENAPI_JSON = JSON.stringify(buildSpec());
