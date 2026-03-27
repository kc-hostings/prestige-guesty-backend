import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
app.use(
  cors({
    origin: FRONTEND_ORIGIN === "*" ? true : FRONTEND_ORIGIN,
    credentials: false,
  })
);

const PORT = Number(process.env.PORT || 10000);
const APP_VERSION = process.env.APP_VERSION || "local-dev";

// ---------------------------------------------------
// GUESTY CONFIG
// ---------------------------------------------------

const TOKEN_URL = "https://booking.guesty.com/oauth2/token";
const API_BASE_URL = "https://booking.guesty.com/api";
const OPEN_API_BASE_URL = "https://open-api.guesty.com/v1";

const LISTINGS_URL = `${API_BASE_URL}/listings`;
const CITIES_URL = `${LISTINGS_URL}/cities`;
const OPEN_API_CALENDAR_URL = `${OPEN_API_BASE_URL}/availability-pricing/api/calendar/listings`;
const QUOTE_URL = `${API_BASE_URL}/reservations/quotes`;

const BOOKING_BASE_URL = process.env.GUESTY_BOOKING_BASE_URL || "";

const LISTING_IDS = {
  multi: {
    deluxe: process.env.GUESTY_MULTI_DELUXE || "",
    maisonette: process.env.GUESTY_MULTI_MAISONETTE || "",
    premium: process.env.GUESTY_MULTI_PREMIUM || "",
    standard: process.env.GUESTY_MULTI_STANDARD || "",
    superior: process.env.GUESTY_MULTI_SUPERIOR || "",
  },
  units: {
    deluxe2: process.env.GUESTY_UNIT_DELUXE_2 || "",
    deluxe4: process.env.GUESTY_UNIT_DELUXE_4 || "",
    maisonette8: process.env.GUESTY_UNIT_MAISONETTE_8 || "",
    premium6: process.env.GUESTY_UNIT_PREMIUM_6 || "",
    standard3: process.env.GUESTY_UNIT_STANDARD_3 || "",
    superior5: process.env.GUESTY_UNIT_SUPERIOR_5 || "",
    superior7: process.env.GUESTY_UNIT_SUPERIOR_7 || "",
  },
};

const CATEGORY_META = {
  standard: {
    title: "Standard Apartment",
    capacityMax: 4,
    sortOrder: 1,
  },
  deluxe: {
    title: "Deluxe Apartments",
    capacityMax: 4,
    sortOrder: 2,
  },
  superior: {
    title: "Superior Apartments",
    capacityMax: 8,
    sortOrder: 3,
  },
  premium: {
    title: "Premium Apartment",
    capacityMax: 7,
    sortOrder: 4,
  },
  maisonette: {
    title: "Maisonette Apartment",
    capacityMax: 10,
    sortOrder: 5,
  },
};

let tokenCache = {
  value: null,
  expiresAt: 0,
};

let tokenPromise = null;

// ---------------------------------------------------
// HELPERS
// ---------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAllListingIds() {
  return [
    ...Object.values(LISTING_IDS.multi).filter(Boolean),
    ...Object.values(LISTING_IDS.units).filter(Boolean),
  ].map(String);
}

function findListingIdByKey(key) {
  if (!key) return null;
  if (LISTING_IDS.multi[key]) return LISTING_IDS.multi[key];
  if (LISTING_IDS.units[key]) return LISTING_IDS.units[key];
  return null;
}

function mapUnitKeyToCategory(unitKey) {
  if (!unitKey) return null;
  if (unitKey.startsWith("deluxe")) return "deluxe";
  if (unitKey.startsWith("standard")) return "standard";
  if (unitKey.startsWith("superior")) return "superior";
  if (unitKey.startsWith("premium")) return "premium";
  if (unitKey.startsWith("maisonette")) return "maisonette";
  return null;
}

function buildUrl(base, query = {}) {
  const url = new URL(base);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .trim();
}

