"""PanAndino - tienda de tortas por encargo, sin dependencias externas.
Ejecutar: python app.py  |  Abrir: http://127.0.0.1:8000
"""
from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
DB_FILE = BASE_DIR / "panandino.db"
HOST = os.environ.get("PANANDINO_HOST", "127.0.0.1")
PORT = int(os.environ.get("PANANDINO_PORT", "8000"))
ADMIN_PIN = os.environ.get("PANANDINO_ADMIN_PIN", "1234")
SESSION_SECRET = secrets.token_bytes(32)
DB_LOCK = threading.RLock()
ESTADOS = ("Registrado", "En preparación", "Entregado")
LIMA_TZ = timezone(timedelta(hours=-5))

PRODUCTOS_INICIALES = [
    ("Torta de Chocolate", "Chocolate intenso y ganache sedoso", "Mediana · 12 porciones", 6800, 7, "🍫", "chocolate", "Favorita"),
    ("Red Velvet", "Bizcocho rojo y crema de queso", "Mediana · 12 porciones", 7800, 5, "🍓", "velvet", "Más pedida"),
    ("Torta de Fresa", "Fresas frescas y crema ligera", "Pequeña · 8 porciones", 5900, 6, "🍓", "fresa", "De temporada"),
    ("Tres Leches", "Esponjosa, húmeda y tradicional", "Mediana · 12 porciones", 6400, 8, "🥛", "tresleches", "Clásica"),
    ("Torta de Zanahoria", "Especias suaves y frosting cremoso", "Pequeña · 8 porciones", 5600, 6, "🥕", "zanahoria", "Artesanal"),
    ("Cheesecake de Maracuyá", "Suave, fresco y con toque cítrico", "Pequeña · 8 porciones", 7200, 4, "🍋", "maracuya", "Especial"),
]


def hoy_lima():
    return datetime.now(LIMA_TZ).date()


