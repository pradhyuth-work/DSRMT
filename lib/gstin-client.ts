// Server-only client for gstinapi.in. The credentials come from environment variables and are never sent
// to the browser, logged or stored. Nothing here retries on its own.
import { HttpError } from "@/lib/api";
import { SELLER } from "@/lib/seller";
import { readReply, type GspReply } from "@/lib/gsp-parse";

const BASE = "https://www.gstinapi.in";

const env = (k: string) => (process.env[k] ?? "").trim();

/** Test mode stays on unless GSTINAPI_TEST_MODE is exactly "false". */
export const gspTestMode = () => env("GSTINAPI_TEST_MODE").toLowerCase() !== "false";

export function gspConfig() {
  const missing = ["GSTINAPI_KEY", "GSTINAPI_GSTIN", "GSTINAPI_USERNAME", "GSTINAPI_PASSWORD"].filter((k) => !env(k));
  const gstin = env("GSTINAPI_GSTIN").toUpperCase();
  const problem = missing.length
    ? `Not set up: add ${missing.join(", ")} in the server settings`
    : gstin !== SELLER.gstin
      ? "GSTINAPI_GSTIN is not the GSTIN printed on the invoices"
      : null;
  return { testMode: gspTestMode(), ready: problem === null, problem };
}

type Endpoint = "/v1/einvoice" | "/v1/einvoice/cancel" | "/v1/ewaybill/from-irn" | "/v1/ewaybill/cancel";

export async function gspPost(path: Endpoint, testMode: boolean, body: Record<string, unknown>, timeoutMs = 45_000): Promise<GspReply> {
  const config = gspConfig();
  if (!config.ready) throw new HttpError(503, config.problem!);
  // The e-way bill cancel call names the portal user differently from the others.
  const userField = path === "/v1/ewaybill/cancel" ? "gstin_username" : "einv_username";
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env("GSTINAPI_KEY") },
      body: JSON.stringify({
        gstin: env("GSTINAPI_GSTIN").toUpperCase(),
        [userField]: env("GSTINAPI_USERNAME"),
        password: env("GSTINAPI_PASSWORD"),
        ...body,
        test_mode: testMode,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return readReply(res.status, await res.json().catch(() => null));
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return { kind: "unknown", message: timedOut ? "The GSP did not reply in time" : "Could not reach the GSP" };
  }
}
