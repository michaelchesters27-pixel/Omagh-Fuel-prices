<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Omagh Fuel Prices</title>
  <style>
    :root{
      --bg:#06102a;
      --panel:#0f1b3d;
      --panel-2:#17264f;
      --text:#ffffff;
      --muted:#b9c3df;
      --border:rgba(255,255,255,.10);
      --accent:#1cd98b;
      --danger:#ff5b6e;
      --chip:#13254a;
      --tab:#233256;
      --tab-active:#f4f4f4;
      --tab-active-text:#0c1633;
    }

    *{box-sizing:border-box}
    body{
      margin:0;
      font-family:Arial, Helvetica, sans-serif;
      background:radial-gradient(circle at top left,#0b1740 0%,#06102a 45%,#040b1f 100%);
      color:var(--text);
      min-height:100vh;
      padding:16px;
    }

    .wrap{
      max-width:540px;
      margin:0 auto;
    }

    .card{
      background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));
      border:1px solid var(--border);
      border-radius:28px;
      padding:18px;
      box-shadow:0 20px 50px rgba(0,0,0,.35);
      backdrop-filter:blur(4px);
    }

    .top{
      display:flex;
      justify-content:space-between;
      align-items:flex-start;
      gap:12px;
    }

    .eyebrow{
      color:#a5ffcf;
      font-size:13px;
      font-weight:700;
      letter-spacing:3px;
      margin-bottom:6px;
    }

    h1{
      margin:0 0 12px;
      font-size:30px;
      line-height:1.05;
    }

    .live{
      background:#113c37;
      color:#b6ffe4;
      border-radius:999px;
      padding:10px 14px;
      font-weight:700;
      white-space:nowrap;
    }

    .intro{
      color:var(--text);
      font-size:16px;
      line-height:1.45;
      margin:0 0 16px;
    }

    .tabs{
      display:flex;
      gap:8px;
      background:rgba(255,255,255,.03);
      border-radius:22px;
      padding:4px;
      border:1px solid var(--border);
      margin-top:6px;
    }

    .tab{
      flex:1;
      border:none;
      border-radius:18px;
      padding:16px 10px;
      font-size:18px;
      font-weight:700;
      cursor:pointer;
      background:var(--tab);
      color:#fff;
    }

    .tab.active{
      background:var(--tab-active);
      color:var(--tab-active-text);
    }

    .status{
      margin-top:14px;
      padding:18px;
      border-radius:24px;
      border:1px solid var(--border);
      background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));
    }

    .status.error{
      border-color:rgba(255,91,110,.45);
    }

    .status-title{
      font-size:18px;
      font-weight:700;
      margin-bottom:8px;
    }

    .status-text{
      font-size:15px;
      color:var(--text);
    }

    .list{
      margin-top:14px;
      display:flex;
      flex-direction:column;
      gap:12px;
    }

    .station{
      border:1px solid var(--border);
      border-radius:22px;
      background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.015));
      padding:16px;
    }

    .station-top{
      display:flex;
      justify-content:space-between;
      gap:12px;
      align-items:flex-start;
    }

    .station-name{
      font-size:20px;
      font-weight:700;
      margin:0 0 4px;
    }

    .station-sub{
      color:var(--muted);
      font-size:14px;
      line-height:1.4;
    }

    .price{
      font-size:28px;
      font-weight:800;
      white-space:nowrap;
    }

    .updated{
      margin-top:10px;
      color:var(--muted);
      font-size:13px;
    }

    .footer-note{
      margin-top:18px;
      color:#d2dbf6;
      font-size:15px;
      letter-spacing:3px;
    }

    .hidden{display:none}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="top">
        <div>
          <div class="eyebrow">OMAGH ONLY</div>
          <h1>Omagh Fuel Prices</h1>
        </div>
        <div class="live">API Live</div>
      </div>

      <p class="intro">
        Omagh fuel prices pulled live from the data feed.<br>
        Switch between petrol and diesel and see matched Omagh stations ranked from cheapest to highest.
      </p>

      <div class="tabs">
        <button id="petrolTab" class="tab active" type="button">Petrol</button>
        <button id="dieselTab" class="tab" type="button">Diesel</button>
      </div>
    </div>

    <div id="statusBox" class="status" style="margin-top:14px;">
      <div id="statusTitle" class="status-title">Loading prices...</div>
      <div id="statusText" class="status-text">Checking latest station data.</div>
    </div>

    <div id="stationList" class="list hidden"></div>

    <div class="footer-note">AWAITING OFFICIAL MATCH</div>
  </div>

  <script>
    const endpoint = "/.netlify/functions/fuel-prices";

    let allStations = [];
    let activeFuel = "petrol";

    const petrolTab = document.getElementById("petrolTab");
    const dieselTab = document.getElementById("dieselTab");
    const statusBox = document.getElementById("statusBox");
    const statusTitle = document.getElementById("statusTitle");
    const statusText = document.getElementById("statusText");
    const stationList = document.getElementById("stationList");

    petrolTab.addEventListener("click", () => {
      activeFuel = "petrol";
      petrolTab.classList.add("active");
      dieselTab.classList.remove("active");
      renderStations();
    });

    dieselTab.addEventListener("click", () => {
      activeFuel = "diesel";
      dieselTab.classList.add("active");
      petrolTab.classList.remove("active");
      renderStations();
    });

    function formatPrice(value) {
      if (value === null || value === undefined || value === "") return null;
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return `${n.toFixed(1)}p`;
    }

    function renderStations() {
      const filtered = allStations
        .filter(station => {
          if (activeFuel === "petrol") return station.petrol !== null && station.petrol !== undefined;
          return station.diesel !== null && station.diesel !== undefined;
        })
        .sort((a, b) => {
          const aPrice = activeFuel === "petrol" ? Number(a.petrol) : Number(a.diesel);
          const bPrice = activeFuel === "petrol" ? Number(b.petrol) : Number(b.diesel);
          return aPrice - bPrice;
        });

      if (!filtered.length) {
        stationList.classList.add("hidden");
        statusBox.classList.remove("error");
        statusTitle.textContent = "API connected";
        statusText.textContent = "No matched stations to display yet.";
        return;
      }

      stationList.classList.remove("hidden");
      statusBox.classList.remove("error");
      statusTitle.textContent = "API connected";
      statusText.textContent = `Last API refresh: ${filtered[0].updated || "Unknown"}`;

      stationList.innerHTML = filtered.map((station, index) => {
        const price = activeFuel === "petrol" ? formatPrice(station.petrol) : formatPrice(station.diesel);
        return `
          <div class="station">
            <div class="station-top">
              <div>
                <div class="station-name">${index + 1}. ${station.name || "Station"}</div>
                <div class="station-sub">${station.postcode || ""}</div>
              </div>
              <div class="price">${price || "-"}</div>
            </div>
            <div class="updated">Updated: ${station.updated || "Unknown"}</div>
          </div>
        `;
      }).join("");
    }

    async function loadPrices() {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Fetch failed");
        }

        allStations = Array.isArray(data.stations) ? data.stations : [];
        renderStations();
      } catch (error) {
        stationList.classList.add("hidden");
        statusBox.classList.add("error");
        statusTitle.textContent = "API error";
        statusText.textContent = error.message || "Fetch failed";
      }
    }

    loadPrices();
  </script>
</body>
</html>
