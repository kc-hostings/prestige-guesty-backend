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

// Guesty Booking Engine
const TOKEN_URL = "https://booking.guesty.com/oauth2/token";
const API_BASE_URL = "https://booking.guesty.com/api";
const LISTINGS_URL = `${API_BASE_URL}/listings`;
const CITIES_URL = `${LISTINGS_URL}/cities`;

const LISTING_IDS = {
  multi: {
    deluxe: process.env.GUESTY_MULTI_DELUXE,
    maisonette: process.env.GUESTY_MULTI_MAISONETTE,
    premium: process.env.GUESTY_MULTI_PREMIUM,
    standard: process.env.GUESTY_MULTI_STANDARD,
    superior: process.env.GUESTY_MULTI_SUPERIOR,
  },
  units: {
    deluxe2: process.env.GUESTY_UNIT_DELUXE_2,
    deluxe4: process.env.GUESTY_UNIT_DELUXE_4,
    maisonette8: process.env.GUESTY_UNIT_MAISONETTE_8,
    premium6: process.env.GUESTY_UNIT_PREMIUM_6,
    standard3: process.env.GUESTY_UNIT_STANDARD_3,
    superior5: process.env.GUESTY_UNIT_SUPERIOR_5,
    superior7: process.env.GUESTY_UNIT_SUPERIOR_7,
  },
};

let tokenCache = {
  value: null,
  expiresAt: 0,
};

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

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Guesty token request failed: ${response.status} ${text}`);
  }

  const data = await response.json();

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
      received: Array.isArray(data) ? data.length : null,
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
    res.json(data);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/listings", async (_req, res) => {
  try {
    const data = await guestyFetch(LISTINGS_URL);
    res.json(data);
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
    const url = `${LISTINGS_URL}/${listingId}`;
    const data = await guestyFetch(url);
    res.json(data);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

// Kategorie-Key -> Listing laden
// Beispiele:
// /api/category/deluxe
// /api/category/standard
// /api/category/superior7
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

    const url = `${LISTINGS_URL}/${listingId}`;
    const data = await guestyFetch(url);

    res.json({
      ok: true,
      key,
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

// Alle bekannten Prestige-Listings laden
app.get("/api/prestige-listings", async (_req, res) => {
  try {
    const entries = [];

    for (const [key, listingId] of Object.entries(LISTING_IDS.multi)) {
      if (!listingId) continue;

      try {
        const data = await guestyFetch(`${LISTINGS_URL}/${listingId}`);
        entries.push({
          ok: true,
          type: "multi",
          key,
          listingId,
          data,
        });
      } catch (e) {
        entries.push({
          ok: false,
          type: "multi",
          key,
          listingId,
          error: e.message,
        });
      }
    }

    for (const [key, listingId] of Object.entries(LISTING_IDS.units)) {
      if (!listingId) continue;

      try {
        const data = await guestyFetch(`${LISTINGS_URL}/${listingId}`);
        entries.push({
          ok: true,
          type: "unit",
          key,
          listingId,
          data,
        });
      } catch (e) {
        entries.push({
          ok: false,
          type: "unit",
          key,
          listingId,
          error: e.message,
        });
      }
    }

    res.json({
      ok: true,
      count: entries.length,
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