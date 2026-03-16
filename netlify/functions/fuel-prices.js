// netlify/functions/fuel-prices.js

const DEFAULT_TOKEN_URL = "https://api.fuel-finder.service.gov.uk/api/v1/access-token";
const DEFAULT_PRICES_URL = "https://api.fuel-finder.service.gov.uk/api/v1/pfs/fuel-prices?batch-number=1";
const DEFAULT_FORECOURTS_URL = "https://api.fuel-finder.service.gov.uk/api/v1/pfs";

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
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

const extractStationId = (item) =>
  item?.pfsId ||
  item?.pfs_id ||
  item?.forecourtId ||
  item?.forecourt_id ||
  item?.siteId ||
  item?.site_id ||
  item?.id ||
  null;

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

const getJson = async (url, accessToken) => {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const raw = await safeText(res);

  if (!res.ok) {
    throw new Error(`API request failed (${res.status}) for ${url}: ${raw || res.statusText}`);
  }

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${raw}`);
  }
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

    const tokenUrl = getEnv(
      "FUEL_FINDER_TOKEN_URL",
      "FUEL_TOKEN_URL",
      "FF_TOKEN_URL"
    ) || DEFAULT_TOKEN_URL;

    const pricesUrl = getEnv(
      "FUEL_FINDER_PRICES_URL",
      "FUEL_PRICES_URL",
      "FF_PRICES_URL"
    ) || DEFAULT_PRICES_URL;

    const forecourtsUrl = getEnv(
      "FUEL_FINDER_FORECOURTS_URL",
      "FUEL_FORECOURTS_URL",
      "FF_FORECOURTS_URL"
    ) || DEFAULT_FORECOURTS_URL;

    if (!clientId || !clientSecret) {
      return json(500, {
        error: "Missing Fuel Finder credentials",
        missing: {
          clientId: !clientId,
          clientSecret: !clientSecret,
        },
      });
    }

    const accessToken = await getToken({ tokenUrl, clientId, clientSecret });

    const [pricesPayload, forecourtsPayload] = await Promise.all([
      getJson(pricesUrl, accessToken),
      getJson(forecourtsUrl, accessToken),
    ]);

    const prices =
      pricesPayload?.data ||
      pricesPayload?.items ||
      pricesPayload?.results ||
      pricesPayload?.fuelPrices ||
      pricesPayload?.prices ||
      [];

    const forecourts =
      forecourtsPayload?.data ||
      forecourtsPayload?.items ||
      forecourtsPayload?.results ||
      forecourtsPayload?.forecourts ||
      forecourtsPayload?.stations ||
      [];

    const forecourtMap = new Map();

    for (const station of forecourts) {
      const id = extractStationId(station);
      if (!id) continue;
      forecourtMap.set(String(id), station);
    }

    const merged = prices
      .map((priceItem) => {
        const id = extractStationId(priceItem);
        const station = id ? forecourtMap.get(String(id)) : null;

        return {
          id: id || null,
          name:
            station?.name ||
            station?.siteName ||
            station?.stationName ||
            priceItem?.name ||
            "",
          brand:
            station?.brand ||
            station?.brandName ||
            priceItem?.brand ||
            "",
          addressLine1: station?.addressLine1 || station?.address1 || "",
          addressLine2: station?.addressLine2 || station?.address2 || "",
          addressLine3: station?.addressLine3 || station?.address3 || "",
          town:
            station?.town ||
            station?.city ||
            station?.locality ||
            "",
          postcode: station?.postcode || "",
          e10: toNumber(priceItem?.e10 ?? priceItem?.petrol ?? priceItem?.unleaded),
          e5: toNumber(priceItem?.e5 ?? priceItem?.superUnleaded),
          b7: toNumber(priceItem?.b7 ?? priceItem?.diesel),
          sdv: toNumber(priceItem?.sdv ?? priceItem?.superDiesel),
          updatedAt:
            priceItem?.updatedAt ||
            priceItem?.lastUpdated ||
            priceItem?.timestamp ||
            null,
        };
      })
      .filter(isOmaghStation)
      .sort((a, b) => {
        const aBest = [a.e10, a.e5, a.b7, a.sdv].filter((n) => n !== null).sort((x, y) => x - y)[0] ?? 999999;
        const bBest = [b.e10, b.e5, b.b7, b.sdv].filter((n) => n !== null).sort((x, y) => x - y)[0] ?? 999999;
        return aBest - bBest;
      });

    return json(200, {
      ok: true,
      count: merged.length,
      stations: merged,
    });
  } catch (error) {
    return json(500, {
      error: error?.message || "Unknown error",
    });
  }
}
