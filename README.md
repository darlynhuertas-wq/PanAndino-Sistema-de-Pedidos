# PanAndino | Tienda de tortas por encargo

Proyecto académico listo para ejecutar, basado en el caso de Tecsup **"PanAndino vende tortas por encargo"**.

## Inicio rápido en Windows 11

1. Instala Python 3.10 o posterior si aún no lo tienes (https://www.python.org/downloads/). Al instalarlo, marca **Add Python to PATH**.
2. Descomprime el ZIP en una carpeta, por ejemplo `Escritorio/PanAndino`.
3. Entra a la carpeta y haz doble clic en **`INICIAR_WINDOWS.bat`**. **No cierres** la ventana negra.
4. Abre Chrome o Edge y escribe: **http://127.0.0.1:8000**
5. Prueba el catálogo, agrega tortas y confirma un pedido. Para cambiar el estado, entra en **Administración** con la contraseña de demostración **`1234`**.
6. Para detener el servidor, regresa a la terminal y presiona **Ctrl + C**.

## Inicio desde VS Code

1. Abre en VS Code la carpeta `PanAndino` (Archivo > Abrir carpeta).
2. Ve a **Terminal > Nuevo terminal**.
3. Ejecuta en Windows:

   ```powershell
   py app.py
   ```

   Si `py` no funciona, prueba `python app.py`. En Linux/macOS, usa `python3 app.py`.
4. Abre http://127.0.0.1:8000.

**No necesitas ejecutar `npm install`, `pip install` ni instalar ninguna base de datos.** Python crea `panandino.db` automáticamente en la primera ejecución.

## Funciones

- **Catálogo:** seis tortas de ejemplo con tamaño, precio y cupo disponible por fecha.
- **Carrito:** seleccionar tortas y ajustar cantidades.
- **Confirmación:** registrar nombre, correo, teléfono y fecha de entrega. El servidor verifica disponibilidad antes de guardar el pedido.
- **Mis pedidos:** consultar un pedido con su código y correo.
- **Administración:** la dueña ve todos los pedidos y cambia de `Registrado` a `En preparación` y luego `Entregado`.
- **Persistencia:** base de datos SQLite en el archivo `panandino.db`.

## Tecnologías y estructura

```text
PanAndino/
├── app.py                     # Servidor HTTP + API REST + SQLite
├── INICIAR_WINDOWS.bat        # Inicio con doble clic (Windows)
├── requirements.txt           # No hay dependencias adicionales
├── README.md
├── templates/
│   └── index.html             # Tres vistas de usuario
├── static/
│   ├── css/styles.css         # Diseño adaptable
│   └── js/app.js              # Interacciones, carrito y API
└── documentacion/
    ├── FICHA_COMPONENTES.pdf  # Entregable de una página
    └── FICHA_COMPONENTES.md   # Texto editable
```

La estructura cumple el ejercicio con **tres tablas**: `productos`, `clientes` y `pedidos`. Los registros en `pedidos` tienen claves foráneas a productos y clientes; cuando se piden varios productos, comparten el mismo código de pedido.

## Rutas API principales

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/productos?fecha=AAAA-MM-DD` | Listar tortas y disponibilidad diaria |
| POST | `/api/pedidos` | Validar stock y registrar pedido |
| GET | `/api/pedidos/CODIGO?correo=...` | Consultar estado del pedido |
| PATCH | `/api/admin/pedidos/CODIGO` | Actualizar el estado (requiere acceso de administradora) |

Rutas auxiliares: `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/session` y `GET /api/admin/pedidos`.

### Regla del controlador

**Antes de registrar**, comprueba que la fecha sea válida y que la cantidad pedida no supere las unidades disponibles de cada torta **en la fecha de entrega elegida**. La reserva se registra en una transacción SQLite para evitar confirmar cupos superiores al permitido.

## Contraseña y seguridad

La contraseña `1234` es **solo para evaluación local**. Para cambiarla, establece la variable de entorno `PANANDINO_ADMIN_PIN` antes de encender el servidor:

```powershell
$env:PANANDINO_ADMIN_PIN = 'MiClaveSegura'
py app.py
```

El servidor utiliza por defecto `127.0.0.1` (no está publicado a Internet). **No uses el prototipo como tienda pública ni almacenes datos reales de clientes sin añadir autenticación robusta, HTTPS, validación adicional, protección CSRF y políticas de privacidad.**

## Resolución de problemas

- **`py` no se reconoce:** instala Python y activa `Add Python to PATH` o usa `python app.py`.
- **Página no abre:** verifica que la terminal muestre `Abre en tu navegador: http://127.0.0.1:8000` y que siga abierta.
- **Puerto ocupado:** en PowerShell ejecuta `$env:PANANDINO_PORT='8001'` y luego `py app.py`. Abre http://127.0.0.1:8001.
- **Quiero reiniciar los pedidos:** con el servidor apagado, borra `panandino.db`. Al volver a ejecutarlo se creará una base nueva con las tortas de ejemplo.
- **No se ven las fuentes especiales:** la web usa fuentes de Google Fonts cuando hay Internet; sin Internet emplea las fuentes alternativas instaladas.
