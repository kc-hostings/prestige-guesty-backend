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
const LISTINGS_URL = `${API_BASE_URL}/listings`;
const CITIES_URL = `${LISTINGS_URL}/cities`;
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

function findUnitKeyByListingId(listingId) {
  if (!listingId) return null;

  const entry = Object.entries(LISTING_IDS.units).find(
    ([, value]) => String(value) === String(listingId)
  );

  return entry ? entry[0] : null;
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
    const clientId = requireEnv("GUESTY_CLIENT_ID");
    const clientSecret = requireEnv("GUESTY_CLIENT_SECRET");

    for (let attempt = 1; attempt <= 3; attempt++) {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        scope: "booking_engine:api",
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "cache-control": "no-cache,no-cache",
        },
        body,
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

// ---------------------------------------------------
// AVAILABILITY HELPERS
// ---------------------------------------------------

async function getAvailableUnits({ checkin, checkout, occupancy, requestedCategory }) {
  const allRelevantListingIds = new Set(getAllListingIds());

  const url = buildUrl(LISTINGS_URL, {
    available: "true",
    checkin,
    checkout,
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
// DEBUG ROUTES
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

    // -----------------------------------
    // UNIT MODE (für Deluxe #2, #4 etc.)
    // -----------------------------------
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

    // -----------------------------------
    // CATEGORY MODE
    // -----------------------------------
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
    appVersion: process.env.APP_VERSION || null
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

