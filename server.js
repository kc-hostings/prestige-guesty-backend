import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

app.get("/api/test-connection", async (req, res) => {
  try {
    const response = await fetch("https://booking.guesty.com");
    res.json({ ok: true, status: response.status });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get("/api/test-booking-api", async (_req, res) => {
  try {
    const response = await fetch("https://booking-api.guesty.com/v1/search");
    res.json({
      ok: true,
      status: response.status,
      statusText: response.statusText
    });
  } catch (e) {
    console.error("TEST BOOKING API ERROR:", e);
    console.error("TEST BOOKING API CAUSE:", e?.cause);

    res.json({
      ok: false,
      error: e?.message || null,
      name: e?.name || null,
      causeMessage: e?.cause?.message || null,
      causeCode: e?.cause?.code || null,
      causeErrno: e?.cause?.errno || null,
      causeAddress: e?.cause?.address || null,
      causePort: e?.cause?.port || null
    });
  }
});

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
app.use(
  cors({
    origin: FRONTEND_ORIGIN === "*" ? true : FRONTEND_ORIGIN,
    credentials: false,
  })
);

const PORT = Number(process.env.PORT || 3000);

// Booking Engine API
const TOKEN_URL = "https://booking.guesty.com/oauth2/token";
const SEARCH_URL = "https://booking-api.guesty.com/v1/search";

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

function safeDate(input) {
  console.log("safeDate input:", input);
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error("Invalid date. Use YYYY-MM-DD.");
  }
  return input;
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

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Guesty request failed: ${response.status} ${text}`);
  }

  return response.json();
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "prestige-apartments-guesty-backend",
    listingIdsLoaded: LISTING_IDS,
  });
});

app.get("/api/listing-ids", (_req, res) => {
  res.json(LISTING_IDS);
});

app.get("/api/search", async (req, res) => {
  try {
    console.log("query:", req.query);

    const checkIn = safeDate(req.query.checkIn);
    const checkOut = safeDate(req.query.checkOut);

    const params = new URLSearchParams({
      checkIn,
      checkOut,
    });

    if (req.query.adults) {
      params.set("adults", String(req.query.adults));
    }

    if (req.query.location) {
      params.set("location", String(req.query.location));
    }

    const url = `${SEARCH_URL}?${params.toString()}`;
    const data = await guestyFetch(url);

    res.json(data);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/check-category/:listingId", async (req, res) => {
  try {
    console.log("query:", req.query);

    const listingId = req.params.listingId;
    const checkIn = safeDate(req.query.checkIn);
    const checkOut = safeDate(req.query.checkOut);

    const params = new URLSearchParams({
      checkIn,
      checkOut,
    });

    if (req.query.adults) {
      params.set("adults", String(req.query.adults));
    }

    if (req.query.location) {
      params.set("location", String(req.query.location));
    }

    const url = `${SEARCH_URL}?${params.toString()}`;
    const data = await guestyFetch(url);

    const items = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
      ? data
      : [];

    const match = items.find((item) => {
      const id = item?._id || item?.id || item?.listingId;
      return id === listingId;
    });

    res.json({
      ok: true,
      listingId,
      found: Boolean(match),
      match: match || null,
      rawCount: items.length,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Guesty backend listening on http://localhost:${PORT}`);
});