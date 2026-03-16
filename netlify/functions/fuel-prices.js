// netlify/functions/fuel-prices.js

const DEFAULT_TOKEN_URL = "https://api.fuel-finder.service.gov.uk/api/v1/access-token";
const UNLEADED_URL = "https://api.fuel-finder.service.gov.uk/v1/prices?fuel_type=unleaded";
const DIESEL_URL = "https://api.fuel-finder.service.gov.uk/v1/prices?fuel_type=diesel";

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body, null, 2),
});

const getEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
};

const safeText = async (res) => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};

const isOmaghStation = (station) => {
  const haystack = [
    station?.town,
    station?.city,
    station?.locality,
    station?.addressLine1,
    station?.addressLine2,
    station?.addressLine3,
    station?.addressLine4,
    station?.postcode,
    station?.name,
    station?.brand,
    station?.siteName,
    station?.stationName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes("omagh") || haystack.includes("bt78");
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const getToken = async ({ tokenUrl, clientId, clientSecret }) => {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const raw = await safeText(res);

  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${raw || res.statusText}`);
  }

  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Token response was not valid JSON: ${raw}`);
  }

  const accessToken =
    data?.access_token ||
    data?.accessToken ||
    data?.token ||
    "";

  if (!accessToken) {
    throw new Error(`Token response missing access_token: ${raw}`);
  }

  return accessToken;
};

const getJson = async (url, accessToken, label) => {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    const raw = await safeText(res);

    if (!res.ok) {
      throw new Error(`${label} failed (${res.status}): ${raw || res.statusText}`);
    }

    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${label} returned invalid JSON: ${raw}`);
    }
  } catch (error) {
    const causeMessage =
      error?.cause?.message ||
      error?.cause?.code ||
      "";

    throw new Error(
      causeMessage
        ? `${label} fetch failed: ${causeMessage}`
        : `${label} fetch failed: ${error?.message || "Unknown error"}`
    );
  }
};

const normaliseRows = (payload, fuelType) => {
  const rows =
    payload?.data ||
    payload?.items ||
    payload?.results ||
    payload?.prices ||
    payload?.fuelPrices ||
    [];

  if (!Array.isArray(rows)) return [];

  return rows.map((row) => ({
    id:
      row?.pfsId ||
      row?.pfs_id ||
      row?.forecourtId ||
      row?.forecourt_id ||
      row?.siteId ||
      row?.site_id ||
      row?.id ||
      null,
    name:
      row?.name ||
      row?.siteName ||
      row?.stationName ||
      "",
    brand:
      row?.brand ||
      row?.brandName ||
      "",
    addressLine1: row?.addressLine1 || row?.address1 || "",
    addressLine2: row?.addressLine2 || row?.address2 || "",
    addressLine3: row?.addressLine3 || row?.address3 || "",
    addressLine4: row?.addressLine4 || row?.address4 || "",
    town: row?.town || row?.city || row?.locality || "",
    postcode: row?.postcode || "",
    fuelType,
    price: toNumber(
      row?.price ??
      row?.amount ??
      row?.retailPrice ??
      row?.fuelPrice
    ),
    updatedAt:
      row?.updatedAt ||
      row?.lastUpdated ||
      row?.timestamp ||
      null,
  }));
};

export async function handler() {
  try {
    const clientId = getEnv(
      "FUEL_FINDER_CLIENT_ID",
      "FUEL_CLIENT_ID",
      "FF_CLIENT_ID",
      "CLIENT_ID"
    );

    const clientSecret = getEnv(
      "FUEL_FINDER_CLIENT_SECRET",
      "FUEL_CLIENT_SECRET",
      "FF_CLIENT_SECRET",
      "CLIENT_SECRET"
    );

    const tokenUrl =
      getEnv("FUEL_FINDER_TOKEN_URL", "FUEL_TOKEN_URL", "FF_TOKEN_URL") ||
      DEFAULT_TOKEN_URL;

    if (!clientId || !clientSecret) {
      return json(500, {
        ok: false,
        error: "Missing Fuel Finder credentials",
        missing: {
          clientId: !clientId,
          clientSecret: !clientSecret,
        },
      });
    }

    const accessToken = await getToken({ tokenUrl, clientId, clientSecret });

    const [unleadedPayload, dieselPayload] = await Promise.all([
      getJson(UNLEADED_URL, accessToken, "unleaded"),
      getJson(DIESEL_URL, accessToken, "diesel"),
    ]);

    const unleadedRows = normaliseRows(unleadedPayload, "petrol");
    const dieselRows = normaliseRows(dieselPayload, "diesel");

    const allRows = [...unleadedRows, ...dieselRows].filter(isOmaghStation);

    return json(200, {
      ok: true,
      count: allRows.length,
      stations: allRows,
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error?.message || "Unknown error",
      cause: error?.cause?.message || null,
    });
  }
}