function inferCategoryKeyFromListing(listing) {
  const rawId = String(listing?._id || listing?.id || listing?.listingId || "");

  const matchMulti = Object.entries(LISTING_IDS.multi).find(
    ([, listingId]) => String(listingId) === rawId
  );
  if (matchMulti) return matchMulti[0];

  const matchUnit = Object.entries(LISTING_IDS.units).find(
    ([, listingId]) => String(listingId) === rawId
  );
  if (matchUnit) return mapUnitKeyToCategory(matchUnit[0]);

  const title = normalizeText(
    listing?.title ||
      listing?.name ||
      listing?.nickname ||
      listing?.publicDescription?.summary ||
      ""
  );

  if (title.includes("standard")) return "standard";
  if (title.includes("deluxe")) return "deluxe";
  if (title.includes("superior")) return "superior";
  if (title.includes("premium")) return "premium";
  if (title.includes("maisonette")) return "maisonette";

  if (title.includes("apartment 2") || title.includes("#2")) return "deluxe";
  if (title.includes("apartment 3") || title.includes("#3")) return "standard";
  if (title.includes("apartment 4") || title.includes("#4")) return "deluxe";
  if (title.includes("apartment 5") || title.includes("#5")) return "superior";
  if (title.includes("apartment 6") || title.includes("#6")) return "premium";
  if (title.includes("apartment 7") || title.includes("#7")) return "superior";
  if (title.includes("apartment 8") || title.includes("#8")) return "maisonette";

  return null;
}

function inferUnitKeyFromListing(listing) {
  const rawId = String(listing?._id || listing?.id || listing?.listingId || "");

  const matchUnit = Object.entries(LISTING_IDS.units).find(
    ([, listingId]) => String(listingId) === rawId
  );
  if (matchUnit) return matchUnit[0];

  const title = normalizeText(
    listing?.title ||
      listing?.name ||
      listing?.nickname ||
      listing?.publicDescription?.summary ||
      ""
  );

  if (title.includes("apartment 2") || title.includes("#2")) return "deluxe2";
  if (title.includes("apartment 3") || title.includes("#3")) return "standard3";
  if (title.includes("apartment 4") || title.includes("#4")) return "deluxe4";
  if (title.includes("apartment 5") || title.includes("#5")) return "superior5";
  if (title.includes("apartment 6") || title.includes("#6")) return "premium6";
  if (title.includes("apartment 7") || title.includes("#7")) return "superior7";
  if (title.includes("apartment 8") || title.includes("#8")) return "maisonette8";

  return null;
}

function normalizePicture(listing) {
  const picture = listing?.picture;

  if (typeof picture === "string") return picture;
  if (picture?.original) return picture.original;
  if (picture?.regular) return picture.regular;
  if (picture?.thumbnail) return picture.thumbnail;

  const first = Array.isArray(listing?.pictures) ? listing.pictures[0] : null;
  if (first?.original) return first.original;
  if (first?.regular) return first.regular;
  if (first?.thumbnail) return first.thumbnail;

  if (listing?.mainPicture?.original) return listing.mainPicture.original;
  if (listing?.mainPicture?.regular) return listing.mainPicture.regular;
  if (listing?.mainPicture?.thumbnail) return listing.mainPicture.thumbnail;
  if (typeof listing?.mainPicture === "string") return listing.mainPicture;

  return null;
}

function buildBookingUrl(id) {
  if (!BOOKING_BASE_URL || !id) return null;
  return `${BOOKING_BASE_URL.replace(/\/$/, "")}/${id}`;
}

