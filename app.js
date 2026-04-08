const DEFAULT_LOCATION = {
  name: "New York",
  region: "New York",
  country: "United States",
  latitude: 40.7128,
  longitude: -74.006
};

const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REVERSE_GEOCODE_URL = "https://nominatim.openstreetmap.org/reverse";
const RADAR_URL = "https://api.rainviewer.com/public/weather-maps.json";
const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active";
const DEGREE_F = "\u00B0F";
const LIGHTNING_EMBED_URL = "https://map.blitzortung.org/index.php";

const WEATHER_CODES = {
  0: "Clear sky",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Heavy rain showers",
  82: "Violent rain showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm with hail"
};

const elements = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#location-input"),
  results: document.querySelector("#search-results"),
  status: document.querySelector("#status-text"),
  placeName: document.querySelector("#place-name"),
  updatedAt: document.querySelector("#updated-at"),
  summary: document.querySelector("#weather-summary"),
  temp: document.querySelector("#current-temp"),
  wind: document.querySelector("#wind-speed"),
  feelsLike: document.querySelector("#feels-like"),
  humidity: document.querySelector("#humidity"),
  gusts: document.querySelector("#wind-gusts"),
  forecast: document.querySelector("#hourly-forecast"),
  dailyTotals: document.querySelector("#daily-totals"),
  alertsList: document.querySelector("#alerts-list"),
  alertsSummary: document.querySelector("#alerts-summary"),
  shareUrl: document.querySelector("#share-url"),
  shareHint: document.querySelector("#share-hint"),
  radarTime: document.querySelector("#radar-time"),
  toggleRadar: document.querySelector("#toggle-radar"),
  useLocation: document.querySelector("#use-location"),
  shareLocation: document.querySelector("#share-location"),
  copyLink: document.querySelector("#copy-link"),
  layerButtons: Array.from(document.querySelectorAll(".layer-button")),
  lightningMap: document.querySelector("#lightning-map"),
  mapElement: document.querySelector("#map"),
  tempLegend: document.querySelector("#temp-legend"),
  tempLegendLow: document.querySelector("#temp-legend-low"),
  tempLegendHigh: document.querySelector("#temp-legend-high"),
  mapDescription: document.querySelector("#map-description"),
  mapAttribution: document.querySelector("#map-attribution")
};

const state = {
  currentLocation: { ...DEFAULT_LOCATION },
  radarFrames: [],
  radarHost: "https://tilecache.rainviewer.com",
  radarIndex: 0,
  radarAnimating: true,
  selectedLayer: "radar",
  weatherTimer: null,
  radarTimer: null,
  radarFrameTimer: null,
  temperatureRequestToken: 0
};

let map;
let radarLayer;
let alertLayer;
let temperatureCanvas;
let temperatureCanvasContext;

initializeApp();

async function initializeApp() {
  bindEvents();
  setupMap();
  refreshShareHint();

  const fromUrl = readLocationFromUrl();
  if (fromUrl) {
    state.currentLocation = fromUrl;
  }

  try {
    await loadDashboard(state.currentLocation, {
      announce: fromUrl ? "Loaded shared town weather." : "Loaded default town weather."
    });
  } catch (error) {
    console.error(error);
    setStatus("The app could not reach one of the live weather services.");
  }

  startAutoRefresh();
}

function bindEvents() {
  elements.form.addEventListener("submit", handleSearchSubmit);
  elements.useLocation.addEventListener("click", useMyLocation);
  elements.shareLocation.addEventListener("click", shareCurrentLocation);
  elements.copyLink.addEventListener("click", copyShareLink);
  elements.toggleRadar.addEventListener("click", toggleRadarAnimation);
  elements.layerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setLayerMode(button.dataset.layer);
    });
  });
}

function setupMap() {
  map = L.map("map", {
    zoomControl: true,
    worldCopyJump: true,
    maxZoom: 12,
    minZoom: 3
  }).setView([DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude], 8);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(map);

  initializeTemperatureCanvas();
  initializeAlertLayer();
  map.on("moveend zoomend", handleMapViewportChanged);
  map.on("resize", resizeTemperatureCanvas);
}