def conexion():
    db = sqlite3.connect(DB_FILE, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def inicializar_db():
    with DB_LOCK, conexion() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS productos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nombre TEXT NOT NULL,
              descripcion TEXT NOT NULL,
              tamano TEXT NOT NULL,
              precio_centimos INTEGER NOT NULL CHECK(precio_centimos > 0),
              cupo_diario INTEGER NOT NULL CHECK(cupo_diario >= 0),
              emoji TEXT NOT NULL,
              estilo TEXT NOT NULL,
              etiqueta TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS clientes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nombre TEXT NOT NULL,
              correo TEXT NOT NULL UNIQUE COLLATE NOCASE,
              telefono TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pedidos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              codigo TEXT NOT NULL,
              cliente_id INTEGER NOT NULL,
              producto_id INTEGER NOT NULL,
              cantidad INTEGER NOT NULL CHECK(cantidad > 0),
              fecha_entrega TEXT NOT NULL,
              estado TEXT NOT NULL DEFAULT 'Registrado',
              precio_unitario_centimos INTEGER NOT NULL,
              creado_en TEXT NOT NULL,
              FOREIGN KEY(cliente_id) REFERENCES clientes(id),
              FOREIGN KEY(producto_id) REFERENCES productos(id)
            );
            CREATE INDEX IF NOT EXISTS idx_pedidos_codigo ON pedidos(codigo);
            CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_producto ON pedidos(fecha_entrega, producto_id);
        """)
        if db.execute("SELECT COUNT(*) FROM productos").fetchone()[0] == 0:
            db.executemany("""
              INSERT INTO productos (nombre,descripcion,tamano,precio_centimos,cupo_diario,emoji,estilo,etiqueta)
              VALUES (?,?,?,?,?,?,?,?)
            """, PRODUCTOS_INICIALES)
        db.commit()


def firma_admin():
    return hmac.new(SESSION_SECRET, b"panandino-admin", hashlib.sha256).hexdigest()


def datos_pedidos(db, codigo=None, correo=None, todos=False):
    sql = """SELECT p.codigo, p.fecha_entrega, p.estado, p.cantidad, p.precio_unitario_centimos,
             p.creado_en, pr.nombre AS producto, c.nombre AS cliente, c.correo, c.telefono
             FROM pedidos p JOIN clientes c ON c.id=p.cliente_id
             JOIN productos pr ON pr.id=p.producto_id"""
    conditions, params = [], []
    if codigo:
        conditions.append("p.codigo = ?")
        params.append(codigo)
    if correo:
        conditions.append("c.correo = ? COLLATE NOCASE")
        params.append(correo)
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY p.creado_en DESC, p.id"
    rows = db.execute(sql, params).fetchall()
    grouped = {}
    for item in rows:
        code = item["codigo"]
        if code not in grouped:
            grouped[code] = {
                "codigo": code, "fecha_entrega": item["fecha_entrega"], "estado": item["estado"],
                "cliente": item["cliente"], "correo": item["correo"], "telefono": item["telefono"],
                "creado_en": item["creado_en"], "total_centimos": 0, "items": []
            }
        sub = item["cantidad"] * item["precio_unitario_centimos"]
        grouped[code]["items"].append({"producto":item["producto"], "cantidad":item["cantidad"], "subtotal_centimos":sub})
        grouped[code]["total_centimos"] += sub
    return list(grouped.values())


class ApiError(Exception):
    def __init__(self, mensaje, status=400):
        self.mensaje = mensaje
        self.status = status


class PanAndinoHandler(BaseHTTPRequestHandler):
    server_version = "PanAndino/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def responder_json(self, obj, status=200, cookie=None):
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def error_api(self, mensaje, status=400):
        self.responder_json({"ok": False, "error": mensaje}, status)

    def recibir_json(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size <= 0 or size > 25_000:
            raise ApiError("El cuerpo de la solicitud está vacío o es demasiado grande.")
        try:
            result = json.loads(self.rfile.read(size))
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except (ValueError, UnicodeDecodeError):
            raise ApiError("La solicitud debe contener un JSON válido.")

    def admin(self):
        c = SimpleCookie()
        try:
            c.load(self.headers.get("Cookie", ""))
            token = c.get("panandino_admin")
            return token is not None and hmac.compare_digest(token.value, firma_admin())
        except Exception:
            return False

    def exigir_admin(self):
        if not self.admin():
            raise ApiError("Inicia sesión como administradora.", 401)

    def servir_archivo(self, ruta):
        if ruta in ("/", "/index.html"):
            file = BASE_DIR / "templates" / "index.html"
        elif ruta.startswith("/static/"):
            file = (BASE_DIR / ruta.lstrip("/")).resolve()
            if not file.is_relative_to((BASE_DIR / "static").resolve()):
                self.send_error(HTTPStatus.FORBIDDEN)
                return
        else:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not file.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content = file.read_bytes()
        mime, _ = mimetypes.guess_type(str(file))
        self.send_response(200)
        self.send_header("Content-Type", (mime or "application/octet-stream") + ("; charset=utf-8" if file.suffix in (".html", ".css", ".js") else ""))
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def manejar(self, metodo):
        url = urlparse(self.path)
        ruta = url.path.rstrip("/") or "/"
        if metodo == "GET" and not ruta.startswith("/api/"):
            return self.servir_archivo(ruta)
        try:
            if metodo == "GET" and ruta == "/api/productos":
                return self.api_productos(parse_qs(url.query))
            if metodo == "POST" and ruta == "/api/pedidos":
                return self.crear_pedido(self.recibir_json())
            if metodo == "GET" and ruta.startswith("/api/pedidos/"):
                codigo = ruta.split("/")[-1].strip().upper()
                return self.buscar_pedido(codigo, parse_qs(url.query))
            if metodo == "POST" and ruta == "/api/admin/login":
                return self.login(self.recibir_json())
            if metodo == "POST" and ruta == "/api/admin/logout":
                return self.responder_json({"ok":True}, cookie="panandino_admin=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict")
            if metodo == "GET" and ruta == "/api/admin/session":
                return self.responder_json({"autenticado":self.admin()})
            if metodo == "GET" and ruta == "/api/admin/pedidos":
                self.exigir_admin()
                with conexion() as db:
                    return self.responder_json({"pedidos":datos_pedidos(db,todos=True)})
            if metodo == "PATCH" and ruta.startswith("/api/admin/pedidos/"):
                self.exigir_admin()
                return self.cambiar_estado(ruta.split("/")[-1].upper(),self.recibir_json())
            raise ApiError("Ruta no encontrada.",404)
        except ApiError as e:
            return self.error_api(e.mensaje,e.status)
        except sqlite3.Error as e:
            print("Error SQLite:",e)
            return self.error_api("No se pudo acceder a la base de datos.",500)
        except (TypeError, ValueError) as e:
            return self.error_api("Revisa los datos enviados.",400)

    def do_GET(self): self.manejar("GET")
    def do_POST(self): self.manejar("POST")
    def do_PATCH(self): self.manejar("PATCH")

    def api_productos(self, query):
        fecha = query.get("fecha", [hoy_lima().isoformat()])[0]
        try:
            date.fromisoformat(fecha)
        except ValueError:
            raise ApiError("La fecha es inválida.")
        with conexion() as db:
            rows = db.execute("""
              SELECT pr.*, COALESCE(SUM(CASE WHEN p.fecha_entrega = ? THEN p.cantidad ELSE 0 END),0) as reservados
              FROM productos pr LEFT JOIN pedidos p ON p.producto_id=pr.id
              GROUP BY pr.id ORDER BY pr.id
            """, (fecha,)).fetchall()
            datos = [{"id": r["id"],"nombre":r["nombre"], "descripcion":r["descripcion"],
                      "tamano":r["tamano"], "precio_centimos":r["precio_centimos"],
                      "cupo_diario":r["cupo_diario"],"disponibles":max(0,r["cupo_diario"]-r["reservados"]),
                      "emoji":r["emoji"],"estilo":r["estilo"],"etiqueta":r["etiqueta"]} for r in rows]
        self.responder_json({"productos":datos,"fecha":fecha})

    def crear_pedido(self, body):
        nombre = str(body.get("nombre", "")).strip()[:90]
        correo = str(body.get("correo", "")).strip().lower()[:120]
        telefono = str(body.get("telefono", "")).strip()[:25]
        fecha_entrega = str(body.get("fecha_entrega", "")).strip()
        items = body.get("items")
        if len(nombre)<3 or "@" not in correo or "." not in correo.split("@")[-1] or len(telefono)<6:
            raise ApiError("Completa tu nombre, un correo válido y un teléfono.")
        try:
            fecha = date.fromisoformat(fecha_entrega)
        except ValueError:
            raise ApiError("Selecciona una fecha de entrega válida.")
        if fecha < hoy_lima() or fecha > hoy_lima()+timedelta(days=120):
            raise ApiError("La entrega debe ser entre hoy y los próximos 120 días.")
        if not isinstance(items,list) or not 1<=len(items)<=12:
            raise ApiError("Añade al menos una torta al carrito.")
        unidades = {}
        for item in items:
            if not isinstance(item,dict) or type(item.get("id")) is not int or type(item.get("cantidad")) is not int:
                raise ApiError("Hay productos inválidos en el carrito.")
            pid, cantidad = item["id"], item["cantidad"]
            if not 1 <= cantidad <= 30:
                raise ApiError("La cantidad de cada torta debe estar entre 1 y 30.")
            unidades[pid] = unidades.get(pid,0)+cantidad
        codigo = "PA-"+hoy_lima().strftime("%y%m%d")+"-"+secrets.token_hex(3).upper()
        creado_en = datetime.now(LIMA_TZ).isoformat(timespec="seconds")
        with DB_LOCK, conexion() as db:
            db.execute("BEGIN IMMEDIATE")
            productos = {}
            for pid, cantidad in unidades.items():
                row = db.execute("""SELECT pr.*,
                  (SELECT COALESCE(SUM(cantidad),0) FROM pedidos WHERE producto_id=pr.id AND fecha_entrega=?) as ocupados
                  FROM productos pr WHERE pr.id=?""",(fecha_entrega,pid)).fetchone()
                if not row:
                    raise ApiError("Uno de los productos ya no existe.")
                disponibles = row["cupo_diario"]-row["ocupados"]
                if cantidad>disponibles:
                    raise ApiError(f"Solo quedan {max(0,disponibles)} unidades de {row['nombre']} para esa fecha.",409)
                productos[pid] = row
            cli = db.execute("SELECT id FROM clientes WHERE correo=? COLLATE NOCASE",(correo,)).fetchone()
            if cli:
                cliente_id = cli["id"]
                db.execute("UPDATE clientes SET nombre=?, telefono=? WHERE id=?",(nombre,telefono,cliente_id))
            else:
                cliente_id = db.execute("INSERT INTO clientes(nombre,correo,telefono) VALUES(?,?,?)",(nombre,correo,telefono)).lastrowid
            total = 0
            for pid, cantidad in unidades.items():
                precio = productos[pid]["precio_centimos"]
                total += precio*cantidad
                db.execute("""INSERT INTO pedidos(codigo,cliente_id,producto_id,cantidad,fecha_entrega,estado,precio_unitario_centimos,creado_en)
                  VALUES(?,?,?,?,?,?,?,?)""",(codigo,cliente_id,pid,cantidad,fecha_entrega,"Registrado",precio,creado_en))
            db.commit()
        self.responder_json({"ok":True,"codigo":codigo,"fecha_entrega":fecha_entrega,"total_centimos":total},201)

    def buscar_pedido(self, codigo, query):
        correo = query.get("correo",[""])[0].strip().lower()
        if not correo:
            raise ApiError("Ingresa el correo con el que realizaste el pedido.")
        with conexion() as db:
            encontrado = datos_pedidos(db,codigo=codigo,correo=correo)
        if not encontrado:
            raise ApiError("No encontramos ese pedido con el correo ingresado.",404)
        self.responder_json({"pedido":encontrado[0]})

    def login(self, body):
        pin = str(body.get("pin", ""))
        if not hmac.compare_digest(pin,ADMIN_PIN):
            raise ApiError("Contraseña incorrecta.",401)
        cookie = f"panandino_admin={firma_admin()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800"
        self.responder_json({"ok":True},cookie=cookie)

    def cambiar_estado(self, codigo, body):
        nuevo = body.get("estado")
        if nuevo not in ESTADOS:
            raise ApiError("Estado inválido.")
        with DB_LOCK, conexion() as db:
            db.execute("BEGIN IMMEDIATE")
            actual = db.execute("SELECT estado FROM pedidos WHERE codigo=? LIMIT 1",(codigo,)).fetchone()
            if not actual:
                raise ApiError("Pedido no encontrado.",404)
            if ESTADOS.index(nuevo)<ESTADOS.index(actual["estado"]):
                raise ApiError("No se puede retroceder el estado de un pedido.",409)
            db.execute("UPDATE pedidos SET estado=? WHERE codigo=?",(nuevo,codigo))
            db.commit()
        self.responder_json({"ok":True,"codigo":codigo,"estado":nuevo})


def main():
    inicializar_db()
    try:
        servidor = ThreadingHTTPServer((HOST,PORT),PanAndinoHandler)
    except OSError as exc:
        print(f"No se pudo iniciar el servidor en el puerto {PORT}: {exc}")
        print("Prueba otro puerto: set PANANDINO_PORT=8001 (Windows) o export PANANDINO_PORT=8001 (Linux).")
        return
    print("="*52)
    print("  PANANDINO | TORTAS POR ENCARGO")
    print(f"  Abre en tu navegador: http://{HOST}:{PORT}")
    print("  Administradora (demo): contraseña 1234")
    print("  Para detenerlo: CTRL + C")
    print("="*52)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