function normalizeListing(listing, sourceType = null, requestedKey = null) {
  const rawId = listing?._id || listing?.id || listing?.listingId;
  const id = rawId ? String(rawId) : null;

  const title =
    listing?.title ||
    listing?.name ||
    listing?.nickname ||
    listing?.publicDescription?.summary ||
    "Apartment";

  const unitKey = inferUnitKeyFromListing(listing);
  const categoryKey = requestedKey || inferCategoryKeyFromListing(listing);
  const categoryMeta = categoryKey ? CATEGORY_META[categoryKey] || null : null;

  return {
    id,
    unitKey: unitKey || null,
    title,
    picture: normalizePicture(listing),
    capacity:
      listing?.accommodates ??
      listing?.occupancy ??
      listing?.maxGuests ??
      listing?.guests ??
      categoryMeta?.capacityMax ??
      null,
    bedrooms: listing?.bedrooms ?? null,
    bathrooms: listing?.bathrooms ?? null,
    categoryKey: categoryKey || null,
    categoryTitle: categoryMeta?.title || null,
    bookingUrl: buildBookingUrl(id),
    sourceType,
    raw: listing,
  };
}

function parseArrayResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.listings)) return data.listings;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function sortByCategory(a, b) {
  const orderA = CATEGORY_META[a.categoryKey]?.sortOrder || 999;
  const orderB = CATEGORY_META[b.categoryKey]?.sortOrder || 999;
  return orderA - orderB;
}

function uniqueByCategory(listings) {
  const seen = new Set();
  const result = [];

  for (const item of listings) {
    const key = item.categoryKey || item.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function resolveListingIdForCalendar({ unit, category }) {
  if (unit && LISTING_IDS.units[unit]) {
    return String(LISTING_IDS.units[unit]);
  }

  if (category && LISTING_IDS.multi[category]) {
    return String(LISTING_IDS.multi[category]);
  }

  return null;
}

function normalizeCalendarDay(day) {
  const date =
    day?.date ||
    day?._id ||
    day?.day ||
    day?.calendarDate ||
    null;

  const blocks = day?.blocks || {};
  const unavailable =
    Boolean(day?.available === false) ||
    Boolean(day?.isAvailable === false) ||
    Boolean(blocks?.r) ||
    Boolean(blocks?.b) ||
    Boolean(blocks?.m) ||
    Boolean(blocks?.bd) ||
    Boolean(blocks?.sr) ||
    Boolean(blocks?.abl) ||
    Boolean(blocks?.a) ||
    Boolean(blocks?.bw) ||
    Boolean(blocks?.o) ||
    Boolean(blocks?.pt) ||
    Boolean(blocks?.ic) ||
    Boolean(blocks?.an);

  const nightlyPrice =
    day?.price ??
    day?.nightlyRate ??
    day?.nightPrice ??
    day?.rate ??
    day?.baseRate ??
    null;

  return {
    date,
    available: !unavailable,
    unavailable,
    price: nightlyPrice,
    blocks,
    raw: day,
  };
}

// ---------------------------------------------------
// TOKEN / FETCH
// ---------------------------------------------------

async function getAccessToken() {
  const now = Date.now();

  if (tokenCache.value && tokenCache.expiresAt > now) {
    return tokenCache.value;
  }

  if (tokenPromise) {
    return tokenPromise;
  }

  tokenPromise = (async () => {
    const clientId = requireEnv("GUESTY_CLIENT_ID").trim();
    const clientSecret = requireEnv("GUESTY_CLIENT_SECRET").trim();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const body = new URLSearchParams();
      body.append("grant_type", "client_credentials");
      body.append("scope", "booking_engine:api");
      body.append("client_id", clientId);
      body.append("client_secret", clientSecret);

      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "cache-control": "no-cache,no-cache",
        },
        body: body.toString(),
      });

      const text = await response.text();

      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (response.ok && data?.access_token) {
        tokenCache.value = data.access_token;
        const expiresInMs = Math.max(
          ((data.expires_in || 3600) - 300) * 1000,
          10 * 60 * 1000
        );
        tokenCache.expiresAt = Date.now() + expiresInMs;
        return tokenCache.value;
      }

      if (response.status === 429 && attempt < 3) {
        await sleep(attempt * 3000);
        continue;
      }

      throw new Error(
        `No access token received: ${data ? JSON.stringify(data) : text}`
      );
    }

    throw new Error("No access token received after retries");
  })();

  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
}