async function handleSearchSubmit(event) {
  event.preventDefault();
  const query = elements.input.value.trim();

  if (!query) {
    setStatus("Type a town name or ZIP code to search.");
    return;
  }

  setStatus(`Searching for "${query}"...`);
  elements.results.innerHTML = "";

  try {
    const matches = await searchLocations(query);

    if (!matches.length) {
      setStatus("No matching towns came back. Try a nearby city or ZIP code.");
      return;
    }

    renderSearchResults(matches);
    await selectLocation(matches[0], {
      announce: `Showing weather for ${buildPlaceLabel(matches[0])}.`
    });
  } catch (error) {
    console.error(error);
    setStatus("Search hit a snag. Please try again in a moment.");
  }
}

async function searchLocations(query) {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Search request failed.");
  }

  const data = await response.json();
  return (data.results || []).map((item) => ({
    name: item.name,
    region: item.admin1 || item.admin2 || "",
    country: item.country || "",
    latitude: item.latitude,
    longitude: item.longitude
  }));
}

function renderSearchResults(results) {
  elements.results.innerHTML = "";

  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = buildPlaceLabel(result);
    button.addEventListener("click", async () => {
      await selectLocation(result, {
        announce: `Showing weather for ${buildPlaceLabel(result)}.`
      });
    });

    const listItem = document.createElement("li");
    listItem.appendChild(button);
    elements.results.appendChild(listItem);
  });
}

async function selectLocation(location, options = {}) {
  state.currentLocation = location;
  elements.input.value = location.name;
  await loadDashboard(location, options);
}

async function useMyLocation() {
  if (!navigator.geolocation) {
    setStatus("This browser does not support location access.");
    return;
  }

  setStatus("Requesting your location...");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      let location = {
        name: "My Location",
        region: "",
        country: "",
        latitude,
        longitude
      };

      try {
        const reverseMatch = await reverseGeocode(latitude, longitude);
        location = {
          ...location,
          ...reverseMatch
        };
      } catch (error) {
        console.warn("Reverse geocoding failed.", error);
      }

      await selectLocation(location, {
        announce: `Showing weather near ${buildPlaceLabel(location)}.`
      });
    },
    (error) => {
      console.error(error);
      setStatus("Location access was blocked. Open the app on localhost and allow the location prompt.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000
    }
  );
}

async function reverseGeocode(latitude, longitude) {
  const url = new URL(REVERSE_GEOCODE_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "10");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Reverse geocoding request failed.");
  }

  const data = await response.json();
  const address = data.address || {};

  return {
    name: address.city || address.town || address.village || address.hamlet || data.name || "My Location",
    region: address.state || address.county || "",
    country: address.country || ""
  };
}

async function loadDashboard(location, options = {}) {
  setStatus(`Loading weather for ${buildPlaceLabel(location)}...`);
  updateShareLink(location);
  updateMapCenter(location);
  updateLightningEmbed(location);

  const results = await Promise.allSettled([
    loadWeather(location),
    loadRadar(location),
    loadWarnings(location)
  ]);

  const primaryFailures = results.slice(0, 2).filter((result) => result.status === "rejected");
  const warningFailures = results.slice(2).filter((result) => result.status === "rejected");
  primaryFailures.forEach((result) => console.error(result.reason));
  warningFailures.forEach((result) => console.warn(result.reason));

  if (primaryFailures.length === 2) {
    throw new Error("Weather and radar services both failed.");
  }

  if (primaryFailures.length) {
    setStatus("Weather updated, but one live service is temporarily unavailable.");
    return;
  }

  setStatus(options.announce || `Updated weather for ${buildPlaceLabel(location)}.`);
}

async function loadWeather(location) {
  const url = new URL(WEATHER_URL);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m"
  );
  url.searchParams.set("hourly", "temperature_2m,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "precipitation_sum,rain_sum,snowfall_sum,precipitation_hours");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_hours", "12");
  url.searchParams.set("forecast_days", "4");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Weather request failed.");
  }

  const data = await response.json();
  renderCurrentWeather(location, data);
  renderForecast(data);
  renderDailyTotals(data);
}

function renderCurrentWeather(location, data) {
  const current = data.current;

  elements.placeName.textContent = buildPlaceLabel(location);
  elements.summary.textContent = weatherCodeToText(current.weather_code);
  elements.temp.textContent = `${Math.round(current.temperature_2m)}${DEGREE_F}`;
  elements.wind.textContent = `${Math.round(current.wind_speed_10m)} mph`;
  elements.feelsLike.textContent = `${Math.round(current.apparent_temperature)}${DEGREE_F}`;
  elements.humidity.textContent = `${Math.round(current.relative_humidity_2m)}%`;
  elements.gusts.textContent = `${Math.round(current.wind_gusts_10m)} mph`;
  elements.updatedAt.textContent = `Updated ${formatDateTime(current.time)}`;
}

