// netlify/functions/fuel-prices.js

const FEEDS = [
  { brand: "Asda", url: "https://storelocator.asda.com/fuel_prices_data.json" },
  { brand: "bp", url: "https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json" },
  { brand: "Esso Tesco Alliance", url: "https://fuelprices.esso.co.uk/latestdata.json" },
  { brand: "JET", url: "https://jetlocal.co.uk/fuel_prices_data.json" },
  { brand: "Morrisons", url: "https://www.morrisons.com/fuel-prices/fuel.json" },
  { brand: "Moto", url: "https://moto-way.com/fuel-price/fuel_prices.json" },
  { brand: "Motor Fuel Group", url: "https://fuel.motorfuelgroup.com/fuel_prices_data.json" },
  { brand: "Rontec", url: "https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json" },
  { brand: "Sainsburys", url: "https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json" },
  { brand: "SGN", url: "https://www.sgnretail.uk/files/data/SGN_daily_fuel_prices.json" },
  { brand: "Tesco", url: "https://www.tesco.com/fuel_prices/fuel_prices_data.json" },
];

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body, null, 2),
});

const safeText = async (res) => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const firstString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const pickArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.stations)) return payload.stations;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.forecourts)) return payload.forecourts;
  if (Array.isArray(payload?.features)) return payload.features;
  if (Array.isArray(payload?.data?.stations)) return payload.data.stations;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.stations?.stations)) return payload.stations.stations;
  return [];
};

const stationHaystack = (station, brandFallback = "") =>
  [
    station?.name,
    station?.siteName,
    station?.stationName,
    station?.station_name,
    station?.brand,
    station?.brandName,
    brandFallback,
    station?.address,
    station?.address1,
    station?.address2,
    station?.address3,
    station?.address4,
    station?.addressLine1,
    station?.addressLine2,
    station?.addressLine3,
    station?.addressLine4,
    station?.town,
    station?.city,
    station?.locality,
    station?.county,
    station?.postcode,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const isOmaghStation = (station, brandFallback = "") => {
  const haystack = stationHaystack(station, brandFallback);
  return haystack.includes("omagh") || haystack.includes("bt78");
};

const extractPricesObject = (station) =>
  station?.prices ||
  station?.price ||
  station?.fuelPrices ||
  station?.fuel_prices ||
  station?.fuels ||
  station?.fuel ||
  {};

const getFuelPrice = (prices, keys) => {
  if (!prices) return null;

  if (Array.isArray(prices)) {
    for (const item of prices) {
      const fuelName = String(
        item?.fuel ||
          item?.fuelType ||
          item?.type ||
          item?.name ||
          item?.product ||
          ""
      ).toLowerCase();

      if (keys.some((k) => fuelName === k.toLowerCase())) {
        return toNumber(item?.price ?? item?.amount ?? item?.value);
      }
    }
    return null;
  }

  for (const key of keys) {
    if (prices[key] !== undefined) return toNumber(prices[key]);
  }

  const lowered = Object.fromEntries(
    Object.entries(prices).map(([k, v]) => [String(k).toLowerCase(), v])
  );

  for (const key of keys) {
    const match = lowered[String(key).toLowerCase()];
    if (match !== undefined) return toNumber(match);
  }

  return null;
};

const normaliseStation = (station, brandFallback = "") => {
  const prices = extractPricesObject(station);

  const base = {
    id:
      station?.site_id ||
      station?.siteId ||
      station?.station_id ||
      station?.stationId ||
      station?.id ||
      null,
    name: firstString(
      station?.name,
      station?.siteName,
      station?.stationName,
      station?.station_name,
      brandFallback
    ),
    brand: firstString(
      station?.brand,
      station?.brandName,
      brandFallback
    ),
    addressLine1: firstString(station?.addressLine1, station?.address1, station?.address),
    addressLine2: firstString(station?.addressLine2, station?.address2),
    addressLine3: firstString(station?.addressLine3, station?.address3),
    addressLine4: firstString(station?.addressLine4, station?.address4),
    town: firstString(station?.town, station?.city, station?.locality),
    postcode: firstString(station?.postcode),
    updatedAt: firstString(
      station?.last_updated,
      station?.lastUpdated,
      station?.updatedAt,
      station?.timestamp
    ) || null,
  };

  const e10 = getFuelPrice(prices, ["E10", "e10", "unleaded", "petrol"]);
  const e5 = getFuelPrice(prices, ["E5", "e5", "super", "super_unleaded", "super unleaded"]);
  const diesel = getFuelPrice(prices, ["B7", "b7", "diesel"]);
  const sdv = getFuelPrice(prices, ["SDV", "sdv", "premium_diesel", "premium diesel"]);

  const rows = [];

  if (e10 !== null) rows.push({ ...base, fuelType: "petrol", price: e10 });
  else if (e5 !== null) rows.push({ ...base, fuelType: "petrol", price: e5 });

  if (diesel !== null) rows.push({ ...base, fuelType: "diesel", price: diesel });
  else if (sdv !== null) rows.push({ ...base, fuelType: "diesel", price: sdv });

  return rows;
};

const fetchFeed = async ({ brand, url }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Omagh Fuel Prices/1.0",
      },
    });

    const raw = await safeText(res);

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("Invalid JSON");
    }

    const stations = pickArray(payload);
    const rows = stations.flatMap((station) => normaliseStation(station, brand));

    return {
      ok: true,
      brand,
      url,
      rows,
    };
  } catch (error) {
    return {
      ok: false,
      brand,
      url,
      error: error?.message || "Fetch failed",
    };
  } finally {
    clearTimeout(timeout);
  }
};

export async function handler() {
  try {
    const settled = await Promise.all(FEEDS.map(fetchFeed));

    const successful = settled.filter((x) => x.ok);
    const failed = settled.filter((x) => !x.ok);

    if (successful.length === 0) {
      return json(500, {
        ok: false,
        error: "All retailer feeds failed",
        failed,
      });
    }

    const stations = successful
      .flatMap((feed) => feed.rows)
      .filter((station) => isOmaghStation(station, station.brand))
      .sort((a, b) => a.price - b.price);

    return json(200, {
      ok: true,
      count: stations.length,
      stations,
      sources: {
        successful: successful.map((x) => x.brand),
        failed: failed.map((x) => ({ brand: x.brand, error: x.error })),
      },
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error?.message || "Unknown error",
    });
  }
}