async function guestyFetch(url) {
  const token = await getAccessToken();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Guesty request failed: ${response.status} ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, raw: text };
  }
}

async function guestyFetchSafe(url) {
  try {
    const data = await guestyFetch(url);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Unknown Guesty error",
    };
  }
}

async function guestyOpenApiFetch(url) {
  const token = await getAccessToken();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Guesty Open API request failed: ${response.status} ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, raw: text };
  }
}

async function guestyOpenApiFetchSafe(url) {
  try {
    const data = await guestyOpenApiFetch(url);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Unknown Guesty Open API error",
    };
  }
}

async function guestyBookingApiPost(url, payload) {
  const token = await getAccessToken();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Guesty Booking API POST failed: ${response.status} ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, raw: text };
  }
}

// ---------------------------------------------------
// AVAILABILITY HELPERS
// ---------------------------------------------------

async function getAvailableUnits({ checkin, checkout, occupancy, requestedCategory }) {
  const allRelevantListingIds = new Set(getAllListingIds());

  const url = buildUrl(LISTINGS_URL, {
    checkIn: checkin,
    checkOut: checkout,
  });

  const result = await guestyFetchSafe(url);

  if (!result.ok) {
    throw new Error(result.error);
  }

  const items = parseArrayResponse(result.data);
  const filtered = [];

  for (const item of items) {
    const rawId = String(item?._id || item?.id || item?.listingId || "");
    if (!allRelevantListingIds.has(rawId)) continue;

    const unitKey = inferUnitKeyFromListing(item);
    const categoryKey = inferCategoryKeyFromListing(item);
    if (!categoryKey) continue;

    const categoryMeta = CATEGORY_META[categoryKey];
    if (!categoryMeta) continue;

    if (requestedCategory && categoryKey !== requestedCategory) continue;
    if (occupancy > categoryMeta.capacityMax) continue;

    filtered.push({
      ...normalizeListing(item, "unit-availability", categoryKey),
      unitKey,
    });
  }

  return filtered;
}

// ---------------------------------------------------
// REQUEST LOGGER
// ---------------------------------------------------

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ---------------------------------------------------
// ROOT / INFO ROUTES
// ---------------------------------------------------

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "prestige-apartments-guesty-backend",
    version: APP_VERSION,
    routes: [
      "/",
      "/api/health",
      "/api/routes",
      "/api/test-connection",
      "/api/test-token",
      "/api/test-listings-api",
      "/api/listing-ids",
      "/api/cities",
      "/api/listings",
      "/api/listings/:listingId",
      "/api/category/:key",
      "/api/prestige-listings",
      "/api/availability",
      "/api/availability-search",
      "/api/category-suggestions",
      "/api/calendar",
      "/api/quote",
      "/api/debug-env",
    ],
  });
});

app.get("/api/routes", (_req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    routes: [
      "/api/health",
      "/api/routes",
      "/api/test-connection",
      "/api/test-token",
      "/api/test-listings-api",
      "/api/listing-ids",
      "/api/cities",
      "/api/listings",
      "/api/listings/:listingId",
      "/api/category/:key",
      "/api/prestige-listings",
      "/api/availability",
      "/api/availability-search",
      "/api/category-suggestions",
      "/api/calendar",
      "/api/quote",
      "/api/debug-env",
    ],
  });
});

// ---------------------------------------------------
// TEST ROUTES
// ---------------------------------------------------

app.get("/api/test-connection", async (_req, res) => {
  try {
    const response = await fetch("https://booking.guesty.com");
    res.json({ ok: true, status: response.status });
  } catch (e) {
    res.json({ ok: false, error: e?.message || "Unknown error" });
  }
});

