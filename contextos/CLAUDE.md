# CocinaMágica — Contexto Completo del Proyecto

## Objetivo y Finalidad

CocinaMágica es una aplicación web de gestión de cocina doméstica orientada a familias chilenas. Su propósito central es eliminar la pregunta diaria "¿qué cocinamos?" conectando la despensa real del hogar con un catálogo de recetas, calculando automáticamente qué platos se pueden preparar con lo que hay disponible, cuánto cuestan y qué falta comprar.

### Finalidades específicas
- **Reducir el desperdicio alimentario**: alerta de ingredientes por vencer y sugiere recetas que los consuman.
- **Control de presupuesto**: valoriza la despensa y el menú semanal en pesos chilenos (CLP).
- **Planificación familiar**: genera menús semanales ajustados a número de personas, presupuesto y restricciones dietéticas de cada integrante.
- **Nutrición familiar**: muestra macronutrientes (calorías, proteínas, carbohidratos, grasas) por receta y por día.
- **Conveniencia social**: comparte menús y listas de compra por WhatsApp o enlace web.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js (sin versión fija; compatible con Node 18+) |
| Framework backend | Express 4.18.2 |
| Base de datos | PostgreSQL 16 |
| ORM/driver | pg 8.11.3 (node-postgres) |
| Frontend | Vanilla JS (sin frameworks) |
| UI | Bootstrap 5.3 (CDN) |
| Iconos | Font Awesome 6.4 (CDN) |
| Fuentes | Inter + Playfair Display (Google Fonts CDN) |
| Servidor | `http://localhost:3001` |

**Sin bundler, sin TypeScript, sin React.** Todo el frontend es HTML/CSS/JS puro servido estáticamente desde `/public`.

---

## Estructura de Archivos

```
Web_receta/
├── server.js          # Backend completo (Express + PostgreSQL + rutas API)
├── package.json       # { "start": "node server.js" }
├── receta.md          # Notas de desarrollo
├── contextos/
│   └── CLAUDE.md      # Este archivo
└── public/
    ├── index.html     # SPA de una sola página con 7 tabs
    ├── app.js         # Toda la lógica frontend (~3000 líneas)
    └── styles.css     # Estilos personalizados + tema dark
```

---

## Base de Datos — Esquema Completo

Base de datos: `cocina_magica` | Usuario: `postgres` | Password: `Chileno0` | Puerto: `5432`

### Tablas

#### `ingredients`
```sql
id            VARCHAR(100) PRIMARY KEY   -- slug único, ej: 'pollo', 'carne_molida'
name          VARCHAR(200) NOT NULL      -- nombre display
base_unit     VARCHAR(20)               -- 'g', 'ml' o 'unidades'
price_per_base DECIMAL(12,6)            -- CLP por unidad base (por g, por ml, o por ud.)
conversion    JSONB                      -- {"kilos":1000, "litros":1000, "unidades":150}
nutrition     JSONB                      -- {"cals":N, "p":N, "c":N, "f":N} por 100g/100ml/ud
category      VARCHAR(50)               -- 'verduras','frutas','carnes','pescados','lacteos',
                                        --   'abarrotes','panaderia','bebestibles','especias','otros'
```
**~680 ingredientes** cargados (190 iniciales + 490 agregados vía seed SQL).

#### `recipes`
```sql
id               SERIAL PRIMARY KEY
name             VARCHAR(200)
type             VARCHAR(50)        -- 'entrada','comida','once','postre','trago'
base_portions    INTEGER            -- porciones base (generalmente 4)
diets            TEXT[]             -- ['vegano','keto','sin gluten','saludable','diabetico']
instructions     TEXT               -- paso a paso detallado
cook_time_minutes INTEGER
season           VARCHAR(20)        -- 'all','verano','otono','invierno','primavera'
```
**23 recetas** chilenas clásicas en seed inicial. El usuario puede agregar más.

#### `recipe_ingredients`
```sql
recipe_id      INTEGER REFERENCES recipes(id) ON DELETE CASCADE
ingredient_id  VARCHAR(100) REFERENCES ingredients(id)
qty            DECIMAL(10,2)
unit           VARCHAR(20)   -- puede diferir de base_unit (ej: 'kilos' cuando base es 'g')
PRIMARY KEY (recipe_id, ingredient_id)
```