function renderForecast(data) {
  const times = data.hourly.time || [];
  const temps = data.hourly.temperature_2m || [];
  const winds = data.hourly.wind_speed_10m || [];
  const codes = data.hourly.weather_code || [];

  elements.forecast.innerHTML = "";

  times.slice(0, 12).forEach((time, index) => {
    const article = document.createElement("article");
    article.className = "forecast-item";
    article.innerHTML = `
      <p class="forecast-time">${formatHour(time)}</p>
      <p class="forecast-temp">${Math.round(temps[index])}${DEGREE_F}</p>
      <p class="forecast-wind">${Math.round(winds[index])} mph wind</p>
      <p class="forecast-desc">${weatherCodeToText(codes[index])}</p>
    `;
    elements.forecast.appendChild(article);
  });
}

function renderDailyTotals(data) {
  const dates = data.daily.time || [];
  const precipitation = data.daily.precipitation_sum || [];
  const rain = data.daily.rain_sum || [];
  const snow = data.daily.snowfall_sum || [];
  const hours = data.daily.precipitation_hours || [];

  elements.dailyTotals.innerHTML = "";

  dates.slice(0, 4).forEach((date, index) => {
    const article = document.createElement("article");
    article.className = "total-card";
    article.innerHTML = `
      <p class="total-day">${formatDayLabel(date, index)}</p>
      <p class="total-value">${formatDepth(precipitation[index])} total</p>
      <p class="total-subvalue">Rain ${formatDepth(rain[index])} | Snow ${formatDepth(snow[index])}</p>
      <p class="alert-meta">${Math.round(hours[index] || 0)} precip hour${Math.round(hours[index] || 0) === 1 ? "" : "s"}</p>
    `;
    elements.dailyTotals.appendChild(article);
  });
}

async function loadRadar(location) {
  const response = await fetch(RADAR_URL);
  if (!response.ok) {
    throw new Error("Radar request failed.");
  }

  const data = await response.json();
  state.radarHost = data.host || "https://tilecache.rainviewer.com";
  const frames = [
    ...(data.radar?.past || []),
    ...(data.radar?.nowcast || [])
  ];

  if (!frames.length) {
    elements.radarTime.textContent = "Radar frames are not available right now.";
    return;
  }

  state.radarFrames = frames;
  state.radarIndex = frames.length - 1;
  renderActiveMapLayer();
}

async function loadWarnings(location) {
  elements.alertsSummary.textContent = "Checking for active alerts";

  const url = new URL(NWS_ALERTS_URL);
  url.searchParams.set("point", `${location.latitude},${location.longitude}`);

  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json"
    }
  });

  if (response.status === 404 || response.status === 400) {
    renderWarnings([]);
    elements.alertsSummary.textContent = "Official alerts are not available for this location";
    clearAlertLayer();
    return;
  }

  if (!response.ok) {
    throw new Error("Weather alerts request failed.");
  }

  const data = await response.json();
  const features = Array.isArray(data.features) ? data.features : [];
  renderWarnings(features);
  renderAlertLayer(features);
}

function drawRadarFrame() {
  const frame = state.radarFrames[state.radarIndex];
  if (!frame) {
    return;
  }

  const snowOption = state.selectedLayer === "snow" ? "1" : "0";
  const tileUrl = `${state.radarHost}${frame.path}/256/{z}/{x}/{y}/6/1_${snowOption}.png`;

  if (radarLayer) {
    map.removeLayer(radarLayer);
  }

  radarLayer = L.tileLayer(tileUrl, {
    opacity: 0.72,
    maxZoom: 12,
    maxNativeZoom: 7,
    attribution: "&copy; RainViewer"
  }).addTo(map);

  elements.radarTime.textContent = state.selectedLayer === "snow"
    ? `Snow-highlight radar frame ${formatRadarTime(frame.time)}`
    : `Rain radar frame ${formatRadarTime(frame.time)}`;
}

function restartRadarAnimation() {
  clearInterval(state.radarFrameTimer);

  if (!state.radarAnimating || state.radarFrames.length < 2 || !isRadarMode()) {
    return;
  }

  state.radarFrameTimer = window.setInterval(() => {
    state.radarIndex = (state.radarIndex + 1) % state.radarFrames.length;
    drawRadarFrame();
  }, 1100);
}