app.get("/api/test-token", async (_req, res) => {
  try {
    const token = await getAccessToken();
    res.json({
      ok: true,
      tokenReceived: Boolean(token),
      tokenPreview: `${token.slice(0, 12)}...`,
      cachedUntil: tokenCache.expiresAt,
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e?.message || "Unknown error",
    });
  }
});

app.get("/api/test-listings-api", async (_req, res) => {
  try {
    const data = await guestyFetch(LISTINGS_URL);
    res.json({
      ok: true,
      received: Array.isArray(data) ? data.length : parseArrayResponse(data).length,
      data,
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e?.message || null,
      name: e?.name || null,
    });
  }
});

// ---------------------------------------------------
// BASIC ROUTES
// ---------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "prestige-apartments-guesty-backend",
    version: APP_VERSION,
    frontendOrigin: FRONTEND_ORIGIN,
    bookingBaseUrlConfigured: Boolean(BOOKING_BASE_URL),
    listingIdsLoaded: LISTING_IDS,
  });
});

app.get("/api/listing-ids", (_req, res) => {
  res.json({
    ok: true,
    listingIds: LISTING_IDS,
    allListingIds: getAllListingIds(),
  });
});

// ---------------------------------------------------
// GUESTY DATA ROUTES
// ---------------------------------------------------