#### `pantry`
```sql
ingredient_id  VARCHAR(100) REFERENCES ingredients(id) PRIMARY KEY
quantity       DECIMAL(12,4)   -- en la unidad base del ingrediente
expiry_date    DATE            -- opcional; NULL = sin fecha de vencimiento
```

#### `recipe_ratings`
```sql
recipe_id  INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE
rating     INTEGER CHECK (1..5)
comment    TEXT
rated_at   TIMESTAMP
```

#### `recipe_notes`
```sql
recipe_id   INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE
note        TEXT
updated_at  TIMESTAMP
```

#### `recipe_photos`
```sql
recipe_id   INTEGER PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE
photo_data  TEXT    -- base64 data URL
uploaded_at TIMESTAMP
```

#### `cook_history`
```sql
id         SERIAL PRIMARY KEY
recipe_id  INTEGER REFERENCES recipes(id)
cooked_at  DATE
portions   INTEGER
```

#### `family_members`
```sql
id         SERIAL PRIMARY KEY
name       VARCHAR(100)
allergies  TEXT[]     -- ingrediente IDs que generan alerta en recetas
dislikes   TEXT[]     -- ingredientes que no le gustan
diets      TEXT[]     -- restricciones dietéticas del miembro
is_active  BOOLEAN    -- si está activo, sus alergias se marcan en recetas
created_at TIMESTAMP
```

#### `saved_menus` + `saved_menu_days`
```sql
-- saved_menus
id         SERIAL PRIMARY KEY
label      VARCHAR(200)    -- nombre/etiqueta del menú
week_start DATE
persons    INTEGER
budget     INTEGER
created_at TIMESTAMP

-- saved_menu_days
menu_id    INTEGER REFERENCES saved_menus(id) ON DELETE CASCADE
day_name   VARCHAR(20)     -- 'Lunes','Martes'...
recipe_id  INTEGER REFERENCES recipes(id)
day_type   VARCHAR(20)
PRIMARY KEY (menu_id, day_name)
```

#### `weekly_budget`
```sql
week_start DATE PRIMARY KEY
amount     INTEGER    -- presupuesto CLP para esa semana
```

#### `daily_reminder`
```sql
id            INTEGER PRIMARY KEY DEFAULT 1    -- siempre un solo registro
reminder_time TIME
is_active     BOOLEAN
```

#### `shared_views`
```sql
id         VARCHAR(8) PRIMARY KEY    -- código corto aleatorio
data       JSONB                     -- snapshot del menú/lista
created_at TIMESTAMP
```

### Convención de precios
- `price_per_base` se almacena **por unidad base mínima**: CLP/g, CLP/ml, o CLP/unidad.
- Para mostrar al usuario: multiplicar ×1000 para g→kg o ml→L.
- Ejemplo: pollo a $3.2/g → se muestra como `$3.200/kg`.
- Formato display: `toLocaleString('es-CL')` para separadores de miles.

---

## API REST — Endpoints Completos

Todos los endpoints están en `server.js`. Base URL: `http://localhost:3001/api`

### Ingredientes
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/ingredients` | Todos los ingredientes de la DB |
| POST | `/api/ingredients` | Crear nuevo ingrediente custom |
| PATCH | `/api/ingredients/:id/price` | Actualizar precio de un ingrediente |
| POST | `/api/ingredients/update-prices` | Actualizar precios en masa (endpoint nuevo, requiere reinicio) |

### Despensa (Pantry)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/pantry` | Contenido actual de la despensa |
| POST | `/api/pantry` | Agregar/sumar ingrediente a despensa |
| PUT | `/api/pantry/:id` | Actualizar cantidad de un ingrediente |
| DELETE | `/api/pantry/:id` | Eliminar ingrediente de la despensa |

### Recetas
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/recipes` | Todas las recetas con sus ingredientes |
| POST | `/api/recipes` | Crear nueva receta |

### Valoraciones, Notas y Fotos
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/ratings` | Todas las valoraciones |
| POST | `/api/recipes/:id/rating` | Guardar valoración (1–5) + comentario |
| GET | `/api/notes` | Todas las notas |
| POST | `/api/recipes/:id/note` | Guardar/actualizar nota de receta |
| GET | `/api/photos` | IDs de recetas con foto |
| GET | `/api/recipes/:id/photo` | Foto de una receta (base64) |
| POST | `/api/recipes/:id/photo` | Subir foto (base64) |
| DELETE | `/api/recipes/:id/photo` | Eliminar foto |