function toggleRadarAnimation() {
  state.radarAnimating = !state.radarAnimating;
  elements.toggleRadar.textContent = state.radarAnimating ? "Pause Radar" : "Play Radar";

  if (state.radarAnimating && isRadarMode()) {
    restartRadarAnimation();
  } else {
    clearInterval(state.radarFrameTimer);
  }
}

function updateMapCenter(location) {
  if (!map) {
    return;
  }

  map.setView([location.latitude, location.longitude], Math.max(map.getZoom(), 8), {
    animate: true,
    duration: 1
  });
}

function updateShareLink(location) {
  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set("lat", location.latitude.toFixed(4));
  shareUrl.searchParams.set("lon", location.longitude.toFixed(4));
  shareUrl.searchParams.set("name", location.name);

  if (location.region) {
    shareUrl.searchParams.set("region", location.region);
  } else {
    shareUrl.searchParams.delete("region");
  }

  if (location.country) {
    shareUrl.searchParams.set("country", location.country);
  } else {
    shareUrl.searchParams.delete("country");
  }

  elements.shareUrl.value = shareUrl.toString();
  refreshShareHint();
}

async function shareCurrentLocation() {
  const url = elements.shareUrl.value;
  const label = buildPlaceLabel(state.currentLocation);

  if (!isPublicOrigin()) {
    setStatus("This link still points to your own device. Deploy the app to Netlify or GitHub Pages before sharing it publicly.");
  }

  if (navigator.share) {
    try {
      await navigator.share({
        title: `TownCast Weather: ${label}`,
        text: `Check the weather for ${label}.`,
        url
      });
      setStatus(`Shared the weather link for ${label}.`);
      return;
    } catch (error) {
      if (error.name !== "AbortError") {
        console.warn("Native share failed.", error);
      }
    }
  }

  await copyText(url);
  setStatus(`Copied the weather link for ${label}.`);
}

async function copyShareLink() {
  await copyText(elements.shareUrl.value);
  setStatus(
    isPublicOrigin()
      ? "Copied the shareable weather link."
      : "Copied the link, but it still points to your own device until the app is deployed."
  );
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  document.body.appendChild(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
}

function readLocationFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    name: params.get("name") || "Shared Location",
    region: params.get("region") || "",
    country: params.get("country") || "",
    latitude: lat,
    longitude: lon
  };
}

function buildPlaceLabel(location) {
  return [location.name, location.region, location.country].filter(Boolean).join(", ");
}

function weatherCodeToText(code) {
  return WEATHER_CODES[code] || "Weather update";
}

function isPublicOrigin() {
  const host = window.location.hostname;
  return !["localhost", "127.0.0.1", ""].includes(host);
}

function refreshShareHint() {
  if (!elements.shareHint) {
    return;
  }

  elements.shareHint.textContent = isPublicOrigin()
    ? "This is a public share link. Anyone with the URL can open the same town view."
    : "This link only works on your device right now because the app is still running on localhost. Deploy it to Netlify or GitHub Pages for public sharing.";
}

function isRadarMode() {
  return state.selectedLayer === "radar" || state.selectedLayer === "snow";
}

function setLayerMode(layer) {
  state.selectedLayer = layer;

  elements.layerButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.layer === layer);
  });

  const usingLightning = layer === "lightning";
  const usingTemperature = layer === "temperature";

  elements.lightningMap.classList.toggle("hidden", !usingLightning);
  elements.mapElement.classList.toggle("hidden", usingLightning);
  elements.tempLegend.classList.toggle("hidden", !usingTemperature);

  if (usingLightning) {
    clearInterval(state.radarFrameTimer);
    elements.toggleRadar.disabled = true;
    elements.toggleRadar.style.opacity = "0.6";
    elements.radarTime.textContent = "Live lightning map from Blitzortung updates inside the embed.";
    elements.mapDescription.textContent = "Lightning mode uses Blitzortung's live community map centered on the selected town.";
    elements.mapAttribution.textContent = "Lightning data from Blitzortung / LightningMaps. Community project for informational use.";
    if (radarLayer) {
      map.removeLayer(radarLayer);
      radarLayer = null;
    }
    clearTemperatureCanvas();
    return;
  }

  elements.toggleRadar.disabled = !isRadarMode();
  elements.toggleRadar.style.opacity = elements.toggleRadar.disabled ? "0.6" : "1";
  elements.mapDescription.textContent = usingTemperature
    ? "Temperature mode blends live readings into a smoother heatmap so you can compare nearby areas at a glance."
    : "Radar overlay refreshes automatically and follows the selected town. You can zoom in closer to streets and neighborhoods now.";
  elements.mapAttribution.textContent = usingTemperature
    ? "Base map by OpenStreetMap contributors. Temperature samples from Open-Meteo."
    : "Base map by OpenStreetMap contributors. Radar data from RainViewer.";

  renderActiveMapLayer();

  window.setTimeout(() => {
    map.invalidateSize();
  }, 120);
}