app.get("/api/cities", async (_req, res) => {
  try {
    const data = await guestyFetch(CITIES_URL);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/listings", async (req, res) => {
  try {
    const url = buildUrl(LISTINGS_URL, req.query);
    const data = await guestyFetch(url);

    res.json({
      ok: true,
      count: parseArrayResponse(data).length,
      data,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/listings/:listingId", async (req, res) => {
  try {
    const listingId = req.params.listingId;
    const data = await guestyFetch(`${LISTINGS_URL}/${listingId}`);

    res.json({
      ok: true,
      listingId,
      data,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

// ---------------------------------------------------
// CATEGORY ROUTE
// ---------------------------------------------------

app.get("/api/category/:key", async (req, res) => {
  try {
    const key = req.params.key;
    const listingId = findListingIdByKey(key);

    if (!listingId) {
      return res.status(404).json({
        ok: false,
        error: `Unknown category/listing key: ${key}`,
      });
    }

    const data = await guestyFetch(`${LISTINGS_URL}/${listingId}`);

    res.json({
      ok: true,
      key,
      listingId,
      data: normalizeListing(data, "category", key),
      raw: data,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

// ---------------------------------------------------
// PRESTIGE LISTINGS
// ---------------------------------------------------

app.get("/api/prestige-listings", async (_req, res) => {
  try {
    const entries = [];

    for (const [key, listingId] of Object.entries(LISTING_IDS.multi)) {
      if (!listingId) continue;

      const result = await guestyFetchSafe(`${LISTINGS_URL}/${listingId}`);

      if (result.ok) {
        entries.push({
          ok: true,
          type: "multi",
          key,
          listingId,
          data: normalizeListing(result.data, "multi", key),
          raw: result.data,
        });
      } else {
        entries.push({
          ok: false,
          type: "multi",
          key,
          listingId,
          error: result.error,
        });
      }
    }

    for (const [key, listingId] of Object.entries(LISTING_IDS.units)) {
      if (!listingId) continue;

      const result = await guestyFetchSafe(`${LISTINGS_URL}/${listingId}`);

      if (result.ok) {
        entries.push({
          ok: true,
          type: "unit",
          key,
          listingId,
          data: normalizeListing(result.data, "unit", key),
          raw: result.data,
        });
      } else {
        entries.push({
          ok: false,
          type: "unit",
          key,
          listingId,
          error: result.error,
        });
      }
    }

    res.json({
      ok: true,
      count: entries.length,
      successCount: entries.filter((item) => item.ok).length,
      errorCount: entries.filter((item) => !item.ok).length,
      entries,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

// ---------------------------------------------------
// AVAILABILITY / SUGGESTIONS
// ---------------------------------------------------

async function handleAvailabilityRequest(req, res) {
  try {
    const {
      checkin,
      checkout,
      guests,
      category,
      unit,
      location,
    } = req.query;

    if (!checkin || !checkout) {
      return res.status(400).json({
        ok: false,
        error: "checkin and checkout are required",
      });
    }

    const requestedGuests = Number(guests || 1);
    const occupancy =
      Number.isFinite(requestedGuests) && requestedGuests > 0
        ? requestedGuests
        : 1;

    const requestedCategory = category ? String(category).toLowerCase() : "";
    const requestedUnit = unit ? String(unit).toLowerCase() : "";

    if (requestedUnit && !LISTING_IDS.units[requestedUnit]) {
      return res.status(404).json({
        ok: false,
        error: `Unknown unit key: ${requestedUnit}`,
      });
    }

    const liveResults = await getAvailableUnits({
      checkin,
      checkout,
      occupancy,
      requestedCategory: requestedUnit
        ? mapUnitKeyToCategory(requestedUnit)
        : requestedCategory,
    });

    if (requestedUnit) {
      const requestedListingId = String(LISTING_IDS.units[requestedUnit]);
      const requestedCategoryKey = mapUnitKeyToCategory(requestedUnit);
      const categoryMeta = CATEGORY_META[requestedCategoryKey] || null;

      if (categoryMeta && occupancy > categoryMeta.capacityMax) {
        return res.json({
          ok: true,
          mode: "unit-availability",
          available: false,
          location: location || "reutlingen",
          checkin,
          checkout,
          guests: occupancy,
          unit: requestedUnit,
          listingId: requestedListingId,
          reason: `Maximale Belegung überschritten. Diese Unit ist für bis zu ${categoryMeta.capacityMax} Gäste ausgelegt.`,
          result: null,
          bookingUrl: buildBookingUrl(requestedListingId),
        });
      }

      const matchedUnit = liveResults.find(
        (item) => String(item.id) === requestedListingId || item.unitKey === requestedUnit
      );

      return res.json({
        ok: true,
        mode: "unit-availability",
        available: Boolean(matchedUnit),
        location: location || "reutlingen",
        checkin,
        checkout,
        guests: occupancy,
        unit: requestedUnit,
        listingId: requestedListingId,
        bookingUrl: matchedUnit?.bookingUrl || buildBookingUrl(requestedListingId),
        result: matchedUnit || null,
        reason: matchedUnit ? null : "Dieser Zeitraum ist für das gewünschte Apartment aktuell nicht verfügbar.",
      });
    }

    const finalResults = uniqueByCategory(liveResults).sort(sortByCategory);

    res.json({
      ok: true,
      mode: "category-availability",
      location: location || "reutlingen",
      checkin,
      checkout,
      guests: occupancy,
      category: requestedCategory || null,
      count: finalResults.length,
      results: finalResults,
      rawCount: liveResults.length,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
}

app.get("/api/availability", handleAvailabilityRequest);
app.get("/api/availability-search", handleAvailabilityRequest);
app.get("/api/category-suggestions", handleAvailabilityRequest);

// ---------------------------------------------------
// CALENDAR ROUTE
// ---------------------------------------------------

app.get("/api/calendar", async (req, res) => {
  try {
    const { unit, category, startDate, endDate, includeAllotment } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        ok: false,
        error: "startDate and endDate are required",
      });
    }

    const listingId = resolveListingIdForCalendar({
      unit: unit ? String(unit).toLowerCase() : "",
      category: category ? String(category).toLowerCase() : "",
    });

    if (!listingId) {
      return res.status(404).json({
        ok: false,
        error: "Unknown or missing unit/category for calendar route",
      });
    }

    const url = buildUrl(`${OPEN_API_CALENDAR_URL}/${listingId}`, {
      startDate,
      endDate,
      includeAllotment: includeAllotment ?? "true",
    });

    const result = await guestyOpenApiFetchSafe(url);

    if (!result.ok) {
      throw new Error(result.error);
    }

    const rawDays = Array.isArray(result.data)
      ? result.data
      : Array.isArray(result.data?.days)
      ? result.data.days
      : Array.isArray(result.data?.results)
      ? result.data.results
      : [];

    const days = rawDays
      .map(normalizeCalendarDay)
      .filter((d) => d.date);

    res.json({
      ok: true,
      listingId,
      unit: unit || null,
      category: category || null,
      startDate,
      endDate,
      count: days.length,
      days,
      raw: result.data,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

// ---------------------------------------------------
// QUOTE ROUTE
// ---------------------------------------------------

app.post("/api/quote", async (req, res) => {
  try {
    const {
      unit,
      category,
      checkin,
      checkout,
      guests,
      adults,
      children,
      infants,
    } = req.body || {};

    if (!checkin || !checkout) {
      return res.status(400).json({
        ok: false,
        error: "checkin and checkout are required",
      });
    }

    const listingId = resolveListingIdForCalendar({
      unit: unit ? String(unit).toLowerCase() : "",
      category: category ? String(category).toLowerCase() : "",
    });

    if (!listingId) {
      return res.status(404).json({
        ok: false,
        error: "Unknown or missing unit/category for quote route",
      });
    }

    const totalGuests = Number(guests || adults || 1);

    const payload = {
      listingId,
      checkInDateLocalized: checkin,
      checkOutDateLocalized: checkout,
      guestsCount: {
        numberOfGuests: totalGuests,
        adults: Number(adults || totalGuests),
        children: Number(children || 0),
        infants: Number(infants || 0),
      },
    };

    const data = await guestyBookingApiPost(QUOTE_URL, payload);

    res.json({
      ok: true,
      listingId,
      unit: unit || null,
      category: category || null,
      checkin,
      checkout,
      guests: totalGuests,
      data,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

// ---------------------------------------------------
// DEBUG ROUTE
// ---------------------------------------------------

app.get("/api/debug-env", (_req, res) => {
  const clientId = process.env.GUESTY_CLIENT_ID || "";
  const clientSecret = process.env.GUESTY_CLIENT_SECRET || "";

  res.json({
    ok: true,
    clientIdExists: Boolean(clientId),
    clientSecretExists: Boolean(clientSecret),
    clientIdLength: clientId.length,
    clientSecretLength: clientSecret.length,
    clientIdPreview: clientId ? `${clientId.slice(0, 6)}...${clientId.slice(-4)}` : null,
    clientSecretPreview: clientSecret ? `${clientSecret.slice(0, 4)}...${clientSecret.slice(-4)}` : null,
    clientIdStartsWithSpace: /^\s/.test(clientId),
    clientIdEndsWithSpace: /\s$/.test(clientId),
    clientSecretStartsWithSpace: /^\s/.test(clientSecret),
    clientSecretEndsWithSpace: /\s$/.test(clientSecret),
    appVersion: process.env.APP_VERSION || null,
    frontendOrigin: process.env.FRONTEND_ORIGIN || null,
  });
});

// ---------------------------------------------------
// FALLBACK
// ---------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
    method: req.method,
    path: req.originalUrl,
    version: APP_VERSION,
  });
});

// ---------------------------------------------------
// START
// ---------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Guesty backend listening on http://0.0.0.0:${PORT}`);
  console.log(`APP_VERSION=${APP_VERSION}`);
  console.log(`FRONTEND_ORIGIN=${FRONTEND_ORIGIN}`);
  console.log(`GUESTY_CLIENT_ID exists: ${Boolean(process.env.GUESTY_CLIENT_ID)}`);
  console.log(`GUESTY_CLIENT_SECRET exists: ${Boolean(process.env.GUESTY_CLIENT_SECRET)}`);
});