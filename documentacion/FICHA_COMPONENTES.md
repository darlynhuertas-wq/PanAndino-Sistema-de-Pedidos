# Ficha de componentes | PanAndino
**Caso:** PanAndino vende tortas artesanales por encargo.

**1. Tipo de comercio: B2C (Business to Consumer).** La pastelería vende directamente a personas que compran una torta para una celebración, sin intermediarios empresariales.

**2. Base de datos: 3 tablas (ejemplos de datos).**

| Tabla | Tres datos principales | Relación |
|---|---|---|
| Productos | Nombre, tamaño, precio | Un producto aparece en varios registros de pedido. |
| Clientes | Nombre, correo, teléfono | Un cliente puede hacer varios pedidos. |
| Pedidos | Cantidad, fecha de entrega, estado | Cada registro apunta a un cliente y un producto. |

Campos adicionales permiten controlar el cupo por día, guardar el código, conocer el total y el estado. Un pedido con diferentes tortas se representa con filas que comparten un mismo código.

**3. Rutas y controlador (4 rutas).**

- `GET /api/productos?fecha=AAAA-MM-DD`: muestra tortas, precios, tamaños y unidades disponibles en esa fecha.
- `POST /api/pedidos`: registra los datos del cliente y sus productos seleccionados.
- `GET /api/pedidos/{codigo}?correo=...`: permite al cliente consultar su pedido.
- `PATCH /api/admin/pedidos/{codigo}`: permite a la dueña cambiar el estado de un pedido.

**Regla de validación:** el controlador no debe guardar un pedido si la fecha ya pasó o si la cantidad solicitada supera el cupo libre de alguna torta para ese día. Los estados avanzan de Registrado → En preparación → Entregado.

**4. Vistas y tecnologías (3 pantallas).**

- **Catálogo y carrito:** lista de tortas, tamaños, precios, disponibilidad y confirmación de compra.
- **Mis pedidos:** búsqueda por código y correo; muestra la fecha, el total y el estado.
- **Administración:** listado de pedidos y control de estados para la dueña.

**Tecnologías:** HTML y CSS para las vistas; JavaScript para las interacciones y llamadas a la API; Python para rutas/controladores; SQLite para guardar las 3 tablas.

**5. Puesta en común - decisión del equipo.** Priorizar la validación de disponibilidad según la fecha de entrega para evitar aceptar más tortas de las que puede preparar la panadería.