function renderActiveMapLayer() {
  elements.mapElement.classList.remove("hidden");
  elements.lightningMap.classList.add("hidden");

  if (state.selectedLayer === "temperature") {
    if (radarLayer) {
      map.removeLayer(radarLayer);
      radarLayer = null;
    }
    clearInterval(state.radarFrameTimer);
    loadTemperatureOverlay().catch((error) => {
      console.error(error);
      elements.radarTime.textContent = "Temperature map could not refresh right now.";
    });
    return;
  }

  clearTemperatureCanvas();
  elements.tempLegend.classList.add("hidden");
  drawRadarFrame();
  restartRadarAnimation();
  bringAlertLayerToFront();
}

function handleMapViewportChanged() {
  if (state.selectedLayer === "temperature") {
    loadTemperatureOverlay().catch((error) => {
      console.error(error);
      elements.radarTime.textContent = "Temperature map could not refresh right now.";
    });
  }
}

async function loadTemperatureOverlay() {
  const token = ++state.temperatureRequestToken;
  const bounds = map.getBounds();
  const zoom = map.getZoom();
  const rows = zoom >= 9 ? 5 : 4;
  const cols = zoom >= 9 ? 6 : 5;
  const latitudes = [];
  const longitudes = [];

  for (let row = 0; row < rows; row += 1) {
    const rowRatio = rows === 1 ? 0.5 : row / (rows - 1);
    const latitude = bounds.getNorth() - ((bounds.getNorth() - bounds.getSouth()) * rowRatio);

    for (let col = 0; col < cols; col += 1) {
      const colRatio = cols === 1 ? 0.5 : col / (cols - 1);
      const longitude = bounds.getWest() + ((bounds.getEast() - bounds.getWest()) * colRatio);
      latitudes.push(latitude.toFixed(4));
      longitudes.push(longitude.toFixed(4));
    }
  }

  const url = new URL(WEATHER_URL);
  url.searchParams.set("latitude", latitudes.join(","));
  url.searchParams.set("longitude", longitudes.join(","));
  url.searchParams.set("current", "temperature_2m");
  url.searchParams.set("temperature_unit", "fahrenheit");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Temperature overlay request failed.");
  }

  const payload = await response.json();
  if (token !== state.temperatureRequestToken || state.selectedLayer !== "temperature") {
    return;
  }

  const samples = Array.isArray(payload) ? payload : [payload];
  const points = samples
    .map((sample) => ({
      latitude: sample.latitude,
      longitude: sample.longitude,
      temperature: sample.current?.temperature_2m
    }))
    .filter((sample) => Number.isFinite(sample.temperature));

  clearTemperatureCanvas();

  if (!points.length) {
    elements.radarTime.textContent = "Temperature samples are not available right now.";
    return;
  }

  const temps = points.map((point) => point.temperature);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  drawTemperatureHeatmap(points, minTemp, maxTemp, zoom);

  elements.tempLegend.classList.remove("hidden");
  elements.tempLegendLow.textContent = `${Math.round(minTemp)}${DEGREE_F}`;
  elements.tempLegendHigh.textContent = `${Math.round(maxTemp)}${DEGREE_F}`;
  elements.radarTime.textContent = `Temperature heatmap updated at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function temperatureColor(value, minTemp, maxTemp) {
  const span = Math.max(1, maxTemp - minTemp);
  const ratio = Math.min(1, Math.max(0, (value - minTemp) / span));

  if (ratio < 0.2) {
    return "#2f67ff";
  }
  if (ratio < 0.4) {
    return "#3db9ff";
  }
  if (ratio < 0.6) {
    return "#62f0c0";
  }
  if (ratio < 0.8) {
    return "#ffc857";
  }
  return "#ff6b4a";
}

function updateLightningEmbed(location) {
  const hashZoom = Math.min(8, Math.max(5, map ? map.getZoom() : 7));
  const url = new URL(LIGHTNING_EMBED_URL);
  url.searchParams.set("interactive", "1");
  url.searchParams.set("NavigationControl", "1");
  url.searchParams.set("FullScreenControl", "0");
  url.searchParams.set("Cookies", "0");
  url.searchParams.set("InfoDiv", "0");
  url.searchParams.set("ScaleControl", "1");
  url.searchParams.set("Advertisment", "0");
  url.searchParams.set("MenuButtonDiv", "0");
  url.searchParams.set("MapStyle", "2");
  url.searchParams.set("MapStyleRangeValue", "10");
  url.searchParams.set("LightningCheckboxChecked", "1");
  url.searchParams.set("LightningRangeValue", "11");
  url.hash = `#${hashZoom}/${location.latitude.toFixed(3)}/${location.longitude.toFixed(3)}`;
  elements.lightningMap.src = url.toString();
}