### Historial
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/history` | Historial de platos cocinados |
| POST | `/api/history` | Registrar que se cocinó una receta |
| DELETE | `/api/history` | Limpiar historial completo |

### Familia
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/family` | Todos los integrantes |
| POST | `/api/family` | Agregar integrante |
| PUT | `/api/family/:id` | Editar integrante |
| DELETE | `/api/family/:id` | Eliminar integrante |

### Menús, Presupuesto y Recordatorio
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/menus/saved` | Menús guardados |
| POST | `/api/menus/saved` | Guardar menú actual |
| DELETE | `/api/menus/saved/:id` | Eliminar menú guardado |
| GET | `/api/budget` | Presupuesto de la semana actual |
| POST | `/api/budget` | Guardar presupuesto semanal |
| GET | `/api/reminder` | Configuración de recordatorio diario |
| POST | `/api/reminder` | Actualizar recordatorio |

### Compartir
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/share` | Crear snapshot compartible (devuelve `id` de 8 chars) |
| GET | `/api/share/:id` | Obtener datos del snapshot |
| GET | `/compartir/:id` | Página pública renderizada del menú compartido |

---

## Frontend — Estructura de Tabs (index.html + app.js)

La interfaz es una SPA con 7 pestañas en la barra de navegación superior.

### 1. 🥦 Despensa
- **Hero banner** con métricas en tiempo real: total de ingredientes en despensa, valor monetario total, cantidad de platos que se pueden cocinar ahora.
- **Formulario "Agregar a Despensa"**: selector de ingrediente (todos los ~680 del catálogo), cantidad, unidad y fecha de vencimiento opcional.
- **Botón "Crear Nuevo Ingrediente"**: modal para definir un ingrediente con todos sus campos nutricionales y precio.
- **Tabla "Mi Despensa"**: lista paginada (10/50/todas) con búsqueda. Columnas: Ingrediente, Cantidad, Costo Aprox. Permite editar cantidad o eliminar cada item. Muestra total de valor al pie.
- **Catálogo de Ingredientes**: tabla paginada de los ~680 ingredientes del sistema. Muestra nombre, categoría, unidad base, precio en CLP ($/kg, $/L o $/ud.) y calorías por 100g. Los ingredientes que ya están en la despensa se destacan en verde. Tiene búsqueda y botón de acción rápida "+" para agregar al pantry via modal.
  - Nota de precios referenciales visible.
  - Botón **"Actualizar Precios"**: sincroniza los precios de todos los ingredientes con el objeto `MARKET_PRICES_CLP` (en app.js) usando el endpoint PATCH existente.

### 2. 🍽️ Recetas
- **Widget de nutrición diaria**: barra flotante con progreso de calorías/proteínas/carbs/grasas del día (cargado desde historial + recetas cocinadas).
- **Panel de filtros**: búsqueda por nombre, tipo (entrada/comida/once/postre/trago), dieta, rango calórico, número de personas, tiempo de cocción y temporada.
- **Sección "Puedo Cocinar Ahora"**: recetas cuya lista de ingredientes está completamente cubierta por la despensa actual (con el ajuste de porciones aplicado).
- **Sección "Necesito Comprar"**: recetas con uno o más ingredientes faltantes, mostrando qué falta y cuánto cuesta completar.
- **Vista de cards / lista**: toggle en la navbar.
- **Filtro de temporada**: chip en navbar que activa/desactiva filtro por temporada actual.
- **Botón "¡Sorpréndeme!"**: ruleta que elige una receta aleatoria de las disponibles.
- **Banner anti-desperdicio**: al activar "Por vencer", muestra ingredientes próximos a vencer y recetas que los usan.
- **Panel de sesión**: "¿Quién come hoy?" — seleccionar integrantes de familia activos filtra recetas incompatibles con sus alergias.
- **Paginación**: controles 10/50/Todas en top y bottom de la lista de recetas.
- **Carrito de recetas**: seleccionar varias recetas activa una barra flotante con la lista unificada de compras, botón "Enviar por WhatsApp".

### 3. 🎉 Eventos
- Grid de recetas agrupadas por ocasión/evento especial.
- Modal **"Planificar un Evento"**: configurar número de personas y tipo de ocasión para obtener sugerencias de recetas adecuadas.

