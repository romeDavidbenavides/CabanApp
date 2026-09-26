import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  deleteField,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  deleteToken,
  onMessage,
  isSupported as isMessagingSupported,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
const firebaseConfig = {
  apiKey: "AIzaSyB9Fb4nHmvihKJ_RxT-eciu45kAM1CEKYE",
  authDomain: "cabanapp-ca1d1.firebaseapp.com",
  projectId: "cabanapp-ca1d1",
  storageBucket: "cabanapp-ca1d1.firebasestorage.app",
  messagingSenderId: "903412118535",
  appId: "1:903412118535:web:9fb441c99aa203a8eba6a2",
  measurementId: "G-YG1KFM067P",
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// --- Notificaciones push ---
// PASO 1: pega aquí la "clave web push (VAPID)" de Firebase Console
//         (Configuración del proyecto -> Cloud Messaging -> Certificados web push).
const VAPID_KEY =
  "BLcS6zKuElVsZTL5v0i8wmjQ3JURLZDScuWfs2Dw0AxOm4hJyCGdk32DupdFSeFvNwY4_RguCGKD09P9lWJqGC4";
// PASO 2: la MISMA cadena secreta que configures en Vercel como variable NOTIFY_SECRET.
const NOTIFY_SECRET = "cabanapp-8ycbI7bsjU2vm3POVdhwjngY";
const $ = (id) => document.getElementById(id);
const cabanas = Array.from(
  {
    length: 29,
  },
  (_, i) => String(i + 1).padStart(2, "0"),
);
// Precios configurados por cabaña, en pesos colombianos.
const preciosCabanas = {
  "01": 80000,
  "02": 80000,
  "03": 80000,
  "04": 80000,
  "05": 130000,
  "06": 200000,
  "07": 80000,
  "08": 80000,
  "09": 80000,
  "10": 80000,
  "11": 80000,
  "12": 240000,
  "13": 300000,
  "14": 140000,
  "15": 80000,
  "16": 140000,
  "17": 120000,
  "18": 160000,
  "19": 350000,
  "20": 90000,
  "21": 140000,
  "22": 140000,
  "23": 80000,
  "24": 80000,
  "25": 80000,
  "26": 80000,
  "27": 420000,
  "28": 110000,
  "29": 80000,
};
const precioCabana = (cabana) => preciosCabanas[cabana] ?? 0;
// Cargos adicionales, en pesos colombianos, por unidad.
const VALOR_PERSONA_EXTRA = 15000;
const VALOR_HORA_EXTRA = 15000;
const VALOR_REACTIVA_JACUZZI = 15000;
// "No" -> 0, "1" -> 1, "1 vez" -> 1, "2 veces" -> 2, etc.
const contarUnidades = (v) => {
  const m = String(v ?? "").match(/\d+/);
  return m ? Number(m[0]) : 0;
};
const precioSegunEstado = (cabana, estado) =>
  ["ocupado", "reserva"].includes(estado) ? precioCabana(cabana) : 0;
const tiempoOcupadoSegunEstado = (horas, estado) =>
  ["ocupado", "reserva", "cortesia"].includes(estado) ? horas : 0;
const nombreEstado = (estado) =>
  ({
    ocupado: "Ocupación",
    reserva: "Reserva",
    cortesia: "Cortesía",
    mantenimiento: "Mantenimiento",
    aseo: "Aseo",
  })[estado] ?? estado;
let fechaVista = new Date(),
  eventos = [],
  legacy = [],
  escucharLegacyActual = null,
  seleccionado = null,
  eventoSeleccionado = null,
  editando = null,
  cargado = false;
const form = $("form-reserva"),
  fecha = $("fecha-reserva"),
  hora = $("hora-reserva"),
  cabana = $("cabana-reserva"),
  estado = $("estado-reserva"),
  duracion = $("duracion-reserva"),
  horaExtra = $("hora-extra");
const fechaId = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const desdeId = (s) => new Date(`${s}T00:00:00`);
const horaActual = () => new Date().toTimeString().slice(0, 5);
const formatoHora = (fecha) => {
  const hora = new Date(fecha);
  const horas = hora.getHours();
  const minutos = String(hora.getMinutes()).padStart(2, "0");
  return `${horas % 12 || 12}:${minutos} ${horas < 12 ? "am" : "pm"}`;
};
const msHora = 3600000,
  inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
  finDia = (d) => new Date(inicioDia(d).getTime() + 86400000);
// Interfaz: avisos en pantalla (confirmación de acciones). Siempre visibles.
function aviso(texto) {
  const n = document.createElement("div");
  n.className = "aviso";
  n.textContent = texto;
  $("avisos").append(n);
  setTimeout(() => n.remove(), 5000);
}
function abrir(id) {
  $(id).classList.remove("oculto");
}
function cerrar(id) {
  $(id).classList.add("oculto");
}
document
  .querySelectorAll("[data-cerrar]")
  .forEach((b) => (b.onclick = () => cerrar(b.dataset.cerrar)));
function fechaLarga(d) {
  return d
    .toLocaleDateString("es-CO", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    .replace(/^./, (x) => x.toUpperCase());
}
// Formulario de reservas.
function opcionesDuracion() {
  const e = estado.value;
  let lista = [];
  if (e === "cortesia") lista = [[6, "6 horas"]];
  else if (e === "mantenimiento")
    lista = [
      [24, "1 día"],
      [48, "2 días"],
      [168, "1 semana"],
      [0, "Indefinido"],
    ];
  else
    lista = [
      [2, "2 horas"],
      [4, "4 horas"],
      [6, "6 horas"],
      [8, "8 horas"],
      [10, "10 horas"],
    ];
  duracion.innerHTML = lista
    .map((x) => `<option value="${x[0]}">${x[1]}</option>`)
    .join("");
  if (e === "cortesia") duracion.value = "6";
}
estado.onchange = opcionesDuracion;
cabanas.forEach((c) => cabana.add(new Option(`Cabaña ${c}`, c)));
function nuevaReserva() {
  editando = null;
  form.reset();
  fecha.value = fechaId(fechaVista);
  hora.value = horaActual();
  cabana.value = "01";
  estado.value = "ocupado";
  opcionesDuracion();
  duracion.value = "8";
  abrir("modal-reserva");
}
$("btn-nueva").onclick = nuevaReserva;
$("btn-agenda").onclick = () => {
  $("inicio").classList.add("oculto");
  $("agenda").classList.remove("oculto");
  render();
};
$("btn-volver").onclick = () => {
  $("agenda").classList.add("oculto");
  $("inicio").classList.remove("oculto");
};
$("anterior").onclick = () => {
  fechaVista.setDate(fechaVista.getDate() - 1);
  escucharLegacy();
  render();
};
$("siguiente").onclick = () => {
  fechaVista.setDate(fechaVista.getDate() + 1);
  escucharLegacy();
  render();
};
function enRango(e, d) {
  const a = new Date(e.inicio),
    b = e.fin ? new Date(e.fin) : new Date("2999-12-31");
  return a < finDia(d) && b > inicioDia(d);
}
function horaLegacy(h) {
  const m = String(h || "").match(/(\d+)\s*(AM|PM)/i);
  if (!m) return 0;
  let x = Number(m[1]) % 12;
  if (m[2].toUpperCase() === "PM") x += 12;
  return x;
}
// Lectura y adaptación de registros antiguos.
function escucharLegacy() {
  if (escucharLegacyActual) escucharLegacyActual();
  escucharLegacyActual = onSnapshot(
    doc(db, "dias_reservas", fechaId(fechaVista)),
    (s) => {
      const grupos = {};
      Object.entries(s.exists() ? s.data() : {}).forEach(([k, v]) => {
        const m = k.match(/^Cab(\d+)-/);
        if (!m) return;
        const g = `${v.idReserva || v.horaOrigen || k}-${v.estado}`,
          h = horaLegacy(k.replace(/^Cab\d+-/, "").replace(/(AM|PM)/, " $1"));
        (grupos[g] ??= []).push({
          h,
          v,
          c: m[1],
          k,
        });
      });
      legacy = Object.values(grupos).map((a) => {
        // "12 AM" se guarda como hora 0, pero en los registros de la agenda
        // vieja marca el cierre de una reserva nocturna (ej. 9PM,10PM,11PM,12AM),
        // no el inicio del día. Si el grupo también tiene horas PM (>=12),
        // esa hora 0 es en realidad el final: se trata como 24, no como 0,
        // para no "estirar" la barra desde la medianoche hasta el día completo.
        let horas = a.map((z) => z.h);
        if (horas.some((h) => h >= 12))
          horas = horas.map((h) => (h === 0 ? 24 : h));
        const x = a[0],
          min = Math.min(...horas),
          max = Math.max(...horas) + 1,
          base = inicioDia(fechaVista);
        return {
          legacy: true,
          idReserva: `legacy-${x.c}-${min}-${x.v.estado}`,
          idEvento: `legacy-${x.c}-${min}-${x.v.estado}`,
          tipo: "uso",
          cabana: x.c,
          estado: x.v.estado || "ocupado",
          inicio: new Date(base.getTime() + min * msHora).toISOString(),
          fin: new Date(base.getTime() + max * msHora).toISOString(),
          cliente: x.v.nombre || "",
          turno: x.v.turno || "",
          personasExtra: x.v.personasExtra || "",
          reactivaJacuzzi: x.v.reactivaJacuzzi || "",
          observacion: x.v.observacion || "",
          duracion: max - min,
          _claves: a.map((z) => z.k),
          _fechaDoc: fechaId(fechaVista),
        };
      });
      render();
    },
  );
}
// Dibuja la agenda diaria.
function render() {
  $("fecha-titulo").textContent = fechaLarga(fechaVista);
  const inicio = inicioDia(fechaVista),
    base = [...eventos, ...legacy],
    unicos = [...new Map(base.map((e) => [e.idEvento, e])).values()].filter(
      (e) => enRango(e, fechaVista),
    );
  const ids = [...new Set(unicos.map((e) => e.cabana))].sort();
  const root = $("agenda-cuerpo");
  if (!ids.length) {
    root.innerHTML = '<div class="sin-datos">#</div>';
    return;
  }
  root.innerHTML = ids
    .map(
      (c) =>
        `<div class="fila-agenda"><div class="cabana">${c}</div><div class="riel" data-cabana="${c}"></div></div>`,
    )
    .join("");
  unicos.forEach((e) => {
    const r = root.querySelector(`.riel[data-cabana="${e.cabana}"]`);
    if (!r) return;
    const a = new Date(e.inicio),
      b = e.fin ? new Date(e.fin) : finDia(fechaVista);
    const visA = a > inicio ? a : inicio,
      visB = b < finDia(fechaVista) ? b : finDia(fechaVista);
    const left = ((visA - inicio) / 86400000) * 100,
      width = Math.max(((visB - visA) / 86400000) * 100, 0.7);
    const bar = document.createElement("button");
    bar.className = `barra ${e.estado}`;
    bar.style.left = `${left}%`;
    bar.style.width = `${width}%`;
    const detalle = e.estado === "aseo" ? "Aseo" : e.cliente || e.estado;
    const horario = `${formatoHora(e.inicio)} a ${e.fin ? formatoHora(e.fin) : "Indefinido"}`;
    bar.textContent = `${detalle} · ${horario}`;
    bar.onclick = () => abrirAcciones(e);
    r.append(bar);
  });
}
function diasEntre(a, b) {
  const r = [];
  let d = inicioDia(a),
    to = inicioDia(b || a);
  for (let i = 0; i < 370 && d <= to; i++, d = new Date(d.getTime() + 86400000))
    r.push(fechaId(d));
  return r;
}
// Persistencia de reservas y validación de cruces.
async function escribirEvento(e) {
  for (const dia of diasEntre(new Date(e.inicio), e.fin && new Date(e.fin)))
    await setDoc(doc(db, "agenda_eventos", `${e.idEvento}_${dia}`), {
      ...e,
      fechaDia: dia,
    });
}
function solapa(a, b, c, d) {
  return a < d && b > c;
}
async function conflicto(inicio, fin, cab, idExcluir) {
  const todos = [
    ...new Map([...eventos, ...legacy].map((e) => [e.idEvento, e])).values(),
  ];
  return todos.some(
    (e) =>
      e.cabana === cab &&
      e.idReserva !== idExcluir &&
      solapa(
        inicio,
        fin || new Date("2999-12-31"),
        new Date(e.inicio),
        e.fin ? new Date(e.fin) : new Date("2999-12-31"),
      ),
  );
}
async function borrarReserva(id) {
  const s = await getDocs(collection(db, "agenda_eventos"));
  await Promise.all(
    s.docs
      .filter((x) => x.data().idReserva === id)
      .map((x) => deleteDoc(x.ref)),
  );
}
async function borrarAseo(idReserva) {
  const s = await getDocs(collection(db, "agenda_eventos"));
  await Promise.all(
    s.docs
      .filter(
        (x) => x.data().idReserva === idReserva && x.data().tipo === "aseo",
      )
      .map((x) => deleteDoc(x.ref)),
  );
}
async function registrarEvento(
  cab,
  accion,
  ini,
  fin,
  horas,
  trabajador,
  modificado,
  estadoFinal,
  cliente,
  extra,
  jacuzzi,
  obs,
  precio = 0,
  tiempoOcupado = 0,
  idReserva = null,
  cargos = {},
) {
  const datos = {
    id_reserva: idReserva,
    eliminado: false,
    precio,
    fecha_registro: new Date().toISOString(),
    fecha_dia: fechaId(new Date(ini)),
    cabana: "Cabaña " + cab,
    accion,
    hora_inicio: new Date(ini).toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    hora_fin: fin
      ? new Date(fin).toLocaleTimeString("es-CO", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Indefinido",
    total_horas: horas || 0,
    total_tiempo_ocupada: tiempoOcupado,
    trabajador,
    modificado_por: modificado,
    estado_final: estadoFinal,
    cliente,
    personas_extra: extra,
    reactiva_jacuzzi: jacuzzi,
    hora_extra: cargos.horaExtra ?? "No",
    horas_extra: cargos.horasExtra ?? 0,
    valor_personas_extra: cargos.valorPersonasExtra ?? 0,
    valor_hora_extra: cargos.valorHoraExtra ?? 0,
    valor_reactiva_jacuzzi: cargos.valorJacuzzi ?? 0,
    total_general: cargos.totalGeneral ?? (precio || 0),
    observacion: obs || "",
  };
  if (idReserva) {
    await setDoc(doc(db, "historial_eventos", idReserva), datos, { merge: true });
    return;
  }
  await addDoc(collection(db, "historial_eventos"), datos);
}
async function marcarHistorialEliminado(registro, trabajador, observacion) {
  const eliminadoEn = new Date();
  const horaInicioAnterior = new Date(registro.inicio).toLocaleTimeString(
    "es-CO",
    { hour: "2-digit", minute: "2-digit" },
  );
  const datosEliminacion = {
    id_reserva: registro.idReserva,
    fecha_dia: fechaId(new Date(registro.inicio)),
    cabana: "Cabaña " + registro.cabana,
    accion: "Eliminación",
    hora_inicio: formatoHora(registro.inicio),
    hora_fin: registro.fin ? formatoHora(registro.fin) : "Indefinido",
    total_horas: 0,
    total_tiempo_ocupada: 0,
    precio: 0,
    trabajador: registro.turno || "",
    estado_final: "Eliminada",
    cliente: registro.cliente || "",
    personas_extra: registro.personasExtra || "",
    reactiva_jacuzzi: registro.reactivaJacuzzi || "",
    hora_extra: registro.horaExtra || "No",
    horas_extra: 0,
    valor_personas_extra: 0,
    valor_hora_extra: 0,
    valor_reactiva_jacuzzi: 0,
    total_general: 0,
    observacion: registro.observacion || "",
    eliminado_por: trabajador,
    observacion_eliminacion: observacion,
    fecha_eliminacion: eliminadoEn.toISOString(),
    fecha_eliminacion_dia: fechaId(eliminadoEn),
  };
  const historial = await getDocs(collection(db, "historial_eventos"));
  const coincidencias = historial.docs.filter((evento) => {
    const datos = evento.data();
    return (
      datos.id_reserva === registro.idReserva ||
      (datos.fecha_dia === datosEliminacion.fecha_dia &&
        datos.cabana === datosEliminacion.cabana &&
        datos.cliente === datosEliminacion.cliente &&
        datos.hora_inicio === horaInicioAnterior)
    );
  });
  const destinos = coincidencias.length
    ? coincidencias.map((evento) => evento.ref)
    : [doc(db, "historial_eventos", registro.idReserva)];
  await Promise.all(
    destinos.map((destino) => setDoc(destino, datosEliminacion, { merge: true })),
  );
}
// Guardar, modificar y eliminar reservas.
function datosFormulario() {
  const i = new Date(`${fecha.value}T${hora.value}:00`),
    hBase = Number(duracion.value),
    hExtra = contarUnidades(horaExtra.value),
    h = hBase + hExtra,
    indef = estado.value === "mantenimiento" && hBase === 0,
    f = indef ? null : new Date(i.getTime() + h * msHora);
  return {
    inicio: i,
    fin: f,
    horas: h,
    horasBase: hBase,
    horasExtra: hExtra,
    indef,
  };
}
// Antes de guardar, se pide confirmar cabaña/horario para evitar errores
// de dedo (ej. AM en vez de PM, o la cabaña equivocada).
form.onsubmit = (ev) => {
  ev.preventDefault();
  const d = datosFormulario(),
    horario = `${formatoHora(d.inicio)} a ${d.fin ? formatoHora(d.fin) : "Indefinido"}`;
  $("confirmar-reserva-cuerpo").textContent =
    `¿Seguro que deseas agregar la Cabaña ${cabana.value} de ${horario}?`;
  abrir("modal-confirmar-reserva");
};
$("confirmar-reserva-aceptar").onclick = async () => {
  cerrar("modal-confirmar-reserva");
  await guardarReserva();
};
async function guardarReserva() {
  const d = datosFormulario(),
    uso = ["ocupado", "reserva", "cortesia"].includes(estado.value);
  if (await conflicto(d.inicio, d.fin, cabana.value, editando)) {
    aviso("Esta cabaña ya tiene un registro en ese horario.");
    return;
  }
  if (editando) await borrarReserva(editando);
  const id = editando || crypto.randomUUID(),
    base = {
      idReserva: id,
      idEvento: id,
      tipo: "uso",
      cabana: cabana.value,
      estado: estado.value,
      inicio: d.inicio.toISOString(),
      fin: d.fin?.toISOString() || null,
      cliente: $("cliente-nombre").value.trim(),
      turno: $("persona-turno").value.trim(),
      personasExtra: $("personas-extra").value,
      reactivaJacuzzi: $("reactiva-jacuzzi").value,
      horaExtra: horaExtra.value,
      observacion: $("cliente-observacion").value.trim(),
      duracion: d.horas,
    };
  await escribirEvento(base);
  if (uso) {
    const ai = d.fin,
      af = new Date(ai.getTime() + 6 * msHora),
      aseo = {
        ...base,
        idEvento: `${id}-aseo`,
        tipo: "aseo",
        estado: "aseo",
        inicio: ai.toISOString(),
        fin: af.toISOString(),
        cliente: "Limpieza",
        duracion: 6,
      };
    if (await conflicto(ai, af, cabana.value, id)) {
      await borrarReserva(id);
      aviso("No hay espacio para las 6 horas de aseo obligatorias.");
      return;
    }
    await escribirEvento(aseo);
  }
  const nPersonasExtra = contarUnidades(base.personasExtra),
    nHorasExtra = contarUnidades(base.horaExtra),
    nJacuzzi = contarUnidades(base.reactivaJacuzzi),
    valorPersonasExtra = nPersonasExtra * VALOR_PERSONA_EXTRA,
    valorHoraExtra = nHorasExtra * VALOR_HORA_EXTRA,
    valorJacuzzi = nJacuzzi * VALOR_REACTIVA_JACUZZI,
    precioBase = precioSegunEstado(base.cabana, base.estado);
  await registrarEvento(
    base.cabana,
    nombreEstado(base.estado),
    d.inicio,
    d.fin,
    d.horas,
    base.turno,
    base.turno,
    base.estado,
    base.cliente,
    base.personasExtra,
    base.reactivaJacuzzi,
    base.observacion,
    precioBase,
    tiempoOcupadoSegunEstado(d.horas, base.estado),
    base.idReserva,
    {
      horaExtra: base.horaExtra,
      horasExtra: nHorasExtra,
      valorPersonasExtra,
      valorHoraExtra,
      valorJacuzzi,
      totalGeneral:
        precioBase + valorPersonasExtra + valorHoraExtra + valorJacuzzi,
    },
  );
  cerrar("modal-reserva");
  aviso(`Reserva agregada · Cabaña ${base.cabana} · ${base.cliente}`);
  enviarPush(
    `Cabaña ${base.cabana} · ${nombreEstado(base.estado)}`,
    `${base.cliente || "Sin placa"} · ${formatoHora(base.inicio)}`,
  );
}
// Acciones disponibles para una reserva existente.
function abrirAcciones(e) {
  seleccionado = e.idReserva;
  eventoSeleccionado = e;
  const esAseo = e.tipo === "aseo";
  $("accion-modificar").classList.toggle("oculto", e.legacy || esAseo);
  $("accion-salida").classList.toggle("oculto", e.legacy || esAseo);
  abrir("modal-acciones");
}
// Muestra en una cajita los datos de la reserva (útil porque en la barra
// de la agenda casi no se alcanzan a leer).
function textoDetalle(e) {
  const filas = [
    ["Estado", nombreEstado(e.estado)],
    [
      "Horario",
      `${formatoHora(e.inicio)} a ${e.fin ? formatoHora(e.fin) : "Indefinido"}`,
    ],
    ["Cliente / placa", e.cliente || "—"],
  ];
  if (e.turno) filas.push(["Persona de turno", e.turno]);
  if (e.personasExtra && e.personasExtra !== "No")
    filas.push(["Personas extra", e.personasExtra]);
  if (e.horaExtra && e.horaExtra !== "No")
    filas.push(["Hora extra", e.horaExtra]);
  if (e.reactivaJacuzzi && e.reactivaJacuzzi !== "No")
    filas.push(["Reactivación jacuzzi", e.reactivaJacuzzi]);
  if (e.observacion) filas.push(["Observación", e.observacion]);
  return filas;
}
const escaparHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
$("accion-detalle").onclick = () => {
  cerrar("modal-acciones");
  $("detalle-titulo").textContent = `Cabaña ${eventoSeleccionado.cabana}`;
  $("detalle-cuerpo").innerHTML = textoDetalle(eventoSeleccionado)
    .map(
      ([k, v]) =>
        `<div class="detalle-fila"><b>${escaparHtml(k)}</b><span>${escaparHtml(v)}</span></div>`,
    )
    .join("");
  abrir("modal-detalle");
};
// Modificar una reserva existente: placa/cliente, extras y observación.
// La fecha, hora y duración NO se tocan acá; eso sigue siendo "Marcar salida".
$("accion-modificar").onclick = () => {
  cerrar("modal-acciones");
  const e = eventoSeleccionado;
  $("modificar-cliente").value = e.cliente || "";
  $("modificar-trabajador").value = "";
  $("modificar-personas-extra").value = e.personasExtra || "No";
  $("modificar-hora-extra").value = e.horaExtra || "No";
  $("modificar-jacuzzi").value = e.reactivaJacuzzi || "No";
  $("modificar-observacion").value = e.observacion || "";
  abrir("modal-modificar");
};
$("form-modificar").onsubmit = async (ev) => {
  ev.preventDefault();
  const e = eventoSeleccionado,
    nuevoCliente = $("modificar-cliente").value.trim(),
    trabajadorModifica = $("modificar-trabajador").value.trim(),
    nuevaPersonasExtra = $("modificar-personas-extra").value,
    nuevaHoraExtra = $("modificar-hora-extra").value,
    nuevoJacuzzi = $("modificar-jacuzzi").value,
    nuevaObservacion = $("modificar-observacion").value.trim();

  const horasExtraOriginal = contarUnidades(e.horaExtra),
    horasExtraNueva = contarUnidades(nuevaHoraExtra),
    horasBase = (Number(e.duracion) || 0) - horasExtraOriginal,
    cambiaHorario = horasExtraNueva !== horasExtraOriginal && e.fin;

  let nuevoFin = e.fin ? new Date(e.fin) : null,
    nuevaDuracionTotal = Number(e.duracion) || 0;
  if (cambiaHorario) {
    nuevaDuracionTotal = horasBase + horasExtraNueva;
    nuevoFin = new Date(
      new Date(e.inicio).getTime() + nuevaDuracionTotal * msHora,
    );
    if (await conflicto(new Date(e.inicio), nuevoFin, e.cabana, e.idReserva)) {
      aviso(
        "No se puede cambiar la hora extra: la cabaña ya tiene otro registro en ese horario.",
      );
      return;
    }
  }

  const base = {
    idReserva: e.idReserva,
    idEvento: e.idReserva,
    tipo: "uso",
    cabana: e.cabana,
    estado: e.estado,
    inicio: new Date(e.inicio).toISOString(),
    fin: nuevoFin ? nuevoFin.toISOString() : null,
    cliente: nuevoCliente,
    turno: e.turno,
    personasExtra: nuevaPersonasExtra,
    reactivaJacuzzi: nuevoJacuzzi,
    horaExtra: nuevaHoraExtra,
    observacion: nuevaObservacion,
    duracion: nuevaDuracionTotal,
  };
  await borrarReserva(e.idReserva);
  await escribirEvento(base);
  if (["ocupado", "reserva", "cortesia"].includes(base.estado) && base.fin) {
    const ai = new Date(base.fin),
      af = new Date(ai.getTime() + 6 * msHora);
    if (await conflicto(ai, af, base.cabana, base.idReserva)) {
      aviso(
        "Reserva modificada, pero no hay espacio para las 6 horas de aseo en el nuevo horario.",
      );
    } else {
      await escribirEvento({
        ...base,
        idEvento: `${base.idReserva}-aseo`,
        tipo: "aseo",
        estado: "aseo",
        inicio: ai.toISOString(),
        fin: af.toISOString(),
        cliente: "Limpieza",
        duracion: 6,
      });
    }
  }

  const nPersonasExtra = contarUnidades(nuevaPersonasExtra),
    nJacuzzi = contarUnidades(nuevoJacuzzi),
    valorPersonasExtra = nPersonasExtra * VALOR_PERSONA_EXTRA,
    valorHoraExtra = horasExtraNueva * VALOR_HORA_EXTRA,
    valorJacuzzi = nJacuzzi * VALOR_REACTIVA_JACUZZI,
    precioBase = precioSegunEstado(base.cabana, base.estado);
  await setDoc(
    doc(db, "historial_eventos", e.idReserva),
    {
      cliente: base.cliente,
      personas_extra: base.personasExtra,
      reactiva_jacuzzi: base.reactivaJacuzzi,
      hora_extra: base.horaExtra,
      horas_extra: horasExtraNueva,
      valor_personas_extra: valorPersonasExtra,
      valor_hora_extra: valorHoraExtra,
      valor_reactiva_jacuzzi: valorJacuzzi,
      total_general:
        precioBase + valorPersonasExtra + valorHoraExtra + valorJacuzzi,
      observacion: base.observacion,
      hora_fin: nuevoFin ? formatoHora(nuevoFin) : "Indefinido",
      total_horas: nuevaDuracionTotal,
      total_tiempo_ocupada: tiempoOcupadoSegunEstado(
        nuevaDuracionTotal,
        base.estado,
      ),
      modificado_por: trabajadorModifica,
      fecha_modificacion: new Date().toISOString(),
    },
    { merge: true },
  );
  cerrar("modal-modificar");
  aviso("Reserva modificada");
};
$("accion-eliminar").onclick = () => {
  cerrar("modal-acciones");
  if (eventoSeleccionado?.tipo === "aseo") {
    abrir("modal-eliminar-aseo");
    return;
  }
  abrir("modal-eliminar");
};
$("eliminar-solo-aseo").onclick = async () => {
  await borrarAseo(seleccionado);
  cerrar("modal-eliminar-aseo");
  aviso("Aseo eliminado");
};
$("eliminar-registro-completo").onclick = () => {
  cerrar("modal-eliminar-aseo");
  abrir("modal-eliminar");
};
// Elimina un registro de la agenda anterior (dias_reservas). Solo borra las
// horas de ESTE día; si la reserva sigue al día siguiente, hay que entrar
// a ese día y eliminarla ahí también. Deja constancia en el historial.
async function eliminarLegacy(e, trabajador, observacion) {
  if (e._claves?.length && e._fechaDoc) {
    const cambios = {};
    for (const k of e._claves) cambios[k] = deleteField();
    await updateDoc(doc(db, "dias_reservas", e._fechaDoc), cambios);
  }
  await addDoc(collection(db, "historial_eventos"), {
    id_reserva: e.idReserva,
    fecha_registro: new Date().toISOString(),
    fecha_dia: e._fechaDoc || fechaId(new Date(e.inicio)),
    cabana: "Cabaña " + e.cabana,
    accion: "Eliminación (agenda anterior)",
    hora_inicio: formatoHora(e.inicio),
    hora_fin: e.fin ? formatoHora(e.fin) : "Indefinido",
    total_horas: 0,
    total_tiempo_ocupada: 0,
    precio: 0,
    total_general: 0,
    trabajador: e.turno || "",
    estado_final: "Eliminada (migración)",
    cliente: e.cliente || "",
    personas_extra: e.personasExtra || "",
    reactiva_jacuzzi: e.reactivaJacuzzi || "",
    observacion: e.observacion || "",
    eliminado_por: trabajador,
    observacion_eliminacion: observacion,
    fecha_eliminacion: new Date().toISOString(),
    fecha_eliminacion_dia: fechaId(new Date()),
  });
}
$("form-eliminar").onsubmit = async (e) => {
  e.preventDefault();
  const trabajador = $("eliminar-trabajador").value,
    observacion = $("eliminar-observacion").value;
  if (eventoSeleccionado?.legacy) {
    await eliminarLegacy(eventoSeleccionado, trabajador, observacion);
  } else {
    const r = eventos.find(
      (x) => x.idReserva === seleccionado && x.tipo === "uso",
    );
    await marcarHistorialEliminado(r, trabajador, observacion);
    await borrarReserva(seleccionado);
  }
  cerrar("modal-eliminar");
  aviso("Reserva eliminada");
};
$("accion-salida").onclick = () => {
  const r = eventos.find(
    (x) => x.idReserva === seleccionado && x.tipo === "uso",
  );
  const ahora = new Date();
  $("salida-fecha").value = fechaId(ahora);
  $("salida-hora").value = ahora.toTimeString().slice(0, 5);
  $("salida-trabajador").value = r.turno || "";
  cerrar("modal-acciones");
  abrir("modal-salida");
};
$("form-salida").onsubmit = async (e) => {
  e.preventDefault();
  const r = eventos.find(
      (x) => x.idReserva === seleccionado && x.tipo === "uso",
    ),
    salida = new Date(
      `${$("salida-fecha").value}T${$("salida-hora").value}:00`,
    );
  const entrada = new Date(r.inicio);
  const salidaMinima = new Date(entrada.getTime() + 30 * 60 * 1000);
  if (salida < salidaMinima) {
    aviso("La salida debe tener mínimo 30 minutos de diferencia con la entrada.");
    return;
  }
  await borrarReserva(r.idReserva);
  r.fin = salida.toISOString();
  r.duracion = Math.floor(((salida - new Date(r.inicio)) / msHora) * 100) / 100;
  await escribirEvento(r);
  if (["ocupado", "reserva", "cortesia"].includes(r.estado))
    await escribirEvento({
      ...r,
      idEvento: `${r.idReserva}-aseo`,
      tipo: "aseo",
      estado: "aseo",
      cliente: "Limpieza",
      inicio: salida.toISOString(),
      fin: new Date(salida.getTime() + 6 * msHora).toISOString(),
      duracion: 6,
    });
  await setDoc(
    doc(db, "historial_eventos", r.idReserva),
    {
      hora_fin: formatoHora(salida),
      total_horas: r.duracion,
      total_tiempo_ocupada: tiempoOcupadoSegunEstado(r.duracion, r.estado),
      estado_final: "Salida registrada",
      salida_registrada_por: $("salida-trabajador").value,
      observacion_salida: $("salida-observacion").value,
      fecha_salida_registrada: new Date().toISOString(),
    },
    { merge: true },
  );
  cerrar("modal-salida");
  aviso("Salida registrada y aseo reprogramado");
};
// Administración y exportación de reportes.
$("btn-admin").onclick = () => abrir("modal-password");
$("btn-cancelar-password").onclick = () => cerrar("modal-password");
// Se guarda solo el hash de la contraseña, no el texto. Mismo login de siempre.
const HASHES_ADMIN = [
  "d7af1c018b68fc5b325f3e9cf56a82587f7057bc59fb7675e7b56451bcca086b",
  "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918",
];
const sha256Hex = async (texto) => {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
$("btn-ingresar-password").onclick = async () => {
  const hash = await sha256Hex($("password-admin").value);
  if (HASHES_ADMIN.includes(hash)) {
    $("admin-fecha-inicio").value = fechaId(new Date());
    $("admin-fecha-fin").value = fechaId(new Date());
    $("password-admin").value = "";
    cerrar("modal-password");
    abrir("modal-admin");
  } else aviso("Contraseña incorrecta");
};
$("btn-cerrar-admin").onclick = () => cerrar("modal-admin");
$("btn-descargar-excel").onclick = async () => {
  const a = $("admin-fecha-inicio").value,
    b = $("admin-fecha-fin").value;
  if (!a || !b) return;
  const qReservas = query(
      collection(db, "historial_eventos"),
      where("fecha_dia", ">=", a),
      where("fecha_dia", "<=", b),
    ),
    qEliminaciones = query(
      collection(db, "historial_eventos"),
      where("fecha_eliminacion_dia", ">=", a),
      where("fecha_eliminacion_dia", "<=", b),
    ),
    [reservas, eliminaciones] = await Promise.all([
      getDocs(qReservas),
      getDocs(qEliminaciones),
    ]),
    registros = new Map(
      [...reservas.docs, ...eliminaciones.docs].map((registro) => [
        registro.id,
        registro,
      ]),
    );
  let csv =
    "sep=;\r\nFecha;Cabaña;Acción;Inicio;Fin;Horas;Total tiempo ocupada;Precio;Eliminado por;Observación de eliminación;Fecha de eliminación;Personas extra;Reactivación jacuzzi;Trabajador;Cliente;Observación;Horas extra;Valor personas extra;Valor horas extra;Valor reactivación jacuzzi;Total general\r\n";
  registros.forEach((x) => {
    const d = x.data();
    csv +=
      [
        d.fecha_dia,
        d.cabana,
        d.accion === "Reserva" && d.estado_final
          ? nombreEstado(d.estado_final)
          : d.accion,
        d.hora_inicio,
        d.hora_fin,
        d.total_horas,
        d.total_tiempo_ocupada ?? d.total_horas ?? 0,
        d.precio ?? 0,
        d.eliminado_por ?? "",
        (d.observacion_eliminacion || "").replace(/;/g, ","),
        d.fecha_eliminacion ?? "",
        d.personas_extra ?? "",
        d.reactiva_jacuzzi ?? "",
        d.trabajador,
        d.cliente,
        (d.observacion || "").replace(/;/g, ","),
        d.horas_extra ?? 0,
        d.valor_personas_extra ?? 0,
        d.valor_hora_extra ?? 0,
        d.valor_reactiva_jacuzzi ?? 0,
        d.total_general ?? (d.precio ?? 0),
      ]
        .map((v) => `"${v}"`)
        .join(";") + "\r\n";
  });
  const bytes = new Uint8Array(2 + csv.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < csv.length; i++) {
    const codigo = csv.charCodeAt(i);
    bytes[2 + i * 2] = codigo & 0xff;
    bytes[3 + i * 2] = codigo >> 8;
  }
  const u = URL.createObjectURL(
      new Blob([bytes], {
        type: "text/csv;charset=utf-16le",
      }),
    ),
    l = document.createElement("a");
  l.href = u;
  l.download = `Reporte_CabanApp_${a}_${b}.csv`;
  l.click();
  URL.revokeObjectURL(u);
  cerrar("modal-admin");
};
// --- Notificaciones push del celular (FCM) ---
// El botón "Notificaciones" del inicio controla SOLO esto. Apagado por defecto.
// Apagado = el dispositivo no está registrado y el servidor no le envía nada.
let messaging = null;
const pushConfigurado = () =>
  VAPID_KEY && !VAPID_KEY.startsWith("PEGA_AQUI");

async function initMessaging() {
  if (messaging || !pushConfigurado()) return messaging;
  try {
    if (!(await isMessagingSupported())) return null;
    messaging = getMessaging(app);
    // Si llega un push con la app abierta, se muestra como aviso en pantalla.
    onMessage(messaging, (p) => {
      const n = p.notification || {};
      aviso(`${n.title || "CabanApp"}${n.body ? " · " + n.body : ""}`);
    });
  } catch (_) {
    messaging = null;
  }
  return messaging;
}

async function tokenDispositivo() {
  await initMessaging();
  if (!messaging) return null;
  const reg = await navigator.serviceWorker.ready;
  return getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: reg,
  });
}

async function activarNotificaciones() {
  if (!pushConfigurado()) {
    aviso("Las notificaciones todavía no están configuradas.");
    return false;
  }
  if (!("Notification" in window) || !(await isMessagingSupported())) {
    aviso("Este dispositivo no admite notificaciones. En iPhone hay que abrir la app desde la pantalla de inicio.");
    return false;
  }
  if ((await Notification.requestPermission()) !== "granted") {
    aviso("No diste permiso para las notificaciones.");
    return false;
  }
  let token = null;
  try {
    token = await tokenDispositivo();
  } catch (_) {
    token = null;
  }
  if (!token) {
    aviso("No se pudo activar las notificaciones en este dispositivo.");
    return false;
  }
  const id = await sha256Hex(token);
  await setDoc(doc(db, "dispositivos", id), {
    token,
    user_agent: navigator.userAgent,
    creado: new Date().toISOString(),
  });
  localStorage.setItem("cabanapp-push-token", token);
  localStorage.setItem("cabanapp-push-id", id);
  aviso("Notificaciones activadas en este dispositivo.");
  return true;
}

async function desactivarNotificaciones() {
  const id = localStorage.getItem("cabanapp-push-id");
  if (id) await deleteDoc(doc(db, "dispositivos", id)).catch(() => {});
  try {
    if (await initMessaging()) await deleteToken(messaging);
  } catch (_) {}
  localStorage.removeItem("cabanapp-push-token");
  localStorage.removeItem("cabanapp-push-id");
  aviso("Notificaciones desactivadas en este dispositivo.");
}

// Avisa al servidor para que mande el push a todos los dispositivos registrados.
async function enviarPush(titulo, cuerpo) {
  if (!pushConfigurado()) return;
  try {
    await fetch("/api/notificar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: NOTIFY_SECRET,
        titulo,
        cuerpo,
        excepto: localStorage.getItem("cabanapp-push-token") || "",
      }),
    });
  } catch (_) {
    /* la reserva ya quedó guardada; el push es secundario */
  }
}

// Preferencias y suscripción en tiempo real a Firestore.
$("notificaciones").checked =
  localStorage.getItem("cabanapp-notificaciones") === "si";
if ($("notificaciones").checked) initMessaging();
$("notificaciones").onchange = async (e) => {
  const quiere = e.target.checked;
  e.target.disabled = true;
  const activo = quiere
    ? await activarNotificaciones()
    : (await desactivarNotificaciones(), false);
  e.target.checked = activo;
  localStorage.setItem("cabanapp-notificaciones", activo ? "si" : "no");
  e.target.disabled = false;
};
onSnapshot(collection(db, "agenda_eventos"), (s) => {
  eventos = s.docs.map((d) => d.data());
  if (cargado && $("notificaciones").checked) {
    s.docChanges()
      .filter((c) => c.type === "added" && c.doc.data().tipo === "uso")
      .forEach((c) =>
        aviso(
          `Nueva reserva · Cabaña ${c.doc.data().cabana} · ${c.doc.data().cliente}`,
        ),
      );
  }
  cargado = true;
  render();
});
opcionesDuracion();
escucharLegacy();
render();
// Registro del service worker (instalable como app / base para offline).
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("sw.js").catch(() => {});
