exports.handler = async function () {
  const clientId = process.env.FUEL_FINDER_CLIENT_ID;
  const clientSecret = process.env.FUEL_FINDER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return json(500, {
      ok: false,
      error: "Missing Fuel Finder environment variables."
    });
  }

  const baseUrl = "https://www.fuel-finder.service.gov.uk";
  const matchedStations = [
    { station: "GO – Dromore Road", area: "14 Dromore Road", officialNames: ["Classic Service Station Limited", "Classic Service Station"], addressHints: ["14 dromore road"] },
    { station: "Hilltop Fuels – A5 Station", area: "135 Curr Road", officialNames: ["Hilltop Fuels A5"], addressHints: ["135 curr road", "curr road"] },
    { station: "ASDA Petrol Station", area: "31 Dromore Road", officialNames: ["Asda Omagh Superstore"], addressHints: ["31 dromore road"] },
    { station: "Nicholl Fuels", area: "53 Dromore Road", officialNames: ["Nicholl Auto365 Culmore Omagh", "Nicholl Fuel Oils"], addressHints: ["53 dromore road"] },
    { station: "Hilltop Fuels – Mountjoy Filling Station", area: "88B Beltany Road", officialNames: ["Mountjoy Filling Station"], addressHints: ["88b beltany road", "beltany road"] },
    { station: "Circle K – 232 Omagh Road", area: "232 Omagh Road", officialNames: ["Circle K"], addressHints: ["232 omagh road"] },
    { station: "Circle K – 82 Derry Road", area: "82 Derry Road", officialNames: ["Circle K"], addressHints: ["82 derry road"] }
  ];

  const unmatched = [
    { station: "Solo – Doherty Firewood & Fuels", area: "Gortrush Industrial Estate" },
    { station: "Campsie Service Station", area: "Campsie Road" },
    { station: "Emo", area: "Curr Road" },
    { station: "Solo", area: "2 Gortin Road" },
    { station: "Glendale Filling Station", area: "Killyclogher Road" }
  ];

  try {
    const accessToken = await getAccessToken(baseUrl, clientId, clientSecret);
    const allPrices = await getAllFuelPrices(baseUrl, accessToken);

    const matched = matchedStations.map((station) => {
      const row = findStationMatch(allPrices, station);
      const parsed = parseStation(row);
      return {
        station: station.station,
        area: station.area,
        petrol: parsed.petrol,
        diesel: parsed.diesel,
        updated: parsed.updated
      };
    }).filter((x) => x.petrol !== null || x.diesel !== null);

    return json(200, {
      ok: true,
      generated_at: new Date().toISOString(),
      matched,
      unmatched
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || "Fuel Finder API request failed."
    });
  }
};

async function getAccessToken(baseUrl, clientId, clientSecret) {
  const url = `${baseUrl}/api/v1/oauth/generate_access_token`;

  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  if (!res.ok) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "fuelfinder.read"
    });

    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
  }

  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`Token request failed (${res.status}). ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Access token not returned by Fuel Finder.");
  }
  return data.access_token;
}

async function getAllFuelPrices(baseUrl, token) {
  const all = [];
  for (let batch = 1; batch <= 30; batch++) {
    const url = `${baseUrl}/api/v1/pfs/fuel-prices?batch-number=${batch}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Fuel prices request failed on batch ${batch} (${res.status}). ${text}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
  }
  return all;
}

function findStationMatch(rows, station) {
  const names = station.officialNames.map((x) => x.toLowerCase());
  const hints = station.addressHints.map((x) => x.toLowerCase());

  let found = rows.find((row) => {
    const trading = (row.trading_name || "").toLowerCase();
    const full = JSON.stringify(row).toLowerCase();
    return names.includes(trading) && hints.some((hint) => full.includes(hint));
  });
  if (found) return found;

  found = rows.find((row) => {
    const full = JSON.stringify(row).toLowerCase();
    return hints.some((hint) => full.includes(hint));
  });
  if (found) return found;

  return rows.find((row) => {
    const trading = (row.trading_name || "").toLowerCase();
    return names.includes(trading);
  }) || null;
}

function parseStation(row) {
  if (!row) return { petrol: null, diesel: null, updated: "" };

  const prices = Array.isArray(row.fuel_prices) ? row.fuel_prices : [];
  let petrol = null;
  let diesel = null;
  let updated = "";

  for (const p of prices) {
    const fuelType = String(p.fuel_type || p.fuel_grade || "").toLowerCase();
    const price = parseNumber(p.price ?? p.amount ?? p.fuel_price);
    const time = p.updated_at || p.update_timestamp || p.price_updated_at || "";

    if (fuelType.includes("diesel") || fuelType.includes("b7")) {
      if (price !== null) diesel = price;
      if (time && !updated) updated = time;
    } else if (fuelType.includes("e10") || fuelType.includes("petrol") || fuelType.includes("unleaded")) {
      if (price !== null) petrol = price;
      if (time && !updated) updated = time;
    }
  }

  return {
    petrol,
    diesel,
    updated: formatTime(updated)
  };
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  if (num > 10) return num / 100;
  return num;
}

function formatTime(value) {
  if (!value) return "";
  return String(value).replace(" GMT+0000 (Coordinated Universal Time)", "");
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