### 4. 📅 Menú Semanal
- **Control bar**: número de personas (1–20), presupuesto semanal en CLP, configuración de tipo de plato por día de la semana.
- **Botón "Generar Menú"**: asigna aleatoriamente una receta por día (respetando tipo configurado y disponibilidad de despensa).
- **Grid de 7 días**: cada tarjeta muestra día, receta asignada, costo estimado, opción de cambiar receta o marcar "día libre".
- **Barra de acciones** (aparece al generar): Seleccionar todo (añadir al carrito), Compartir por WhatsApp, Guardar menú, Modo "Fin de Mes" (recetas más baratas), Plan Nutricional, Ver historial de menús.
- **Dashboard de presupuesto**: gráfico de barras mensual mostrando gasto estimado por semana vs presupuesto.
- **Historial de menús guardados**: lista de menús anteriores con opción de restaurar.

### 5. 👨‍👩‍👧 Familia
- Grid de tarjetas por integrante.
- Cada integrante: nombre, alergias (ingredientes que alertan en recetas), dislikes, dietas, y toggle activo/inactivo.
- Badge en el tab muestra número de integrantes con alergias activas.
- Al desactivar un integrante, sus restricciones no se aplican.

### 6. 📖 Historial
- Lista cronológica de recetas cocinadas: fecha, receta, porciones.
- Alimenta el widget de nutrición diaria.
- Botón para limpiar historial.

### 7. 🌟 Comunidad
- Sub-tabs: **Top Valoradas** (ranking por rating 1–5) y **Cocinadas Recientemente**.
- **Importar Receta**: modal para pegar JSON de receta externa e incorporarla al sistema.
- Cada receta muestra su rating con estrellas, comentarios y botón para valorar.

---

## Flujo Completo de la Aplicación

