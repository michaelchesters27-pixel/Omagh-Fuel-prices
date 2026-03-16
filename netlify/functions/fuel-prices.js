// netlify/functions/fuel-prices.js

const FEED_URL = "https://storelocator.asda.com/fuel_prices_data.json";
const TARGET_POSTCODE = "bt781qz";

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  body: JSON.stringify(body, null, 2)
});

export async function handler() {
  try {

    const res = await fetch(FEED_URL);

    if (!res.ok) {
      return json(500, { ok: false, error: "Could not fetch Asda feed" });
    }

    const data = await res.json();

    const stations = data.stations || [];

    const results = stations
      .filter(s => {
        const text = (
          (s.postcode || "") +
          (s.address || "") +
          (s.address1 || "") +
          (s.address2 || "")
        )
        .toLowerCase()
        .replace(/\s+/g, "");

        return text.includes(TARGET_POSTCODE);
      })
      .map(s => ({
        name: s.name || "Asda",
        postcode: s.postcode,
        petrol: s.prices?.E10 || null,
        diesel: s.prices?.B7 || null,
        updated: data.last_updated
      }));

    return json(200, {
      ok: true,
      count: results.length,
      stations: results
    });

  } catch (error) {

    return json(500, {
      ok: false,
      error: error.message
    });

  }
}