function initializeAlertLayer() {
  alertLayer = L.geoJSON(null, {
    style: (feature) => ({
      color: alertColor(feature?.properties?.severity),
      weight: 3,
      opacity: 0.9,
      fillColor: alertColor(feature?.properties?.severity),
      fillOpacity: 0.12
    }),
    onEachFeature: (feature, layer) => {
      const properties = feature.properties || {};
      layer.bindPopup(`
        <strong>${escapeHtml(properties.event || "Weather Alert")}</strong><br>
        ${escapeHtml(properties.severity || "Unknown severity")}<br>
        ${escapeHtml(properties.headline || "")}
      `);
    }
  }).addTo(map);
}

function renderWarnings(features) {
  elements.alertsList.innerHTML = "";

  if (!features.length) {
    const empty = document.createElement("div");
    empty.className = "alerts-empty";
    empty.textContent = "No active official weather warnings for this town right now.";
    elements.alertsList.appendChild(empty);
    elements.alertsSummary.textContent = "No active alerts";
    return;
  }

  const sorted = [...features].sort((left, right) => {
    return severityRank(right.properties?.severity) - severityRank(left.properties?.severity);
  });

  elements.alertsSummary.textContent = `${sorted.length} active alert${sorted.length === 1 ? "" : "s"}`;

  sorted.forEach((feature) => {
    const properties = feature.properties || {};
    const card = document.createElement("article");
    const severityClass = alertSeverityClass(properties.severity);
    card.className = `alert-card ${severityClass}`;
    card.innerHTML = `
      <p class="alert-meta">${escapeHtml(properties.severity || "Alert")} | ${escapeHtml(properties.urgency || "Unknown urgency")}</p>
      <h3 class="alert-title">${escapeHtml(properties.event || "Weather Alert")}</h3>
      <p class="alert-desc">${escapeHtml((properties.headline || properties.description || "").slice(0, 220) || "Official weather alert in effect.")}</p>
    `;
    elements.alertsList.appendChild(card);
  });
}

function renderAlertLayer(features) {
  if (!alertLayer) {
    return;
  }

  clearAlertLayer();
  const mappableFeatures = features.filter((feature) => feature.geometry);
  alertLayer.addData(mappableFeatures);
  bringAlertLayerToFront();
}

function clearAlertLayer() {
  if (alertLayer) {
    alertLayer.clearLayers();
  }
}

function bringAlertLayerToFront() {
  if (alertLayer) {
    alertLayer.bringToFront();
  }
}

function alertColor(severity) {
  switch ((severity || "").toLowerCase()) {
    case "extreme":
      return "#ff3b30";
    case "severe":
      return "#ff6b4a";
    case "moderate":
      return "#ffc857";
    default:
      return "#63d2ff";
  }
}

function alertSeverityClass(severity) {
  switch ((severity || "").toLowerCase()) {
    case "extreme":
    case "severe":
      return "severe";
    case "moderate":
      return "moderate";
    default:
      return "minor";
  }
}

function severityRank(severity) {
  switch ((severity || "").toLowerCase()) {
    case "extreme":
      return 4;
    case "severe":
      return 3;
    case "moderate":
      return 2;
    case "minor":
      return 1;
    default:
      return 0;
  }
}

