export default {
  async fetch(request, env) {
    const cors = makeCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (!env.CCT_PROGRESS) {
        return json({ ok: false, message: "KV binding CCT_PROGRESS is not configured." }, 500, cors);
      }

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/health" && request.method === "GET") {
        return json({ ok: true, service: "cct-quiz-auth-api", now: new Date().toISOString() }, 200, cors);
      }

      if (path === "/register" && request.method === "POST") {
        const body = await readJson(request);
        await assertRegistrationAllowed(body, env);
        const userId = normalizeUserId(body.userId);
        const password = String(body.password || "");
        validateUserId(userId);
        validatePassword(password);

        const key = userKey(userId);
        const existing = await env.CCT_PROGRESS.get(key);
        if (existing) throw httpError(409, "This User ID is already registered.");

        const iterations = Number(env.PASSWORD_ITERATIONS || 120000);
        const salt = randomBase64Url(16);
        const passwordHash = await hashPassword(password, salt, iterations);
        const now = new Date().toISOString();
        const user = {
          userId,
          passwordHash,
          salt,
          iterations,
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now,
        };
        await env.CCT_PROGRESS.put(key, JSON.stringify(user));

        const tokenResult = await createToken(userId, env);
        return json({
          ok: true,
          user: publicUser(user),
          token: tokenResult.token,
          expiresAt: tokenResult.expiresAt,
        }, 200, cors);
      }

      if (path === "/login" && request.method === "POST") {
        const body = await readJson(request);
        const userId = normalizeUserId(body.userId);
        const password = String(body.password || "");
        validateUserId(userId);
        if (!password) throw httpError(400, "Password is required.");

        const raw = await env.CCT_PROGRESS.get(userKey(userId));
        if (!raw) throw httpError(401, "User ID or password is incorrect.");
        const user = JSON.parse(raw);
        const expectedHash = await hashPassword(password, user.salt, user.iterations || 120000);
        if (!timingSafeEqual(expectedHash, user.passwordHash)) {
          throw httpError(401, "User ID or password is incorrect.");
        }

        user.lastLoginAt = new Date().toISOString();
        user.updatedAt = user.lastLoginAt;
        await env.CCT_PROGRESS.put(userKey(userId), JSON.stringify(user));

        const tokenResult = await createToken(userId, env);
        return json({
          ok: true,
          user: publicUser(user),
          token: tokenResult.token,
          expiresAt: tokenResult.expiresAt,
        }, 200, cors);
      }

      if (path === "/me" && request.method === "GET") {
        const auth = await requireAuth(request, env);
        const raw = await env.CCT_PROGRESS.get(userKey(auth.userId));
        if (!raw) throw httpError(401, "User no longer exists.");
        return json({ ok: true, user: publicUser(JSON.parse(raw)) }, 200, cors);
      }

      if (path === "/load" && request.method === "GET") {
        const auth = await requireAuth(request, env);
        const raw = await env.CCT_PROGRESS.get(progressKey(auth.userId));
        if (!raw) return json({ exists: false, store: null }, 200, cors);
        return json({ exists: true, store: JSON.parse(raw) }, 200, cors);
      }

      if (path === "/save" && request.method === "POST") {
        const auth = await requireAuth(request, env);
        const body = await readJson(request);
        const store = body.store || body;
        validateStore(store);
        store.updatedAt = new Date().toISOString();
        await env.CCT_PROGRESS.put(progressKey(auth.userId), JSON.stringify(store));
        return json({ ok: true, userId: auth.userId, updatedAt: store.updatedAt }, 200, cors);
      }

      return json({ ok: false, message: "Not Found" }, 404, cors);
    } catch (error) {
      const status = error.status || 500;
      return json({ ok: false, message: error.message || String(error) }, status, cors);
    }
  },
};

function makeCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes("*") ? "*" : (allowed.includes(origin) ? origin : allowed[0]);

  return {
    "Access-Control-Allow-Origin": allowOrigin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "Invalid JSON body.");
  }
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function assertRegistrationAllowed(body, env) {
  const required = String(env.REGISTRATION_CODE || "").trim();
  if (!required) return;
  const actual = String(body.registrationCode || "").trim();
  if (!timingSafeEqual(actual, required)) {
    throw httpError(403, "Registration code is incorrect.");
  }
}

function normalizeUserId(value) {
  return String(value || "").trim().toLowerCase();
}

function validateUserId(userId) {
  if (!/^[a-z0-9_-]{3,32}$/.test(userId)) {
    throw httpError(400, "User ID must be 3-32 characters: lowercase letters, numbers, underscore, or hyphen.");
  }
}

function validatePassword(password) {
  if (password.length < 8) {
    throw httpError(400, "Password must be at least 8 characters.");
  }
  if (password.length > 200) {
    throw httpError(400, "Password is too long.");
  }
}

function userKey(userId) {
  return `user:${userId}`;
}

function progressKey(userId) {
  return `progress:${userId}`;
}

function publicUser(user) {
  return {
    userId: user.userId,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

async function hashPassword(password, saltBase64Url, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64UrlToBytes(saltBase64Url),
      iterations,
    },
    keyMaterial,
    256
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

async function createToken(userId, env) {
  const secret = getTokenSecret(env);
  const now = Math.floor(Date.now() / 1000);
  const ttlDays = Math.max(1, Math.min(Number(env.TOKEN_TTL_DAYS || 30), 365));
  const exp = now + ttlDays * 24 * 60 * 60;
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { sub: userId, iat: now, exp };
  const data = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
  const signature = await hmacSha256(data, secret);
  return {
    token: `${data}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

async function requireAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw httpError(401, "Authorization token is required.");

  const parts = token.split(".");
  if (parts.length !== 3) throw httpError(401, "Invalid token.");

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = await hmacSha256(`${encodedHeader}.${encodedPayload}`, getTokenSecret(env));
  if (!timingSafeEqual(signature, expectedSignature)) throw httpError(401, "Invalid token signature.");

  const payload = JSON.parse(bytesToString(base64UrlToBytes(encodedPayload)));
  if (!payload.sub) throw httpError(401, "Invalid token payload.");
  if (!payload.exp || Math.floor(Date.now() / 1000) >= payload.exp) throw httpError(401, "Token has expired. Please log in again.");

  const userId = normalizeUserId(payload.sub);
  validateUserId(userId);
  return { userId };
}

function getTokenSecret(env) {
  const secret = env.JWT_SECRET || env.AUTH_SECRET || env.SYNC_SECRET;
  if (!secret) throw httpError(500, "JWT_SECRET is not configured.");
  return String(secret);
}

async function hmacSha256(data, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return bytesToBase64Url(new Uint8Array(signature));
}

function validateStore(store) {
  if (!store || typeof store !== "object") throw httpError(400, "Invalid JSON body.");
  if (store.appId !== "cct-unified-quiz" || typeof store.progress !== "object" || typeof store.daily !== "object") {
    throw httpError(400, "Invalid CCT progress format.");
  }
}

function jsonToBase64Url(value) {
  return stringToBase64Url(JSON.stringify(value));
}

function stringToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function bytesToString(bytes) {
  return new TextDecoder().decode(bytes);
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(value).length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
