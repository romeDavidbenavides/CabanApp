/* Envía notificaciones push a los dispositivos registrados en Firestore.
   Sin dependencias: usa solo Node (crypto + fetch nativo).

   Variables de entorno necesarias en Vercel:
   - FIREBASE_SERVICE_ACCOUNT : el JSON completo de la cuenta de servicio de Firebase.
   - NOTIFY_SECRET (opcional)  : cadena secreta; debe coincidir con la del cliente. */

const crypto = require("node:crypto");

const SCOPES = [
  "https://www.googleapis.com/auth/firebase.messaging",
  "https://www.googleapis.com/auth/datastore",
].join(" ");

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function cuentaServicio() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("Falta la variable FIREBASE_SERVICE_ACCOUNT");
  return JSON.parse(raw);
}

async function obtenerAccessToken(sa) {
  const ahora = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPES,
      aud: "https://oauth2.googleapis.com/token",
      iat: ahora,
      exp: ahora + 3600,
    }),
  );
  const firma = crypto
    .createSign("RSA-SHA256")
    .update(`${header}.${claim}`)
    .sign(sa.private_key);
  const jwt = `${header}.${claim}.${base64url(firma)}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("OAuth falló: " + JSON.stringify(j));
  return j.access_token;
}

async function listarDispositivos(projectId, accessToken) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/dispositivos?pageSize=1000`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await r.json();
  return (j.documents || [])
    .map((d) => ({
      id: d.name.split("/").pop(),
      token: d.fields && d.fields.token && d.fields.token.stringValue,
    }))
    .filter((x) => x.token);
}

async function borrarDispositivo(projectId, accessToken, id) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/dispositivos/${encodeURIComponent(id)}`;
  await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

async function enviarMensaje(projectId, accessToken, deviceToken, titulo, cuerpo) {
  return fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: titulo, body: cuerpo },
          webpush: {
            notification: { icon: "/logo-192.png" },
            fcm_options: { link: "/" },
          },
        },
      }),
    },
  );
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }
  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { secret, titulo, cuerpo, excepto } = body;

    if (process.env.NOTIFY_SECRET && secret !== process.env.NOTIFY_SECRET) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }
    if (!titulo) {
      res.status(400).json({ error: "Falta 'titulo'" });
      return;
    }

    const sa = cuentaServicio();
    const accessToken = await obtenerAccessToken(sa);
    const dispositivos = (
      await listarDispositivos(sa.project_id, accessToken)
    ).filter((d) => d.token !== excepto);

    let enviados = 0;
    for (const d of dispositivos) {
      const r = await enviarMensaje(
        sa.project_id,
        accessToken,
        d.token,
        titulo,
        cuerpo || "",
      );
      if (r.ok) {
        enviados++;
        continue;
      }
      const err = await r.json().catch(() => ({}));
      const code =
        (err.error &&
          ((err.error.details && err.error.details[0] && err.error.details[0].errorCode) ||
            err.error.status)) ||
        "";
      if (["UNREGISTERED", "NOT_FOUND", "INVALID_ARGUMENT"].includes(code)) {
        await borrarDispositivo(sa.project_id, accessToken, d.id);
      }
    }

    res.status(200).json({ ok: true, enviados, total: dispositivos.length });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