### Arranque
1. `node server.js` ejecuta `initDB()` que crea tablas con `CREATE TABLE IF NOT EXISTS` y corre migraciones de columnas seguras (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
2. Si la tabla `ingredients` está vacía, ejecuta `seedData()` con 23 recetas y ~190 ingredientes base.
3. Si ya hay datos, ejecuta `seedMigrationData()` para normalizar categorías, tiempos y temporadas.
4. El servidor escucha en `PORT || 3001`.
5. Express sirve `/public` como estático → el navegador carga `index.html`.

### Carga del frontend
1. `app.js` hace las llamadas iniciales en paralelo:
   - `GET /api/ingredients` → `ingredientsDB` (diccionario `{id: ingredient}`)
   - `GET /api/pantry` → `pantryDB`
   - `GET /api/recipes` → `recipesDB`
   - `GET /api/ratings`, `/api/notes`, `/api/photos`, `/api/history`, `/api/family`, `/api/reminder`
2. Con todos los datos, llama a `updateUI()` que renderiza todos los tabs.
3. Desaparece la pantalla de carga (`#loadingScreen`).

### Flujo de verificación de recetas
La función central `canCook(recipe, portions, pantry)`:
1. Para cada ingrediente de la receta, convierte la cantidad requerida (ajustada por porciones) a la unidad base usando el objeto `conversion` del ingrediente.
2. Compara con la cantidad disponible en `pantryDB`.
3. Devuelve `{ canCook: boolean, missing: [{id, name, need, have, unit}] }`.

### Flujo de agregar a la despensa
1. Usuario selecciona ingrediente en `#ingSelect` (o usa modal de catálogo `#quickAddModal`).
2. Ingresa cantidad y unidad.
3. `POST /api/pantry` → el servidor convierte la cantidad a unidad base y hace `INSERT ... ON CONFLICT DO UPDATE SET quantity = quantity + $qty`.
4. `updateUI()` re-renderiza toda la interfaz.

### Flujo de compartir menú
1. Usuario genera menú → presiona "WhatsApp" o "Guardar/Compartir".
2. `POST /api/share` crea snapshot en `shared_views` con TTL implícito (no se borra automáticamente).
3. Devuelve enlace `http://localhost:3001/compartir/{8chars}`.
4. La ruta `/compartir/:id` sirve HTML autocontenido que carga los datos vía `GET /api/share/:id`.

---

## Funcionalidades Destacadas

### Cálculo inteligente de disponibilidad
- Conversión automática de unidades: g↔kg, ml↔L, unidades con peso.
- Ajuste dinámico por número de porciones: si la receta es para 4 pero el usuario pone 2, los requisitos se dividen a la mitad.
- Se actualiza en tiempo real al modificar la despensa.

### Sistema de precios en CLP
- `price_per_base` en DB: CLP por unidad mínima (g, ml o ud.).
- Display para usuario: multiplicar ×1000 para mostrar $/kg o $/L.
- `formatIngPrice(ing)` en app.js: maneja los tres tipos de unidad.
- `MARKET_PRICES_CLP` en app.js: objeto con ~350 ingredientes y sus precios promedio 2025–2026 del mercado chileno (supermercados).
- Botón "Actualizar Precios" llama `PATCH /api/ingredients/:id/price` para cada ingrediente en la tabla.

### Paginación en tres secciones
- Estado: `recipePage/recipePageSize`, `pantryPage/pantryPageSize`, `ingCatalogPage/ingCatalogPageSize`.
- Tamaños: 10 / 50 / Todas (0 = sin límite).
- Helper `buildPaginatorHTML(total, page, pageSize, pageFn, sizeFn)` genera el HTML de controles.
- `setPaginatorHTML(ids, html)` sincroniza paginadores top y bottom (recetas tiene dos).

### Sistema de alergias familiares
- Los IDs de ingredientes en `allergies[]` de un miembro activo generan un badge de alerta en cada receta que los contenga.
- Al seleccionar "¿Quién come?" en la sesión del día, se filtran automáticamente las recetas incompatibles.

### Anti-desperdicio
- Ingredientes con `expiry_date` próxima (≤ 3 días) aparecen en `#expiryAlertBar` en la parte superior.
- El banner "Por vencer" en Recetas agrupa recetas que usan esos ingredientes.

### Tema oscuro / claro
- Variables CSS en `:root` y `[data-theme="dark"]`.
- Toggle en navbar, preferencia guardada en `localStorage`.

### Hero banner personalizable
- Imagen de fondo configurable via `<input type="file">` → se guarda como data URL en `localStorage`.

---

## Convenciones de Código

### Backend (server.js)
- Todas las rutas son `async/await` con `try/catch` que devuelven `{ error: msg }` en 500.
- Pool de conexiones con `pool.query()` para queries simples.
- Transacciones con `pool.connect()` + `client.query('BEGIN/COMMIT/ROLLBACK')` para operaciones multi-paso.
- `initDB()` al arranque: idempotente, seguro de ejecutar varias veces.
- Seeds con `ON CONFLICT (id) DO NOTHING` para insertar sin romper datos existentes.

### Frontend (app.js)
- Variables globales: `ingredientsDB` (dict), `pantryDB` (dict), `recipesDB` (array), etc.
- `updateUI()`: función central que re-renderiza todo.
- `renderXxx()`: funciones de render individuales por sección.
- Toast notifications via `showToast(msg, type, duration)`.
- Modales Bootstrap: `new bootstrap.Modal(el).show()` / `.hide()`.
- Formato numérico CLP: `toLocaleString('es-CL')`.

---

## Variables de Entorno (Opcionales)

```
DB_HOST      # default: localhost
DB_NAME      # default: cocina_magica
DB_USER      # default: postgres
DB_PASSWORD  # default: Chileno0
DB_PORT      # default: 5432
PORT         # default: 3001
```

---

## Cómo Arrancar

```bash
cd c:\Users\gcc19\Documents\Proyectos\Web_receta
node server.js
# → CocinaMágica corriendo en http://localhost:3001
```

**Requisitos previos**: PostgreSQL 16 corriendo localmente con la base `cocina_magica` creada. Node.js 18+. No requiere `npm install` adicional si `node_modules` ya existe.

Para reinstalar dependencias: `npm install` (instala `express` y `pg`).

---

## Estado Actual del Proyecto (Julio 2026)

- **680 ingredientes** en DB (9 categorías).
- **23 recetas** clásicas chilenas con instrucciones detalladas paso a paso.
- Paginación activa en Despensa, Catálogo de Ingredientes y Recetas.
- Precios en CLP visibles en catálogo de ingredientes.
- Botón "Actualizar Precios" funcional (usa `PATCH` endpoint existente desde el cliente).
- Modal de adición rápida desde catálogo al pantry (`#quickAddModal`).
- Endpoint `POST /api/ingredients/update-prices` escrito en server.js (línea 927) pero requiere reinicio del servidor para activarse — por ahora el cliente hace el trabajo equivalente vía PATCH iterativo.