function formatDepth(value) {
  return `${Number(value || 0).toFixed(2)} in`;
}

function formatDayLabel(dateValue, index) {
  if (index === 0) {
    return "Today";
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function initializeTemperatureCanvas() {
  const overlayPane = map.getPanes().overlayPane;
  temperatureCanvas = L.DomUtil.create("canvas", "temperature-heatmap", overlayPane);
  temperatureCanvasContext = temperatureCanvas.getContext("2d");
  temperatureCanvas.setAttribute("aria-hidden", "true");
  resizeTemperatureCanvas();
}

function resizeTemperatureCanvas() {
  if (!temperatureCanvas || !map) {
    return;
  }

  const size = map.getSize();
  temperatureCanvas.width = size.x;
  temperatureCanvas.height = size.y;
  temperatureCanvas.style.width = `${size.x}px`;
  temperatureCanvas.style.height = `${size.y}px`;
  temperatureCanvas.style.left = "0";
  temperatureCanvas.style.top = "0";
}

function clearTemperatureCanvas() {
  if (!temperatureCanvasContext || !temperatureCanvas) {
    return;
  }

  temperatureCanvasContext.clearRect(0, 0, temperatureCanvas.width, temperatureCanvas.height);
}

function drawTemperatureHeatmap(points, minTemp, maxTemp, zoom) {
  if (!temperatureCanvasContext) {
    return;
  }

  resizeTemperatureCanvas();
  clearTemperatureCanvas();

  const radius = Math.max(48, Math.min(110, zoom * 10));
  const context = temperatureCanvasContext;

  points.forEach((point) => {
    const position = map.latLngToContainerPoint([point.latitude, point.longitude]);
    const color = temperatureColor(point.temperature, minTemp, maxTemp);
    const gradient = context.createRadialGradient(
      position.x,
      position.y,
      radius * 0.12,
      position.x,
      position.y,
      radius
    );

    gradient.addColorStop(0, withAlpha(color, 0.34));
    gradient.addColorStop(0.45, withAlpha(color, 0.22));
    gradient.addColorStop(1, withAlpha(color, 0));

    context.fillStyle = gradient;
    context.beginPath();
    context.arc(position.x, position.y, radius, 0, Math.PI * 2);
    context.fill();
  });

  context.save();
  context.globalCompositeOperation = "source-over";
  points.forEach((point) => {
    const position = map.latLngToContainerPoint([point.latitude, point.longitude]);
    context.fillStyle = "rgba(244, 251, 255, 0.78)";
    context.beginPath();
    context.arc(position.x, position.y, 2.5, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

function withAlpha(hexColor, alpha) {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatHour(dateTime) {
  const [, timePart = "00:00"] = dateTime.split("T");
  const [hourValueRaw, minuteRaw] = timePart.split(":");
  const hourValue = Number(hourValueRaw);
  const minute = Number(minuteRaw);
  const hour12 = ((hourValue + 11) % 12) + 1;
  const suffix = hourValue >= 12 ? "PM" : "AM";

  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatDateTime(dateTime) {
  const [datePart = "0000-00-00"] = dateTime.split("T");
  const [, monthRaw = "0", dayRaw = "0"] = datePart.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIndex = Math.max(0, Number(monthRaw) - 1);

  return `${months[monthIndex]} ${Number(dayRaw)}, ${formatHour(dateTime)}`;
}

function formatRadarTime(unixSeconds) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(unixSeconds * 1000));
}

function setStatus(message) {
  elements.status.textContent = message;
}

function startAutoRefresh() {
  clearInterval(state.weatherTimer);
  clearInterval(state.radarTimer);

  state.weatherTimer = window.setInterval(() => {
    Promise.allSettled([
      loadWeather(state.currentLocation),
      loadWarnings(state.currentLocation)
    ]).then((results) => {
      if (results[0].status === "rejected") {
        console.error(results[0].reason);
        setStatus("Weather refresh failed. The app will try again automatically.");
      }
      if (results[1].status === "rejected") {
        console.warn(results[1].reason);
      }
    });
  }, 5 * 60 * 1000);

  state.radarTimer = window.setInterval(() => {
    loadRadar(state.currentLocation).catch((error) => {
      console.error(error);
      elements.radarTime.textContent = "Radar refresh failed. Trying again soon.";
    });
  }, 2 * 60 * 1000);
}
