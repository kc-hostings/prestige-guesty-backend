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

function getAllListingIds() {
  return [
    ...Object.values(LISTING_IDS.multi).filter(Boolean),
    ...Object.values(LISTING_IDS.units).filter(Boolean),
  ];
}

function findListingIdByKey(key) {
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

  const matchMulti = Object.entries(LISTING_IDS.multi).find(([, listingId]) => listingId === rawId);
  if (matchMulti) return matchMulti[0];

  const matchUnit = Object.entries(LISTING_IDS.units).find(([, listingId]) => listingId === rawId);
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

function normalizeListing(listing, sourceType = null, requestedKey = null) {
  const rawId = listing?._id || listing?.id || listing?.listingId;
  const id = rawId ? String(rawId) : null;

  const title =
    listing?.title ||
    listing?.name ||
    listing?.nickname ||
    listing?.publicDescription?.summary ||
    "Apartment";

  const categoryKey = requestedKey || inferCategoryKeyFromListing(listing);
  const categoryMeta = categoryKey ? CATEGORY_META[categoryKey] || null : null;

  return {
    id,
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
    bookingUrl: BOOKING_BASE_URL && id
      ? `${BOOKING_BASE_URL.replace(/\/$/, "")}/${id}`
      : null,
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

async function getAvailableUnits({ checkin, checkout, occupancy, requestedCategory }) {
  const liveResults = [];

  for (const [unitKey, listingId] of Object.entries(LISTING_IDS.units)) {
    if (!listingId) continue;

    const categoryKey = mapUnitKeyToCategory(unitKey);
    if (!categoryKey) continue;

    const categoryMeta = CATEGORY_META[categoryKey];
    if (!categoryMeta) continue;

    if (requestedCategory && categoryKey !== requestedCategory) continue;
    if (occupancy > categoryMeta.capacityMax) continue;

    const result = await guestyFetchSafe(
      buildUrl(LISTINGS_URL, {
        available: "true",
        checkin,
        checkout,
        minOccupancy: occupancy,
        listingId,
      })
    );

    if (!result.ok) continue;

    const items = parseArrayResponse(result.data);
    if (!items.length) continue;

    const normalized = normalizeListing(
      items[0],
      "unit-availability",
      categoryKey
    );

    liveResults.push({
      ...normalized,
      unitKey,
      listingId,
    });
  }

  return liveResults;
}

// ---------------------------------------------------
// TOKEN / FETCH
// ---------------------------------------------------

async function getAccessToken() {
  const now = Date.now();

  if (tokenCache.value && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.value;
  }

  const clientId = requireEnv("GUESTY_CLIENT_ID");
  const clientSecret = requireEnv("GUESTY_CLIENT_SECRET");

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

  if (!response.ok) {
    throw new Error(`Guesty token request failed: ${response.status} ${text}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Guesty token response was not valid JSON.");
  }

  if (!data?.access_token) {
    throw new Error("Guesty token response did not contain an access_token.");
  }

  tokenCache.value = data.access_token;
  tokenCache.expiresAt = now + (data.expires_in || 3600) * 1000;

  return tokenCache.value;
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
      successCount: entries.filter(item => item.ok).length,
      errorCount: entries.filter(item => !item.ok).length,
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

    const liveResults = await getAvailableUnits({
      checkin,
      checkout,
      occupancy,
      requestedCategory,
    });

    const finalResults = uniqueByCategory(liveResults).sort(sortByCategory);

    res.json({
      ok: true,
      mode: "unit-availability",
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

// ---------------------------------------------------
// CATEGORY SUGGESTIONS
// ---------------------------------------------------

app.get("/api/category-suggestions", async (req, res) => {
  try {
    const { checkin, checkout, guests, category, location } = req.query;

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

    const liveResults = await getAvailableUnits({
      checkin,
      checkout,
      occupancy,
      requestedCategory,
    });

    const finalResults = uniqueByCategory(liveResults).sort(sortByCategory);

    res.json({
      ok: true,
      mode: "unit-availability",
      location: location || "reutlingen",
      checkin,
      checkout,
      guests: occupancy,
      category: requestedCategory || null,
      count: finalResults.length,
      results: finalResults,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

// ---------------------------------------------------
// FALLBACK
// ---------------------------------------------------

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Guesty backend listening on http://0.0.0.0:${PORT}`);
});