const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'CocinaMagica/1.0 (https://github.com/CocinaMagica)' } }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'cocina_magica',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'Chileno0',
    port: parseInt(process.env.DB_PORT) || 5432
});

/* ================= INIT BASE DE DATOS ================= */
async function initDB() {
    const client = await pool.connect();
    try {
        // Tablas base
        await client.query(`CREATE TABLE IF NOT EXISTS ingredients (
            id VARCHAR(100) PRIMARY KEY, name VARCHAR(200) NOT NULL, base_unit VARCHAR(20) NOT NULL,
            price_per_base DECIMAL(12,6) NOT NULL, conversion JSONB DEFAULT '{}', nutrition JSONB DEFAULT '{}',
            category VARCHAR(50) DEFAULT 'otros'
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS recipes (
            id SERIAL PRIMARY KEY, name VARCHAR(200) NOT NULL, type VARCHAR(50) NOT NULL,
            base_portions INTEGER DEFAULT 4, diets TEXT[] DEFAULT '{}', instructions TEXT NOT NULL,
            cook_time_minutes INTEGER DEFAULT 30, season VARCHAR(20) DEFAULT 'all'
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS recipe_ingredients (
            recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
            ingredient_id VARCHAR(100) REFERENCES ingredients(id),
            qty DECIMAL(10,2) NOT NULL, unit VARCHAR(20) NOT NULL,
            PRIMARY KEY (recipe_id, ingredient_id)
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS pantry (
            ingredient_id VARCHAR(100) REFERENCES ingredients(id) PRIMARY KEY,
            quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
            expiry_date DATE
        )`);

        // Migraciones de columnas para instancias existentes
        await client.query(`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'otros'`);
        await client.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cook_time_minutes INTEGER DEFAULT 30`);
        await client.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS season VARCHAR(20) DEFAULT 'all'`);
        await client.query(`ALTER TABLE pantry ADD COLUMN IF NOT EXISTS expiry_date DATE`);

        // Tablas nuevas
        await client.query(`CREATE TABLE IF NOT EXISTS recipe_ratings (
            recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE PRIMARY KEY,
            rating INTEGER CHECK (rating BETWEEN 1 AND 5),
            comment TEXT, rated_at TIMESTAMP DEFAULT NOW()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS recipe_notes (
            recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE PRIMARY KEY,
            note TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS recipe_photos (
            recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE PRIMARY KEY,
            photo_data TEXT NOT NULL, uploaded_at TIMESTAMP DEFAULT NOW()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS cook_history (
            id SERIAL PRIMARY KEY, recipe_id INTEGER REFERENCES recipes(id),
            cooked_at DATE DEFAULT CURRENT_DATE, portions INTEGER DEFAULT 4
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS family_members (
            id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL,
            allergies TEXT[] DEFAULT '{}', dislikes TEXT[] DEFAULT '{}',
            diets TEXT[] DEFAULT '{}', is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS saved_menus (
            id SERIAL PRIMARY KEY, label VARCHAR(200), week_start DATE,
            persons INTEGER DEFAULT 4, budget INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS saved_menu_days (
            menu_id INTEGER REFERENCES saved_menus(id) ON DELETE CASCADE,
            day_name VARCHAR(20) NOT NULL, recipe_id INTEGER REFERENCES recipes(id),
            day_type VARCHAR(20) DEFAULT 'normal', PRIMARY KEY (menu_id, day_name)
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS weekly_budget (
            week_start DATE PRIMARY KEY, amount INTEGER NOT NULL DEFAULT 0
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS daily_reminder (
            id INTEGER PRIMARY KEY DEFAULT 1, reminder_time TIME, is_active BOOLEAN DEFAULT FALSE
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS shared_views (
            id VARCHAR(8) PRIMARY KEY,
            data JSONB NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )`);

        // Seed inicial
        const { rows } = await client.query('SELECT COUNT(*) FROM ingredients');
        if (parseInt(rows[0].count) === 0) {
            console.log('Sembrando datos iniciales...');
            await seedData(client);
        } else {
            await seedMigrationData(client);
        }
    } finally {
        client.release();
    }
}

async function seedData(client) {
    await client.query(`
        INSERT INTO ingredients (id, name, base_unit, price_per_base, conversion, nutrition, category) VALUES
        ('tomate','Tomate','g',1.2,'{"unidades":150}','{"cals":18,"p":0.9,"c":3.9,"f":0.2}','verduras'),
        ('cebolla','Cebolla','g',1.0,'{"unidades":150}','{"cals":40,"p":1.1,"c":9.3,"f":0.1}','verduras'),
        ('ajo','Ajo','unidades',50,'{"unidades":1}','{"cals":4,"p":0.2,"c":1,"f":0}','verduras'),
        ('limon','Limón','ml',1.5,'{"unidades":30}','{"cals":29,"p":1.1,"c":9.3,"f":0.3}','frutas'),
        ('palta','Palta','g',4.5,'{"unidades":200}','{"cals":160,"p":2,"c":8.5,"f":14.7}','frutas'),
        ('papa','Papa','g',1.2,'{"unidades":150}','{"cals":77,"p":2,"c":17.5,"f":0.1}','verduras'),
        ('zapallo','Zapallo','g',1.5,'{"kilos":1000}','{"cals":26,"p":1,"c":6.5,"f":0.1}','verduras'),
        ('zanahoria','Zanahoria','g',0.9,'{"unidades":100}','{"cals":41,"p":0.9,"c":9.6,"f":0.2}','verduras'),
        ('pimenton','Pimentón','g',1.5,'{"unidades":150}','{"cals":20,"p":1,"c":4.6,"f":0.2}','verduras'),
        ('cilantro','Cilantro','g',1.0,'{}','{"cals":23,"p":2.1,"c":3.7,"f":0.5}','verduras'),
        ('repollo','Repollo','g',1.2,'{"kilos":1000}','{"cals":25,"p":1.3,"c":5.8,"f":0.1}','verduras'),
        ('pollo','Pollo (Piezas)','g',4.0,'{"kilos":1000}','{"cals":165,"p":31,"c":0,"f":3.6}','carnes'),
        ('carne_molida','Carne Molida','g',6.5,'{"kilos":1000}','{"cals":250,"p":26,"c":0,"f":15}','carnes'),
        ('carne_vacuno','Carne Vacuno (Posta)','g',8.0,'{"kilos":1000}','{"cals":180,"p":28,"c":0,"f":6}','carnes'),
        ('pescado','Pescado (Merluza)','g',5.0,'{"kilos":1000}','{"cals":90,"p":19,"c":0,"f":1.2}','pescados'),
        ('huevos','Huevos','unidades',250,'{"unidades":1}','{"cals":78,"p":6,"c":0.6,"f":5}','lacteos'),
        ('longaniza','Longaniza','unidades',800,'{"unidades":1}','{"cals":280,"p":12,"c":1,"f":25}','carnes'),
        ('vienesa','Vienesa','unidades',300,'{"unidades":1}','{"cals":150,"p":5,"c":2,"f":13}','carnes'),
        ('carne_cerdo','Carne de Cerdo','g',5.0,'{"kilos":1000}','{"cals":242,"p":27,"c":0,"f":14}','carnes'),
        ('mariscos_surtidos','Mariscos Surtidos','g',5.0,'{"kilos":1000}','{"cals":90,"p":15,"c":2,"f":1}','pescados'),
        ('jurel_tarro','Jurel (Tarro)','g',3.5,'{"kilos":1000}','{"cals":150,"p":20,"c":0,"f":7}','pescados'),
        ('leche','Leche','ml',1.1,'{"litros":1000}','{"cals":42,"p":3.4,"c":5,"f":1}','lacteos'),
        ('queso_mantecoso','Queso Mantecoso','g',8.0,'{"kilos":1000}','{"cals":350,"p":20,"c":2,"f":28}','lacteos'),
        ('crema_leche','Crema de Leche','ml',4.5,'{"litros":1000}','{"cals":345,"p":2,"c":3,"f":36}','lacteos'),
        ('mantequilla','Mantequilla','g',8.0,'{"kilos":1000}','{"cals":717,"p":0.9,"c":0.1,"f":81}','lacteos'),
        ('leche_evaporada','Leche Evaporada','ml',3.0,'{"litros":1000}','{"cals":134,"p":7,"c":10,"f":7.6}','lacteos'),
        ('leche_condensada','Leche Condensada','ml',4.0,'{"litros":1000}','{"cals":321,"p":8,"c":54,"f":8}','lacteos'),
        ('arroz','Arroz','g',1.3,'{"kilos":1000}','{"cals":130,"p":2.7,"c":28,"f":0.3}','abarrotes'),
        ('fideos','Fideos','g',1.2,'{"kilos":1000}','{"cals":158,"p":5.8,"c":31,"f":0.9}','abarrotes'),
        ('lentejas','Lentejas','g',2.8,'{"kilos":1000}','{"cals":116,"p":9,"c":20,"f":0.4}','abarrotes'),
        ('porotos','Porotos','g',2.5,'{"kilos":1000}','{"cals":347,"p":21,"c":63,"f":1.2}','abarrotes'),
        ('garbanzos','Garbanzos','g',3.0,'{"kilos":1000}','{"cals":364,"p":19,"c":61,"f":6}','abarrotes'),
        ('arvejas','Arvejas','g',2.0,'{"kilos":1000}','{"cals":81,"p":5,"c":14,"f":0.4}','abarrotes'),
        ('harina','Harina','g',1.2,'{"kilos":1000}','{"cals":364,"p":10,"c":76,"f":1}','abarrotes'),
        ('pan_marraqueta','Marraqueta','unidades',250,'{"unidades":1}','{"cals":270,"p":8,"c":55,"f":1}','panaderia'),
        ('pan_completo','Pan Completo','unidades',200,'{"unidades":1}','{"cals":180,"p":5,"c":35,"f":2}','panaderia'),
        ('pan_rallado','Pan Rallado','g',2.0,'{"kilos":1000}','{"cals":395,"p":14,"c":72,"f":5}','abarrotes'),
        ('mote','Mote','g',1.8,'{"kilos":1000}','{"cals":340,"p":11,"c":72,"f":1.5}','abarrotes'),
        ('choclo','Pasta Choclo','g',3.5,'{"kilos":1000}','{"cals":86,"p":3.3,"c":19,"f":1.4}','verduras'),
        ('aceite','Aceite','ml',2.2,'{"litros":1000}','{"cals":884,"p":0,"c":0,"f":100}','abarrotes'),
        ('azucar','Azúcar','g',1.2,'{"kilos":1000}','{"cals":387,"p":0,"c":100,"f":0}','abarrotes'),
        ('manjar','Manjar','g',4.0,'{"kilos":1000}','{"cals":315,"p":7,"c":55,"f":7}','abarrotes'),
        ('frutillas','Frutillas','g',3.0,'{"kilos":1000}','{"cals":32,"p":0.7,"c":7.7,"f":0.3}','frutas'),
        ('manzana','Manzana','unidades',300,'{"unidades":1}','{"cals":52,"p":0.3,"c":14,"f":0.2}','frutas'),
        ('huesillo','Huesillo','unidades',150,'{"unidades":1}','{"cals":80,"p":1,"c":20,"f":0}','frutas'),
        ('pisco','Pisco','ml',7.0,'{"litros":1000}','{"cals":231,"p":0,"c":0,"f":0}','bebestibles'),
        ('vino_blanco','Vino Blanco','ml',3.5,'{"litros":1000}','{"cals":82,"p":0.1,"c":2.6,"f":0}','bebestibles'),
        ('vino_tinto','Vino Tinto','ml',4.0,'{"litros":1000}','{"cals":85,"p":0.1,"c":2.6,"f":0}','bebestibles')
        ON CONFLICT (id) DO NOTHING
    `);
    await client.query(`
        INSERT INTO recipes (id, name, type, base_portions, diets, instructions, cook_time_minutes, season) VALUES
        (1,'Charquicán Casero','comida',4,'{}','Cocer papas, zapallo y zanahoria. Freir carne molida con cebolla picada fina. Juntar todos los ingredientes en la olla y moler grueso con un pisa papas.',45,'invierno'),
        (2,'Pollo Arvejado','comida',4,'{}','Dorar el pollo. Hacer sofrito de cebolla y zanahoria. Juntar con pollo, agregar agua y arvejas. Cocer por 20 min. Servir con arroz graneado.',40,'all'),
        (3,'Lentejas Maravilla','comida',4,'{"vegano"}','Hervir lentejas con un trozo de zapallo y zanahoria. Al final agregar un sofrito dorado de cebolla y ajo.',60,'invierno'),
        (4,'Pescado Frito con Puré','comida',4,'{}','Pasar pescado por batido (harina, huevo) y freír. Hacer puré cociendo papas y moliendo con leche.',30,'all'),
        (5,'Cazuela de Vacuno','comida',4,'{}','Cocer la carne en abundante agua. Agregar papas enteras, trozos de zapallo y arroz. Hervir hasta que todo esté tierno.',75,'invierno'),
        (6,'Porotos con Riendas','comida',4,'{"vegano"}','Remojar porotos y cocer con zapallo. Cuando estén casi listos, agregar fideos y sofrito en aceite.',90,'invierno'),
        (7,'Pastel de Choclo','comida',4,'{}','Preparar pino de carne. Poner en fuente de greda con pollo. Cubrir con pastelera de choclo, espolvorear azúcar y hornear al máximo.',90,'verano'),
        (8,'Ensalada Chilena','entrada',1,'{"vegano","keto"}','Cortar tomate y cebolla en pluma (amortiguar cebolla). Aliñar generosamente con aceite, sal y jugo de limón.',10,'all'),
        (9,'Completo Italiano','once',1,'{}','Cocer vienesa en agua hirviendo. Calentar el pan. Armar con vienesa, tomate picado finamente y palta molida fresca.',15,'all'),
        (10,'Marraqueta con Palta','once',1,'{"vegano"}','Moler palta con un tenedor, agregar sal y untar en la marraqueta crujiente.',5,'all'),
        (11,'Sopaipillas Clásicas','once',4,'{"vegano"}','Mezclar harina con puré de zapallo cocido y manteca/aceite caliente. Amasar, cortar y freír en aceite profundo.',45,'invierno'),
        (12,'Mote con Huesillo','postre',4,'{"vegano"}','Cocer huesillos hidratados con azúcar caramelizada. Enfriar bien y servir en vaso alto con mote cocido.',30,'verano'),
        (13,'Pisco Sour Chileno','trago',4,'{"vegano"}','Licuar pisco, jugo de limón recién exprimido, azúcar y abundante hielo hasta lograr espuma.',5,'verano'),
        (14,'Paila Marina','comida',4,'{"keto"}','Sofreir cebolla y ajo, agregar mariscos surtidos, cilantro fresco y apagar con vino blanco. Servir en paila de greda muy caliente.',30,'all'),
        (15,'Cerdo al Horno con Puré','comida',4,'{}','Aliñar la pulpa de cerdo y hornear lentamente. Acompañar con puré de papas molidas con leche y mantequilla.',120,'invierno'),
        (16,'Empanadas Fritas de Queso','once',4,'{}','Preparar la masa con harina, agua y un toque de aceite. Rellenar abundantemente con queso mantecoso y freír en aceite bien caliente.',45,'all'),
        (17,'Garbanzos con Longaniza','comida',4,'{}','Cocer garbanzos. Preparar un buen sofrito con cebolla, pimentón y rodajas de longaniza. Mezclar todo.',75,'invierno'),
        (18,'Croquetas de Jurel','comida',4,'{}','Desmenuzar el jurel de tarro, mezclar con cebolla picada, huevos y pan rallado. Formar las croquetas y freír dorando por ambos lados.',30,'all'),
        (19,'Postre de Manzanas Asadas','postre',4,'{"vegano"}','Hacer un corte en el centro de las manzanas, rellenar con azúcar (o endulzante) y hornear hasta que estén muy tiernas y doradas.',35,'otono'),
        (20,'Ensalada de Repollo con Limón','entrada',4,'{"vegano","keto","diabetico"}','Picar el repollo muy fino. Amortiguar con agua caliente si se desea, estilar y aliñar con abundante limón y aceite.',10,'all'),
        (21,'Suspiro Limeño Rápido','postre',4,'{}','Reducir la leche condensada y evaporada a fuego bajo hasta espesar. Servir en copas y cubrir con merengue.',40,'all'),
        (22,'Frutillas con Crema','postre',4,'{}','Lavar y picar las frutillas. Batir la crema de leche con el azúcar hasta punto chantilly y mezclar suavemente.',15,'verano'),
        (23,'Pollo al Vino Blanco','comida',4,'{"keto"}','Sellar presas de pollo, hacer sofrito de cebolla, apagar con vino blanco y cocinar a fuego lento.',50,'all')
        ON CONFLICT (id) DO NOTHING
    `);
    await client.query(`SELECT setval('recipes_id_seq', (SELECT MAX(id) FROM recipes))`);
    await client.query(`
        INSERT INTO recipe_ingredients (recipe_id, ingredient_id, qty, unit) VALUES
        (1,'carne_molida',400,'g'),(1,'papa',6,'unidades'),(1,'zapallo',500,'g'),(1,'zanahoria',2,'unidades'),(1,'cebolla',150,'g'),
        (2,'pollo',800,'g'),(2,'arvejas',250,'g'),(2,'zanahoria',2,'unidades'),(2,'cebolla',150,'g'),(2,'arroz',400,'g'),
        (3,'lentejas',400,'g'),(3,'zapallo',200,'g'),(3,'zanahoria',1,'unidades'),(3,'cebolla',100,'g'),(3,'ajo',2,'unidades'),
        (4,'pescado',800,'g'),(4,'harina',100,'g'),(4,'huevos',2,'unidades'),(4,'papa',8,'unidades'),(4,'leche',200,'ml'),(4,'aceite',200,'ml'),
        (5,'carne_vacuno',800,'g'),(5,'papa',4,'unidades'),(5,'zapallo',400,'g'),(5,'arroz',100,'g'),(5,'zanahoria',2,'unidades'),
        (6,'porotos',400,'g'),(6,'zapallo',300,'g'),(6,'fideos',200,'g'),(6,'cebolla',150,'g'),(6,'aceite',20,'ml'),
        (7,'choclo',1000,'g'),(7,'carne_molida',400,'g'),(7,'cebolla',300,'g'),(7,'pollo',400,'g'),(7,'azucar',20,'g'),
        (8,'tomate',150,'g'),(8,'cebolla',50,'g'),(8,'limon',10,'ml'),(8,'aceite',5,'ml'),
        (9,'pan_completo',1,'unidades'),(9,'vienesa',1,'unidades'),(9,'tomate',80,'g'),(9,'palta',80,'g'),
        (10,'pan_marraqueta',1,'unidades'),(10,'palta',100,'g'),
        (11,'harina',500,'g'),(11,'zapallo',300,'g'),(11,'aceite',250,'ml'),
        (12,'mote',200,'g'),(12,'huesillo',4,'unidades'),(12,'azucar',100,'g'),
        (13,'pisco',360,'ml'),(13,'limon',120,'ml'),(13,'azucar',120,'g'),
        (14,'mariscos_surtidos',800,'g'),(14,'cebolla',200,'g'),(14,'ajo',2,'unidades'),(14,'vino_blanco',150,'ml'),(14,'cilantro',20,'g'),
        (15,'carne_cerdo',800,'g'),(15,'papa',6,'unidades'),(15,'leche',150,'ml'),(15,'mantequilla',30,'g'),(15,'ajo',3,'unidades'),
        (16,'harina',400,'g'),(16,'queso_mantecoso',300,'g'),(16,'aceite',300,'ml'),
        (17,'garbanzos',400,'g'),(17,'longaniza',2,'unidades'),(17,'cebolla',150,'g'),(17,'pimenton',50,'g'),(17,'zapallo',150,'g'),
        (18,'jurel_tarro',400,'g'),(18,'pan_rallado',100,'g'),(18,'huevos',2,'unidades'),(18,'cebolla',100,'g'),(18,'aceite',150,'ml'),
        (19,'manzana',4,'unidades'),(19,'azucar',40,'g'),
        (20,'repollo',400,'g'),(20,'limon',30,'ml'),(20,'aceite',15,'ml'),
        (21,'leche_evaporada',400,'ml'),(21,'leche_condensada',400,'ml'),(21,'huevos',3,'unidades'),(21,'azucar',100,'g'),
        (22,'frutillas',500,'g'),(22,'crema_leche',200,'ml'),(22,'azucar',50,'g'),
        (23,'pollo',800,'g'),(23,'vino_blanco',250,'ml'),(23,'cebolla',200,'g'),(23,'aceite',30,'ml')
        ON CONFLICT (recipe_id, ingredient_id) DO NOTHING
    `);
    await client.query(`
        INSERT INTO pantry (ingredient_id, quantity) VALUES
        ('tomate',750),('cebolla',450),('carne_molida',1000),('papa',2000),
        ('zapallo',1000),('zanahoria',500),('pollo',1000),('arroz',1000),
        ('aceite',1000),('harina',1000)
        ON CONFLICT (ingredient_id) DO NOTHING
    `);
    console.log('Datos iniciales sembrados.');
}

async function seedMigrationData(client) {
    await client.query(`
        UPDATE ingredients SET category = CASE
            WHEN id IN ('tomate','cebolla','ajo','papa','zapallo','zanahoria','pimenton','cilantro','repollo','choclo') THEN 'verduras'
            WHEN id IN ('limon','palta','frutillas','manzana','huesillo') THEN 'frutas'
            WHEN id IN ('pollo','carne_molida','carne_vacuno','longaniza','vienesa','carne_cerdo') THEN 'carnes'
            WHEN id IN ('pescado','mariscos_surtidos','jurel_tarro') THEN 'pescados'
            WHEN id IN ('leche','queso_mantecoso','crema_leche','mantequilla','leche_evaporada','leche_condensada','huevos') THEN 'lacteos'
            WHEN id IN ('arroz','fideos','lentejas','porotos','garbanzos','arvejas','harina','pan_rallado','mote','aceite','azucar','manjar') THEN 'abarrotes'
            WHEN id IN ('pan_marraqueta','pan_completo') THEN 'panaderia'
            WHEN id IN ('pisco','vino_blanco','vino_tinto') THEN 'bebestibles'
            ELSE 'otros' END
        WHERE category = 'otros' OR category IS NULL
    `);
    await client.query(`
        UPDATE recipes SET cook_time_minutes = CASE id
            WHEN 1 THEN 45 WHEN 2 THEN 40 WHEN 3 THEN 60 WHEN 4 THEN 30
            WHEN 5 THEN 75 WHEN 6 THEN 90 WHEN 7 THEN 90 WHEN 8 THEN 10
            WHEN 9 THEN 15 WHEN 10 THEN 5 WHEN 11 THEN 45 WHEN 12 THEN 30
            WHEN 13 THEN 5 WHEN 14 THEN 30 WHEN 15 THEN 120 WHEN 16 THEN 45
            WHEN 17 THEN 75 WHEN 18 THEN 30 WHEN 19 THEN 35 WHEN 20 THEN 10
            WHEN 21 THEN 40 WHEN 22 THEN 15 WHEN 23 THEN 50 ELSE 30 END
        WHERE cook_time_minutes = 30 OR cook_time_minutes IS NULL
    `);
    await client.query(`
        UPDATE recipes SET season = CASE id
            WHEN 1 THEN 'invierno' WHEN 3 THEN 'invierno' WHEN 5 THEN 'invierno'
            WHEN 6 THEN 'invierno' WHEN 7 THEN 'verano' WHEN 11 THEN 'invierno'
            WHEN 12 THEN 'verano' WHEN 13 THEN 'verano' WHEN 15 THEN 'invierno'
            WHEN 17 THEN 'invierno' WHEN 19 THEN 'otono' WHEN 22 THEN 'verano'
            ELSE 'all' END
        WHERE season = 'all' OR season IS NULL
    `);

    /* ── Instrucciones detalladas (paso a paso) para recetas existentes ── */
    const detailedInstructions = [
        [1, `Paso 1: Pelar y cortar en trozos medianos las papas, el zapallo y la zanahoria. Hervir en agua con sal hasta que estén tiernos, aproximadamente 20 minutos.\nPaso 2: En una sartén grande con un chorrito de aceite, freír la carne molida a fuego alto, rompiéndola con cuchara. Salpimentar.\nPaso 3: Agregar la cebolla picada fina a la carne y cocinar hasta que esté dorada, unos 8 minutos.\nPaso 4: Escurrir las verduras cocidas y agregarlas a la sartén con la carne. Revolver bien.\nPaso 5: Moler todo con un pisapapas dejando textura gruesa (no puré). Rectificar sal, agregar orégano al gusto.\nPaso 6: Servir caliente con un huevo frito encima si se desea.`],
        [2, `Paso 1: Salpimentar las presas de pollo y dorarlas en una olla con aceite caliente hasta que estén doradas por todos lados. Reservar.\nPaso 2: En la misma olla, hacer un sofrito con la cebolla picada en cuadritos y la zanahoria en rodajas, a fuego medio por 8 minutos.\nPaso 3: Devolver el pollo a la olla, cubrir con agua (o caldo), agregar una hoja de laurel y cocinar tapado 20 minutos.\nPaso 4: Incorporar las arvejas, verificar sazón y cocinar 10 minutos más.\nPaso 5: Mientras tanto, preparar arroz graneado: rehogar el arroz en aceite, agregar agua hirviendo (proporción 1:1.5), tapar y cocer a fuego mínimo 15 minutos.\nPaso 6: Servir el pollo arvejado sobre el arroz blanco.`],
        [3, `Paso 1: Remojar las lentejas en agua fría durante 2 horas (opcional pero acelera la cocción).\nPaso 2: En una olla grande, colocar las lentejas escurridas con trozos de zapallo y la zanahoria en rodajas. Cubrir con agua fría, aproximadamente el doble de volumen.\nPaso 3: Cocinar a fuego medio-alto hasta que hierva, luego bajar el fuego y cocinar tapado 40 minutos hasta que las lentejas estén tiernas.\nPaso 4: En una sartén aparte, calentar aceite y dorar la cebolla picada fina con los dientes de ajo machacados, hasta que la cebolla esté transparente y ligeramente dorada.\nPaso 5: Agregar el sofrito a la olla de lentejas, mezclar bien. Rectificar sal y agregar comino al gusto.\nPaso 6: Servir caliente acompañado de arroz blanco o pan marraqueta.`],
        [4, `Paso 1: Cocer las papas con cáscara en agua con sal hasta que estén completamente tiernas. Pelar y reservar calientes.\nPaso 2: Preparar el batido: mezclar la harina con una pizca de sal, pimienta y oregano. Batir los huevos por separado.\nPaso 3: Pasar los filetes de pescado (previamente secados con papel) primero por el huevo batido y luego por la mezcla de harina.\nPaso 4: Calentar abundante aceite en sartén profunda a 180°C. Freír el pescado 3-4 minutos por lado hasta que esté dorado y crujiente. Escurrir en papel absorbente.\nPaso 5: Preparar el puré: moler las papas calientes con leche tibia y una nuez de mantequilla hasta obtener una textura suave. Rectificar sal.\nPaso 6: Servir el pescado frito sobre el puré, acompañado de ensalada chilena y limón.`],
        [5, `Paso 1: En una olla grande, sellar los trozos de carne vacuno en aceite caliente hasta dorar por todos lados. Esto toma unos 5 minutos.\nPaso 2: Cubrir la carne con abundante agua fría y llevar a ebullición. Espumar el caldo durante los primeros 10 minutos.\nPaso 3: Agregar sal, pimienta en grano, hoja de laurel y orégano. Cocinar a fuego medio 30 minutos.\nPaso 4: Incorporar las papas enteras peladas, los trozos grandes de zapallo y las zanahorias en rodajas gruesas.\nPaso 5: Agregar el arroz directamente a la olla. Cocinar 20 minutos más hasta que todos los ingredientes estén tiernos.\nPaso 6: Servir en platos hondos con bastante caldo, asegurándose de que cada porción tenga de todo. Acompañar con ají verde.`],
        [6, `Paso 1: Remojar los porotos en agua fría durante la noche. Al día siguiente, escurrirlos.\nPaso 2: En una olla grande, cubrir los porotos con agua fría (triple de volumen). Hervir a fuego fuerte 10 minutos, luego bajar el fuego.\nPaso 3: Agregar el zapallo en trozos grandes a los porotos. Cocinar a fuego medio aproximadamente 60-70 minutos hasta que los porotos estén tiernos.\nPaso 4: Cuando los porotos estén casi listos, agregar los fideos crudos directamente a la olla. Cocinar 8-10 minutos más.\nPaso 5: En una sartén, calentar aceite y preparar un sofrito con cebolla picada fina y ajo. Dorar bien.\nPaso 6: Agregar el sofrito a la olla, revolver y rectificar sal. Servir caliente con ají si se desea.`],
        [7, `Paso 1: Preparar el pino: freír la carne molida con la cebolla picada fina, sazonar con sal, pimienta, comino y ají color. Cocinar hasta que el líquido evapore.\nPaso 2: Cocer los trozos de pollo en agua con sal hasta estar tiernos. Reservar.\nPaso 3: Preparar la pastelera de choclo: procesar el choclo desgranado en la licuadora. Cocinar en una olla con un poco de mantequilla y leche a fuego medio, revolviendo constantemente hasta que espese, unos 15 minutos. Salpimentar.\nPaso 4: En una fuente de greda o pirex enmantequillada, colocar primero el pino, encima los trozos de pollo.\nPaso 5: Cubrir generosamente con la pastelera de choclo. Espolvorear azúcar encima.\nPaso 6: Hornear a 200°C por 25-30 minutos hasta que la superficie esté dorada. Servir directo de la fuente.`],
        [8, `Paso 1: Cortar los tomates en rodajas medianas o en cubos, según preferencia. Colocar en un bol.\nPaso 2: Cortar la cebolla en pluma muy fina. Para suavizarla, colocar en agua fría con sal por 5 minutos, luego escurrir bien.\nPaso 3: Mezclar el tomate y la cebolla en el bol.\nPaso 4: Aliñar generosamente con aceite de oliva, jugo de limón recién exprimido y sal.\nPaso 5: Mezclar suavemente para no deshacer los tomates. Rectificar sal y limón al gusto.\nPaso 6: Servir de inmediato o refrigerar máximo 30 minutos antes de servir para que los sabores se integren.`],
        [9, `Paso 1: Hervir agua en una olla y cocer las vienesas 5 minutos hasta que estén calientes por dentro. También se pueden dorar a la parrilla.\nPaso 2: Calentar el pan completo en la plancha, horno o tostadora por 2-3 minutos para que quede crujiente por fuera.\nPaso 3: Moler la palta con tenedor, agregar una pizca de sal y jugo de limón al gusto.\nPaso 4: Picar el tomate en cubos pequeños y escurrir el exceso de líquido.\nPaso 5: Abrir el pan y colocar primero la vienesa caliente.\nPaso 6: Agregar encima la palta molida, luego el tomate picado. Opcional: agregar mayonesa y mostaza. Servir de inmediato.`],
        [10, `Paso 1: Cortar la marraqueta por la mitad horizontalmente sin separar completamente.\nPaso 2: Si se desea, tostar levemente el pan en la plancha o en el horno por 2-3 minutos.\nPaso 3: Tomar la palta madura y extraer la pulpa con una cuchara.\nPaso 4: Moler la palta con un tenedor en un bol, agregar sal y jugo de limón al gusto.\nPaso 5: Untar generosamente la palta molida en ambas mitades del pan.\nPaso 6: Servir de inmediato. Opcional: agregar tomate en rodajas, sal y pimienta al gusto.`],
        [11, `Paso 1: Cocer el zapallo en trozos con poca agua y sal hasta que esté muy tierno. Escurrir bien y hacer puré apretado.\nPaso 2: En un bol grande, mezclar la harina con el puré de zapallo aún tibio. Agregar sal, un chorro de aceite caliente y amasar hasta obtener una masa suave que no se pegue.\nPaso 3: Estirar la masa sobre una superficie enharinada a un grosor de medio centímetro.\nPaso 4: Cortar círculos con un cortador o un vaso. Pinchar el centro con un tenedor para que no inflen.\nPaso 5: Calentar abundante aceite en una olla o sartén profunda a 170°C.\nPaso 6: Freír las sopaipillas en tandas, 2-3 minutos por lado hasta que estén doradas. Escurrir en papel absorbente y servir calientes con pebre, chancaca o mostaza.`],
        [12, `Paso 1: Remojar los huesillos (duraznos secos) en agua fría durante al menos 4 horas o toda la noche.\nPaso 2: Cocer el mote en abundante agua con sal hasta que esté tierno y esté bien hinchado, aproximadamente 45 minutos. Enfriar en agua fría.\nPaso 3: En una olla, colocar los huesillos remojados con su agua, agregar el azúcar y cocinar a fuego medio hasta que el líquido forme un jarabe suave, unos 20 minutos.\nPaso 4: Retirar del fuego y enfriar completamente. Refrigerar el jarabe con los huesillos por al menos 1 hora.\nPaso 5: En vasos altos, colocar primero una capa de mote escurrido.\nPaso 6: Agregar 2-3 huesillos y cubrir con el jarabe bien frío. Servir inmediatamente muy helado.`],
        [13, `Paso 1: Exprimir los limones para obtener 120 ml de jugo fresco. Colar para eliminar semillas.\nPaso 2: En una licuadora, colocar el pisco, el jugo de limón y el azúcar.\nPaso 3: Agregar abundante hielo picado, suficiente para llenar la mitad de la licuadora.\nPaso 4: Licuar a velocidad alta durante 30-45 segundos hasta que el hielo esté triturado y la mezcla forme espuma en la superficie.\nPaso 5: Probar y rectificar el balance entre ácido y dulce según preferencia.\nPaso 6: Servir de inmediato en copas frías, directamente de la licuadora para preservar la espuma. Decorar con una rodaja de limón.`],
        [14, `Paso 1: Limpiar y revisar bien todos los mariscos. Pelar y picar finamente la cebolla y el ajo.\nPaso 2: En una paila de greda o cazuela de fondo grueso, calentar aceite a fuego alto y freír la cebolla y el ajo hasta transparentar, unos 5 minutos.\nPaso 3: Agregar los mariscos más duros primero (machas, almejas) y saltear 2 minutos.\nPaso 4: Incorporar los mariscos más tiernos (camarones, pulpo cocido) y el cilantro picado grueso.\nPaso 5: Apagar con el vino blanco, revolver y tapar inmediatamente. Cocinar a fuego alto 3-4 minutos.\nPaso 6: Verificar la sazón, agregar sal y pimienta al gusto. Servir hirviendo en la misma paila con pan marraqueta.`],
        [15, `Paso 1: Machacar los dientes de ajo con sal, pimienta y orégano para hacer una pasta. Frotar toda la pieza de cerdo con esta mezcla. Marinar mínimo 1 hora.\nPaso 2: Precalentar el horno a 180°C.\nPaso 3: En una fuente para horno, colocar la pulpa de cerdo y agregar un vaso de agua al fondo.\nPaso 4: Hornear tapado con papel aluminio por 60 minutos. Retirar el papel y continuar horneando 40-50 minutos más hasta que esté dorado y el jugo salga claro.\nPaso 5: Mientras tanto, cocer las papas con cáscara en agua con sal. Pelar y moler calientes con leche tibia y la mantequilla hasta obtener un puré cremoso.\nPaso 6: Reposar la carne 10 minutos antes de cortar. Servir en láminas con el jugo del horneado y el puré cremoso.`],
        [16, `Paso 1: Preparar la masa: mezclar la harina con sal. Agregar agua tibia de a poco y aceite, amasando hasta obtener una masa suave y elástica que no se pegue. Dejar reposar 10 minutos.\nPaso 2: Cortar el queso mantecoso en bastones o láminas gruesas.\nPaso 3: Estirar la masa finamente sobre superficie enharinada. Cortar círculos de unos 15 cm de diámetro.\nPaso 4: Colocar abundante queso en el centro de cada círculo. Doblar la masa formando una media luna y sellar el borde presionando con los dedos o un tenedor.\nPaso 5: Calentar el aceite en una sartén profunda a 170°C. Freír las empanadas 2-3 minutos por lado hasta que estén doradas y crujientes.\nPaso 6: Escurrir en papel absorbente y servir calientes. El queso debe estar derretido y jugoso por dentro.`],
        [17, `Paso 1: Remojar los garbanzos en agua fría durante toda la noche. Escurrirlos y cocer en agua nueva con sal hasta que estén tiernos, aproximadamente 60-70 minutos.\nPaso 2: Cortar la longaniza en rodajas de 1 cm de grosor.\nPaso 3: En una olla grande, calentar aceite y dorar las rodajas de longaniza hasta que estén ligeramente crujientes. Retirar y reservar.\nPaso 4: En la misma grasa, hacer un sofrito con la cebolla picada fina y el pimentón en cubos pequeños, cocinando 10 minutos a fuego medio.\nPaso 5: Agregar los garbanzos cocidos y escurridos al sofrito, junto con el zapallo en trozos. Mezclar bien.\nPaso 6: Devolver la longaniza, agregar un poco del caldo de cocción de los garbanzos, condimentar con sal, pimienta y ají color. Cocinar 10 minutos más y servir.`],
        [18, `Paso 1: Abrir los tarros de jurel, escurrir el aceite y desmenuzar el pescado con un tenedor, eliminando espinas grandes.\nPaso 2: Picar la cebolla muy fina. En un bol mezclar el jurel, la cebolla, los huevos batidos y el pan rallado.\nPaso 3: Sazonar con sal, pimienta, orégano y ají verde picado si se desea.\nPaso 4: Mezclar bien con las manos hasta que la mezcla sea homogénea. Debe poder formarse en bolitas.\nPaso 5: Formar croquetas ovaladas, pasarlas por pan rallado adicional para que queden crujientes.\nPaso 6: Calentar aceite en sartén y freír las croquetas 3-4 minutos por lado a fuego medio-alto hasta que estén doradas. Escurrir y servir con ensalada o puré.`],
        [19, `Paso 1: Precalentar el horno a 180°C.\nPaso 2: Lavar bien las manzanas. Hacer un corte alrededor del centro de cada manzana para facilitar la cocción y evitar que exploten.\nPaso 3: Con una cuchara parisién o cuchillo, hacer un hueco pequeño en el centro de cada manzana, eliminando el corazón y las semillas.\nPaso 4: Rellenar cada cavidad con azúcar y una pizca de canela. Agregar un trozo de mantequilla encima si se desea.\nPaso 5: Colocar las manzanas en una fuente para horno con un poco de agua en el fondo.\nPaso 6: Hornear 25-35 minutos según el tamaño, hasta que estén tiernas y doradas. Servir tibias, solas o con helado de vainilla.`],
        [20, `Paso 1: Eliminar las hojas externas del repollo y lavar bien.\nPaso 2: Cortar el repollo en cuartos, eliminar el tronco central y picar en tiras muy finas o juliana.\nPaso 3: Opcional: para suavizar el repollo, colocar las tiras en un bol con agua hirviendo y sal durante 2 minutos. Escurrir muy bien apretando con las manos.\nPaso 4: Colocar el repollo en una fuente para ensalada.\nPaso 5: Aliñar con el jugo de limón recién exprimido, el aceite, sal y pimienta al gusto.\nPaso 6: Mezclar bien y dejar reposar 5 minutos para que los sabores se integren. Servir fría.`],
        [21, `Paso 1: En una olla de fondo grueso, mezclar la leche condensada con la leche evaporada a fuego medio.\nPaso 2: Revolver constantemente con una cuchara de madera para evitar que se pegue al fondo.\nPaso 3: Cocinar durante 20-25 minutos hasta que la mezcla espese y se despegue ligeramente del fondo de la olla.\nPaso 4: Retirar del fuego y distribuir en copas individuales. Enfriar.\nPaso 5: Para el merengue: batir las claras de huevo a punto nieve, agregar el azúcar de a poco continuando el batido hasta que esté firme y brillante.\nPaso 6: Colocar el merengue encima del suspiro con una manga pastelera o cuchara. Espolvorear canela y servir frío.`],
        [22, `Paso 1: Lavar las frutillas bajo agua fría. Retirar el pedúnculo verde con un cuchillo.\nPaso 2: Cortar las frutillas en rodajas o cuartos según el tamaño. Colocar en un bol.\nPaso 3: Si se desea macerar, agregar 1-2 cucharadas de azúcar a las frutillas y mezclar. Dejar reposar 10 minutos.\nPaso 4: En otro bol frío, batir la crema de leche con el azúcar restante usando batidor eléctrico a velocidad alta, hasta que esté firme (punto chantilly).\nPaso 5: Para montar: colocar las frutillas en copas o platos. Agregar generosas cucharadas de crema chantilly encima.\nPaso 6: Decorar con una frutilla entera en la cima. Servir inmediatamente bien frío.`],
        [23, `Paso 1: Salpimentar las presas de pollo. Calentar aceite en una cacerola a fuego alto y sellar el pollo por todos lados hasta dorar, unos 6-8 minutos. Reservar.\nPaso 2: En la misma cacerola con la grasa del pollo, sofreír la cebolla en pluma a fuego medio hasta que esté transparente y ligeramente dorada, unos 8 minutos.\nPaso 3: Machacar el ajo e incorporarlo a la cebolla. Cocinar 1 minuto más.\nPaso 4: Devolver el pollo a la cacerola. Verter el vino blanco y llevar a ebullición para evaporar el alcohol, unos 2 minutos.\nPaso 5: Bajar el fuego al mínimo, tapar y cocinar 30-35 minutos hasta que el pollo esté completamente tierno y la salsa haya reducido.\nPaso 6: Rectificar sal y servir con arroz blanco o puré de papas, regando con la salsa de vino.`]
    ];
    for (const [id, instr] of detailedInstructions) {
        await client.query(
            `UPDATE recipes SET instructions = $1 WHERE id = $2 AND instructions NOT LIKE '%Paso 1%'`,
            [instr, id]
        );
    }

    /* ── 100 ingredientes chilenos nuevos ── */
    await client.query(`
        INSERT INTO ingredients (id, name, base_unit, price_per_base, conversion, nutrition, category) VALUES
        ('betarraga','Betarraga','g',1.0,'{"unidades":200}','{"cals":43,"p":1.6,"c":10,"f":0.2}','verduras'),
        ('brocoli','Brócoli','g',2.5,'{"kilos":1000}','{"cals":34,"p":2.8,"c":7,"f":0.4}','verduras'),
        ('coliflor','Coliflor','g',2.0,'{"kilos":1000}','{"cals":25,"p":1.9,"c":5,"f":0.3}','verduras'),
        ('espinaca','Espinaca','g',3.0,'{"kilos":1000}','{"cals":23,"p":2.9,"c":3.6,"f":0.4}','verduras'),
        ('lechuga','Lechuga','g',2.0,'{"kilos":1000}','{"cals":15,"p":1.4,"c":2.9,"f":0.2}','verduras'),
        ('pepino','Pepino','g',1.2,'{"unidades":300}','{"cals":16,"p":0.7,"c":3.6,"f":0.1}','verduras'),
        ('poroto_verde','Poroto Verde','g',2.5,'{"kilos":1000}','{"cals":31,"p":1.8,"c":7,"f":0.1}','verduras'),
        ('alcachofa','Alcachofa','unidades',500,'{"unidades":1}','{"cals":47,"p":3.3,"c":11,"f":0.2}','verduras'),
        ('apio','Apio','g',1.5,'{"kilos":1000}','{"cals":16,"p":0.7,"c":3,"f":0.2}','verduras'),
        ('cebolla_morada','Cebolla Morada','g',1.5,'{"unidades":150}','{"cals":40,"p":1.1,"c":9.3,"f":0.1}','verduras'),
        ('cebolla_verde','Cebollín','g',2.0,'{"kilos":1000}','{"cals":32,"p":1.8,"c":7.3,"f":0.2}','verduras'),
        ('puerro','Puerro','g',2.5,'{"kilos":1000}','{"cals":61,"p":1.5,"c":14,"f":0.3}','verduras'),
        ('champiñon','Champiñón','g',5.0,'{"kilos":1000}','{"cals":22,"p":3.1,"c":3.3,"f":0.3}','verduras'),
        ('oregano','Orégano','g',8.0,'{}','{"cals":265,"p":9,"c":69,"f":4}','especias'),
        ('comino','Comino','g',6.0,'{}','{"cals":375,"p":18,"c":44,"f":22}','especias'),
        ('merkén','Merkén','g',9.0,'{}','{"cals":282,"p":12,"c":50,"f":6}','especias'),
        ('aji_color','Ají Color','g',7.0,'{}','{"cals":282,"p":14,"c":53,"f":13}','especias'),
        ('perejil','Perejil','g',3.0,'{}','{"cals":36,"p":3,"c":6.3,"f":0.8}','verduras'),
        ('albahaca','Albahaca','g',5.0,'{}','{"cals":23,"p":3.2,"c":2.7,"f":0.6}','verduras'),
        ('canela','Canela','g',4.0,'{}','{"cals":247,"p":4,"c":80,"f":1.2}','especias'),
        ('pimienta','Pimienta Negra','g',9.0,'{}','{"cals":251,"p":10,"c":64,"f":3.3}','especias'),
        ('laurel','Laurel','g',5.0,'{}','{"cals":313,"p":7.6,"c":75,"f":8}','especias'),
        ('vinagre','Vinagre','ml',1.5,'{"litros":1000}','{"cals":18,"p":0,"c":0.9,"f":0}','abarrotes'),
        ('salsa_soya','Salsa de Soya','ml',3.0,'{"litros":1000}','{"cals":53,"p":8,"c":5,"f":0.6}','abarrotes'),
        ('salsa_tomate','Salsa de Tomate (Tarro)','g',2.5,'{"kilos":1000}','{"cals":29,"p":1.5,"c":7,"f":0.5}','abarrotes'),
        ('pure_tomate','Puré de Tomate','g',3.0,'{"kilos":1000}','{"cals":38,"p":2,"c":9,"f":0.4}','abarrotes'),
        ('mayonesa','Mayonesa','g',4.0,'{"kilos":1000}','{"cals":680,"p":1,"c":0.6,"f":75}','abarrotes'),
        ('mostaza','Mostaza','g',3.5,'{"kilos":1000}','{"cals":66,"p":4.4,"c":5.3,"f":3.6}','abarrotes'),
        ('ketchup','Ketchup','g',3.0,'{"kilos":1000}','{"cals":112,"p":1.5,"c":28,"f":0.1}','abarrotes'),
        ('caldo_cubo','Caldo en Cubo','unidades',120,'{"unidades":1}','{"cals":20,"p":1,"c":2,"f":0.5}','abarrotes'),
        ('polvo_hornear','Polvos de Hornear','g',5.0,'{}','{"cals":53,"p":0,"c":28,"f":0}','abarrotes'),
        ('bicarbonato','Bicarbonato de Sodio','g',3.0,'{}','{"cals":0,"p":0,"c":0,"f":0}','abarrotes'),
        ('sal','Sal','g',0.2,'{}','{"cals":0,"p":0,"c":0,"f":0}','abarrotes'),
        ('cafe','Café Instantáneo','g',30.0,'{}','{"cals":2,"p":0.3,"c":0.4,"f":0}','bebestibles'),
        ('te','Té','g',15.0,'{}','{"cals":1,"p":0.1,"c":0.3,"f":0}','bebestibles'),
        ('cacao','Cacao en Polvo','g',12.0,'{}','{"cals":228,"p":20,"c":57,"f":14}','abarrotes'),
        ('chocolate','Chocolate','g',7.0,'{"kilos":1000}','{"cals":535,"p":5,"c":60,"f":30}','abarrotes'),
        ('vainilla','Vainilla (Esencia)','ml',15.0,'{}','{"cals":288,"p":0,"c":72,"f":0}','abarrotes'),
        ('queso_fresco','Queso Fresco','g',7.0,'{"kilos":1000}','{"cals":264,"p":18,"c":3,"f":21}','lacteos'),
        ('queso_parmesano','Queso Parmesano','g',12.0,'{"kilos":1000}','{"cals":392,"p":36,"c":0,"f":26}','lacteos'),
        ('yogurt','Yogurt Natural','g',3.0,'{"kilos":1000}','{"cals":59,"p":3.5,"c":4.7,"f":3.3}','lacteos'),
        ('ricotta','Ricotta','g',6.0,'{"kilos":1000}','{"cals":174,"p":11,"c":3,"f":13}','lacteos'),
        ('crema_acida','Crema Ácida','g',5.0,'{"kilos":1000}','{"cals":198,"p":2.4,"c":4.6,"f":19}','lacteos'),
        ('pollo_pechuga','Pechuga de Pollo','g',5.5,'{"kilos":1000}','{"cals":165,"p":31,"c":0,"f":3.6}','carnes'),
        ('pollo_muslo','Muslo de Pollo','g',4.0,'{"kilos":1000}','{"cals":209,"p":26,"c":0,"f":11}','carnes'),
        ('lomo_liso','Lomo Liso','g',9.0,'{"kilos":1000}','{"cals":198,"p":28,"c":0,"f":9}','carnes'),
        ('asado_tira','Asado de Tira','g',7.5,'{"kilos":1000}','{"cals":291,"p":18,"c":0,"f":24}','carnes'),
        ('plateada','Plateada','g',8.5,'{"kilos":1000}','{"cals":286,"p":23,"c":0,"f":21}','carnes'),
        ('osobuco','Osobuco','g',7.0,'{"kilos":1000}','{"cals":252,"p":25,"c":0,"f":16}','carnes'),
        ('churrasco','Churrasco de Vacuno','g',9.5,'{"kilos":1000}','{"cals":217,"p":22,"c":0,"f":14}','carnes'),
        ('filete_vacuno','Filete de Vacuno','g',14.0,'{"kilos":1000}','{"cals":193,"p":29,"c":0,"f":8}','carnes'),
        ('costilla_cerdo','Costilla de Cerdo','g',6.0,'{"kilos":1000}','{"cals":280,"p":20,"c":0,"f":22}','carnes'),
        ('pulpa_cerdo','Pulpa de Cerdo','g',5.5,'{"kilos":1000}','{"cals":242,"p":27,"c":0,"f":14}','carnes'),
        ('tocino','Tocino','g',6.0,'{"kilos":1000}','{"cals":541,"p":37,"c":1.4,"f":42}','carnes'),
        ('jamón','Jamón','g',7.0,'{"kilos":1000}','{"cals":145,"p":20,"c":1.5,"f":6}','carnes'),
        ('salchichón','Salchichón','g',5.5,'{"kilos":1000}','{"cals":336,"p":14,"c":1,"f":30}','carnes'),
        ('salmon','Salmón','g',9.0,'{"kilos":1000}','{"cals":208,"p":20,"c":0,"f":13}','pescados'),
        ('atun_tarro','Atún en Tarro','g',6.0,'{"kilos":1000}','{"cals":132,"p":28,"c":0,"f":1.7}','pescados'),
        ('reineta','Reineta','g',7.0,'{"kilos":1000}','{"cals":127,"p":21,"c":0,"f":4.5}','pescados'),
        ('congrio','Congrio','g',8.5,'{"kilos":1000}','{"cals":100,"p":20,"c":0,"f":1.5}','pescados'),
        ('corvina','Corvina','g',8.0,'{"kilos":1000}','{"cals":105,"p":21,"c":0,"f":1.8}','pescados'),
        ('camarones','Camarones','g',8.0,'{"kilos":1000}','{"cals":99,"p":24,"c":0,"f":0.3}','pescados'),
        ('machas','Machas','g',6.0,'{"kilos":1000}','{"cals":48,"p":7.5,"c":3,"f":0.5}','pescados'),
        ('locos','Locos','g',15.0,'{"kilos":1000}','{"cals":88,"p":16,"c":5,"f":0.5}','pescados'),
        ('ostiones','Ostiones','g',12.0,'{"kilos":1000}','{"cals":69,"p":12,"c":3.5,"f":0.8}','pescados'),
        ('cochayuyo','Cochayuyo','g',4.0,'{"kilos":1000}','{"cals":43,"p":1.7,"c":10,"f":0.2}','pescados'),
        ('pan_molde','Pan de Molde','unidades',120,'{"unidades":1}','{"cals":79,"p":2.7,"c":15,"f":0.9}','panaderia'),
        ('pan_integral','Pan Integral','unidades',180,'{"unidades":1}','{"cals":69,"p":3.6,"c":12,"f":1.1}','panaderia'),
        ('hallulla','Hallulla','unidades',150,'{"unidades":1}','{"cals":230,"p":7,"c":46,"f":2}','panaderia'),
        ('marraqueta_integral','Marraqueta Integral','unidades',280,'{"unidades":1}','{"cals":240,"p":9,"c":48,"f":2}','panaderia'),
        ('tortilla_trigo','Tortilla de Trigo','unidades',180,'{"unidades":1}','{"cals":146,"p":4,"c":26,"f":3}','panaderia'),
        ('avena','Avena','g',1.8,'{"kilos":1000}','{"cals":389,"p":17,"c":66,"f":7}','abarrotes'),
        ('quinoa','Quínoa','g',5.0,'{"kilos":1000}','{"cals":368,"p":14,"c":64,"f":6}','abarrotes'),
        ('maiz_choclo','Maíz (Choclo Entero)','unidades',350,'{"unidades":1}','{"cals":86,"p":3.3,"c":19,"f":1.4}','verduras'),
        ('poroto_granado','Porotos Granados','g',3.5,'{"kilos":1000}','{"cals":132,"p":8.6,"c":24,"f":0.5}','abarrotes'),
        ('lenteja_roja','Lenteja Roja','g',3.5,'{"kilos":1000}','{"cals":116,"p":9,"c":20,"f":0.4}','abarrotes'),
        ('aceite_oliva','Aceite de Oliva','ml',5.0,'{"litros":1000}','{"cals":884,"p":0,"c":0,"f":100}','abarrotes'),
        ('aceite_canola','Aceite de Canola','ml',2.5,'{"litros":1000}','{"cals":884,"p":0,"c":0,"f":100}','abarrotes'),
        ('azucar_flor','Azúcar Flor','g',1.5,'{"kilos":1000}','{"cals":387,"p":0,"c":100,"f":0}','abarrotes'),
        ('chancaca','Chancaca','g',2.5,'{"kilos":1000}','{"cals":350,"p":0,"c":90,"f":0}','abarrotes'),
        ('miel','Miel','g',7.0,'{"kilos":1000}','{"cals":304,"p":0.3,"c":82,"f":0}','abarrotes'),
        ('mermelada','Mermelada','g',4.0,'{"kilos":1000}','{"cals":250,"p":0.5,"c":65,"f":0.1}','abarrotes'),
        ('maicena','Maicena','g',2.5,'{"kilos":1000}','{"cals":381,"p":0.3,"c":91,"f":0.1}','abarrotes'),
        ('semola','Sémola','g',2.0,'{"kilos":1000}','{"cals":360,"p":13,"c":73,"f":1}','abarrotes'),
        ('fideos_tallarines','Tallarines','g',1.5,'{"kilos":1000}','{"cals":158,"p":5.8,"c":31,"f":0.9}','abarrotes'),
        ('fideos_espirales','Espirales','g',1.5,'{"kilos":1000}','{"cals":158,"p":5.8,"c":31,"f":0.9}','abarrotes'),
        ('arroz_integral','Arroz Integral','g',2.0,'{"kilos":1000}','{"cals":111,"p":2.6,"c":23,"f":0.9}','abarrotes'),
        ('naranja','Naranja','unidades',200,'{"unidades":1}','{"cals":47,"p":0.9,"c":12,"f":0.1}','frutas'),
        ('platano','Plátano','unidades',150,'{"unidades":1}','{"cals":89,"p":1.1,"c":23,"f":0.3}','frutas'),
        ('uvas','Uvas','g',3.0,'{"kilos":1000}','{"cals":69,"p":0.7,"c":18,"f":0.2}','frutas'),
        ('pera','Pera','unidades',280,'{"unidades":1}','{"cals":57,"p":0.4,"c":15,"f":0.1}','frutas'),
        ('durazno','Durazno','unidades',250,'{"unidades":1}','{"cals":39,"p":0.9,"c":10,"f":0.3}','frutas'),
        ('kiwi','Kiwi','unidades',180,'{"unidades":1}','{"cals":61,"p":1.1,"c":15,"f":0.5}','frutas'),
        ('sandia','Sandía','g',1.5,'{"kilos":1000}','{"cals":30,"p":0.6,"c":8,"f":0.2}','frutas'),
        ('piña','Piña','g',2.0,'{"kilos":1000}','{"cals":50,"p":0.5,"c":13,"f":0.1}','frutas'),
        ('cerveza','Cerveza','ml',1.2,'{"litros":1000}','{"cals":43,"p":0.5,"c":3.6,"f":0}','bebestibles'),
        ('ron','Ron','ml',6.0,'{"litros":1000}','{"cals":231,"p":0,"c":0,"f":0}','bebestibles'),
        ('jugo_naranja','Jugo de Naranja Natural','ml',1.5,'{"litros":1000}','{"cals":45,"p":0.7,"c":10,"f":0.2}','bebestibles'),
        ('agua_mineral','Agua Mineral','ml',0.5,'{"litros":1000}','{"cals":0,"p":0,"c":0,"f":0}','bebestibles'),
        ('nuez','Nueces','g',12.0,'{"kilos":1000}','{"cals":654,"p":15,"c":14,"f":65}','otros'),
        ('almendra','Almendras','g',14.0,'{"kilos":1000}','{"cals":579,"p":21,"c":22,"f":50}','otros'),
        ('pasas','Pasas','g',5.0,'{"kilos":1000}','{"cals":299,"p":3.1,"c":79,"f":0.5}','otros'),
        ('datil','Dátiles','g',6.0,'{"kilos":1000}','{"cals":282,"p":2.5,"c":75,"f":0.4}','otros')
        ON CONFLICT (id) DO NOTHING
    `);
    await client.query(`
        UPDATE ingredients SET category = CASE
            WHEN id IN ('betarraga','brocoli','coliflor','espinaca','lechuga','pepino','poroto_verde','alcachofa','apio','cebolla_morada','cebolla_verde','puerro','champiñon','perejil','albahaca','maiz_choclo') THEN 'verduras'
            WHEN id IN ('naranja','platano','uvas','pera','durazno','kiwi','sandia','piña') THEN 'frutas'
            WHEN id IN ('pollo_pechuga','pollo_muslo','lomo_liso','asado_tira','plateada','osobuco','churrasco','filete_vacuno','costilla_cerdo','pulpa_cerdo','tocino','jamón','salchichón') THEN 'carnes'
            WHEN id IN ('salmon','atun_tarro','reineta','congrio','corvina','camarones','machas','locos','ostiones','cochayuyo') THEN 'pescados'
            WHEN id IN ('queso_fresco','queso_parmesano','yogurt','ricotta','crema_acida') THEN 'lacteos'
            WHEN id IN ('pan_molde','pan_integral','hallulla','marraqueta_integral','tortilla_trigo') THEN 'panaderia'
            WHEN id IN ('oregano','comino','merkén','aji_color','canela','pimienta','laurel') THEN 'especias'
            WHEN id IN ('avena','quinoa','poroto_granado','lenteja_roja','aceite_oliva','aceite_canola','azucar_flor','chancaca','miel','mermelada','maicena','semola','fideos_tallarines','fideos_espirales','arroz_integral','vinagre','salsa_soya','salsa_tomate','pure_tomate','mayonesa','mostaza','ketchup','caldo_cubo','polvo_hornear','bicarbonato','sal','cacao','chocolate','vainilla','nuez','almendra','pasas','datil') THEN 'abarrotes'
            WHEN id IN ('cafe','te','cerveza','ron','jugo_naranja','agua_mineral') THEN 'bebestibles'
            ELSE 'otros' END
        WHERE id IN ('betarraga','brocoli','coliflor','espinaca','lechuga','pepino','poroto_verde','alcachofa','apio','cebolla_morada','cebolla_verde','puerro','champiñon','oregano','comino','merkén','aji_color','perejil','albahaca','canela','pimienta','laurel','vinagre','salsa_soya','salsa_tomate','pure_tomate','mayonesa','mostaza','ketchup','caldo_cubo','polvo_hornear','bicarbonato','sal','cafe','te','cacao','chocolate','vainilla','queso_fresco','queso_parmesano','yogurt','ricotta','crema_acida','pollo_pechuga','pollo_muslo','lomo_liso','asado_tira','plateada','osobuco','churrasco','filete_vacuno','costilla_cerdo','pulpa_cerdo','tocino','jamón','salchichón','salmon','atun_tarro','reineta','congrio','corvina','camarones','machas','locos','ostiones','cochayuyo','pan_molde','pan_integral','hallulla','marraqueta_integral','tortilla_trigo','avena','quinoa','maiz_choclo','poroto_granado','lenteja_roja','aceite_oliva','aceite_canola','azucar_flor','chancaca','miel','mermelada','maicena','semola','fideos_tallarines','fideos_espirales','arroz_integral','naranja','platano','uvas','pera','durazno','kiwi','sandia','piña','cerveza','ron','jugo_naranja','agua_mineral','nuez','almendra','pasas','datil')
    `);

    /* ── 120 recetas nuevas (20 por tipo) ── */
    await client.query(`
        INSERT INTO recipes (name, type, base_portions, diets, instructions, cook_time_minutes, season) VALUES
        ('Ensalada de Betarraga con Queso Fresco','entrada',4,'{"vegetariano"}','Paso 1: Cocer las betarragas enteras con cáscara en agua con sal hasta que al pinchar con un palillo estén tiernas, unos 40 minutos.\nPaso 2: Enfriar, pelar y cortar en rodajas o cubos.\nPaso 3: Desmenuzar el queso fresco sobre la betarraga.\nPaso 4: Aliñar con aceite de oliva, vinagre, sal y pimienta.\nPaso 5: Decorar con hojas de albahaca fresca.\nPaso 6: Servir fría como entrada.',25,'all'),
        ('Ceviche de Corvina','entrada',4,'{"keto"}','Paso 1: Cortar la corvina en cubos pequeños de 1.5 cm.\nPaso 2: Cubrir el pescado con abundante jugo de limón recién exprimido. Mezclar y refrigerar 20 minutos.\nPaso 3: Picar finamente la cebolla morada y el cilantro.\nPaso 4: Agregar la cebolla y el cilantro al pescado marinado.\nPaso 5: Sazonar con sal, pimienta y ají verde picado al gusto.\nPaso 6: Servir frío en copas con galletas de agua o tostadas.',20,'verano'),
        ('Hummus Casero','entrada',6,'{"vegano","sin gluten"}','Paso 1: Remojar los garbanzos durante la noche. Cocer hasta que estén muy tiernos, unos 60 minutos.\nPaso 2: Reservar el agua de cocción. Procesar los garbanzos calientes en la licuadora.\nPaso 3: Agregar 2 dientes de ajo, jugo de limón, aceite de oliva y sal.\nPaso 4: Agregar agua de cocción de a poco hasta lograr consistencia cremosa.\nPaso 5: Rectificar sal y limón al gusto.\nPaso 6: Servir en un plato hondo, hacer un hoyo en el centro, agregar aceite de oliva y paprika.',30,'all'),
        ('Caldo de Patas','entrada',4,'{}','Paso 1: Limpiar bien las patas de vacuno y cortar en trozos.\nPaso 2: Hervir en abundante agua con sal, ajo y hoja de laurel durante 2 horas hasta que la carne se desprenda del hueso.\nPaso 3: Retirar las patas, deshuesar y reservar la carne.\nPaso 4: Colar el caldo y devolver al fuego.\nPaso 5: Agregar la carne deshuesada, zanahoria en rodajas y arvejas.\nPaso 6: Cocinar 15 minutos más. Servir caliente en platos hondos con cilantro fresco.',120,'invierno'),
        ('Pebre Casero','entrada',6,'{"vegano","keto"}','Paso 1: Picar finamente el tomate en cubos pequeños, eliminando el líquido interior.\nPaso 2: Picar finamente el cilantro fresco con sus tallos.\nPaso 3: Picar la cebolla en cuadritos muy pequeños. Remojar en agua fría 5 minutos y escurrir.\nPaso 4: Picar el ají verde sin semillas en aros o cuadritos finos.\nPaso 5: Mezclar todo en un bol. Aliñar con aceite, vinagre, sal y pimienta.\nPaso 6: Dejar reposar 15 minutos para que los sabores se integren. Servir con marraqueta.',15,'all'),
        ('Ostiones al Parmesano','entrada',4,'{"keto"}','Paso 1: Limpiar los ostiones con agua fría y secarlos con papel.\nPaso 2: Calentar el horno con gratinador a temperatura máxima.\nPaso 3: Colocar los ostiones en sus conchas o en una fuente para horno.\nPaso 4: Mezclar mantequilla derretida con ajo machacado y perejil picado.\nPaso 5: Cubrir cada ostión con la mezcla de mantequilla y rallar queso parmesano generosamente encima.\nPaso 6: Gratinar 5-8 minutos hasta que el queso esté dorado y burbujeante. Servir de inmediato.',15,'all'),
        ('Machas a la Parmesana','entrada',4,'{"keto"}','Paso 1: Lavar bien las machas bajo agua corriente eliminando arena.\nPaso 2: Abrir las machas al vapor en una olla tapada por 3 minutos hasta que abran.\nPaso 3: Retirar la concha superior y colocar las machas en una fuente para horno.\nPaso 4: Mezclar mantequilla con ajo, perejil y jugo de limón. Cubrir cada macha.\nPaso 5: Rallar abundante queso parmesano encima de cada una.\nPaso 6: Gratinar a temperatura máxima 5-7 minutos hasta dorar. Servir inmediatamente.',20,'all'),
        ('Empanadas al Horno de Pino','entrada',8,'{}','Paso 1: Preparar el pino: sofreír carne molida con cebolla picada fina, ají color, comino y sal. Agregar huevo duro picado y aceitunas. Enfriar.\nPaso 2: Hacer la masa: mezclar harina, mantequilla fría en cubos, sal y agua fría de a poco hasta obtener masa firme. Refrigerar 30 minutos.\nPaso 3: Estirar la masa finamente y cortar círculos de 15 cm.\nPaso 4: Rellenar con una cucharada de pino. Doblar, sellar y hacer el repulgue.\nPaso 5: Pintar con huevo batido.\nPaso 6: Hornear a 200°C por 20-25 minutos hasta que estén doradas.',60,'all'),
        ('Cochayuyo Guisado','entrada',4,'{"vegano"}','Paso 1: Remojar el cochayuyo seco en agua fría durante 2 horas. Escurrir y picar en trozos medianos.\nPaso 2: Cocer en agua limpia con sal por 30 minutos hasta que esté tierno.\nPaso 3: En una sartén, hacer sofrito de cebolla, tomate, ajo y pimentón.\nPaso 4: Agregar el cochayuyo escurrido al sofrito. Mezclar bien.\nPaso 5: Sazonar con sal, pimienta, orégano y un toque de ají color.\nPaso 6: Cocinar 10 minutos más a fuego bajo. Servir como entrada o guarnición.',45,'all'),
        ('Sopa de Verduras Chilena','entrada',4,'{"vegano"}','Paso 1: Picar en cubos medianos: zanahoria, papa, zapallo, apio y puerro.\nPaso 2: En una olla grande, calentar aceite y sofreír el puerro y el apio 5 minutos.\nPaso 3: Agregar el resto de verduras y sofreír 5 minutos más.\nPaso 4: Cubrir con agua o caldo de verduras. Sazonar con sal, pimienta y comino.\nPaso 5: Cocinar a fuego medio 25 minutos hasta que las verduras estén tiernas.\nPaso 6: Rectificar sazón y servir caliente con pan marraqueta.',40,'invierno'),
        ('Pastel de Papas','comida',4,'{}','Paso 1: Cocer las papas con cáscara en agua con sal. Pelar y hacer puré con leche, mantequilla y sal.\nPaso 2: Preparar el pino: freír carne molida con cebolla, ajo y condimentos hasta que esté seco y bien sazonado.\nPaso 3: Enmantequillar una fuente de horno. Extender la mitad del puré en el fondo.\nPaso 4: Cubrir con todo el pino. Agregar huevo duro picado y aceitunas encima.\nPaso 5: Cubrir con el resto del puré. Rallar queso mantecoso encima.\nPaso 6: Hornear a 180°C por 25 minutos hasta que esté dorado. Servir caliente.',60,'all'),
        ('Cazuela de Pollo','comida',4,'{}','Paso 1: Salpimentar las presas de pollo. Dorar en aceite caliente por ambos lados.\nPaso 2: Retirar el pollo y en la misma olla hacer sofrito de cebolla y ajo.\nPaso 3: Devolver el pollo, cubrir con agua o caldo. Cocinar 20 minutos.\nPaso 4: Agregar papas enteras, zanahoria en rodajas y un trozo de zapallo.\nPaso 5: Incorporar arroz y choclo en rodajas. Sazonar con sal y comino.\nPaso 6: Cocinar 20 minutos más. Servir en platos hondos con el caldo y cilantro fresco.',55,'invierno'),
        ('Osobuco Estofado','comida',4,'{}','Paso 1: Sellar el osobuco en aceite caliente con sal y pimienta por ambos lados, 4 minutos cada lado.\nPaso 2: Retirar y hacer sofrito profundo con cebolla, zanahoria, apio y ajo a fuego medio.\nPaso 3: Agregar puré de tomate y orégano. Cocinar 5 minutos.\nPaso 4: Devolver el osobuco, cubrir con agua o vino tinto y llevar a ebullición.\nPaso 5: Tapar y cocinar a fuego muy bajo 1.5 a 2 horas hasta que la carne se desprenda del hueso.\nPaso 6: Servir con el jugo reducido, puré de papas o fideos.',120,'invierno'),
        ('Tallarines con Salsa de Carne','comida',4,'{}','Paso 1: Hervir abundante agua con sal. Cocer los tallarines según indicaciones del paquete. Reservar.\nPaso 2: En una sartén, freír la carne molida a fuego alto hasta dorar bien.\nPaso 3: Agregar cebolla picada fina y ajo. Sofreír 8 minutos.\nPaso 4: Incorporar salsa de tomate, orégano, sal y pimienta. Cocinar a fuego bajo 15 minutos.\nPaso 5: Servir los tallarines en platos hondos y cubrir con la salsa de carne.\nPaso 6: Rallar queso parmesano encima y decorar con albahaca fresca.',30,'all'),
        ('Porotos Granados','comida',4,'{"vegano"}','Paso 1: Desgranar los porotos frescos o usar conserva. Si son secos, remojar una noche.\nPaso 2: Cocer los porotos en agua con sal, una hoja de laurel y un trozo de zapallo por 45 minutos.\nPaso 3: Desgranar los choclos frescos y cortar en rodajas. Agregar a los porotos.\nPaso 4: Incorporar la albahaca fresca entera (no picada) para dar aroma.\nPaso 5: Preparar un sofrito de cebolla, tomate y pimentón. Agregar a la olla.\nPaso 6: Cocinar 15 minutos más, rectificar sal. Servir caliente con una cucharada de pebre.',60,'verano'),
        ('Salmón al Horno con Limón','comida',4,'{"keto","sin gluten"}','Paso 1: Precalentar el horno a 200°C.\nPaso 2: Colocar los filetes de salmón en papel aluminio, salpimentar.\nPaso 3: Cubrir con rodajas de limón, dientes de ajo laminados y albahaca o eneldo.\nPaso 4: Doblar el papel aluminio formando un paquete sellado.\nPaso 5: Hornear 18-22 minutos según el grosor del filete.\nPaso 6: Servir abriendo el paquete para que el vapor y aromas queden en el plato. Acompañar con ensalada verde.',25,'all'),
        ('Arrollado de Huaso','comida',6,'{}','Paso 1: Extender la carne vacuno en láminas delgadas y golpear con mazo para ablandar.\nPaso 2: Sazonar con sal, ajo, pimienta, comino y ají color.\nPaso 3: Colocar encima lonjas de tocino, huevos duros cortados en cuartos y pimentón en tiras.\nPaso 4: Enrollar firmemente y amarrar con hilo de cocina.\nPaso 5: Dorar el arrollado en una olla grande con aceite. Agregar agua, laurel y cocinar tapado 1.5 horas.\nPaso 6: Enfriar, retirar el hilo, cortar en rodajas y servir frío o a temperatura ambiente.',90,'all'),
        ('Reineta Frita','comida',4,'{}','Paso 1: Limpiar y secar bien los filetes de reineta con papel absorbente.\nPaso 2: Sazonar con sal, pimienta y un chorrito de limón.\nPaso 3: Pasar cada filete por harina, luego por huevo batido y finalmente por pan rallado.\nPaso 4: Calentar el aceite en una sartén profunda a 180°C.\nPaso 5: Freír los filetes 3-4 minutos por lado hasta que estén dorados y crujientes.\nPaso 6: Escurrir en papel absorbente y servir con puré de papas, ensalada chilena y limón.',25,'all'),
        ('Costillar de Cerdo al Horno','comida',4,'{}','Paso 1: Preparar una marinada con ajo machacado, merkén, comino, aceite de oliva, sal y jugo de limón.\nPaso 2: Frotar generosamente el costillar con la marinada. Refrigerar 2 horas o toda la noche.\nPaso 3: Precalentar el horno a 160°C.\nPaso 4: Colocar el costillar en una fuente, agregar un poco de agua al fondo y cubrir con papel aluminio.\nPaso 5: Hornear tapado 2 horas. Retirar el papel y subir a 200°C por 20 minutos para dorar.\nPaso 6: Servir con puré de papas, ensalada de repollo y el jugo del horneado.',140,'all'),
        ('Congrio Frito con Ensalada Chilena','comida',4,'{}','Paso 1: Limpiar el congrio y cortar en medallones de 3 cm de grosor. Secar con papel.\nPaso 2: Preparar el apanado: mezclar harina con sal, pimienta y orégano.\nPaso 3: Pasar cada medallón por la mezcla de harina, luego por huevo batido y pan rallado.\nPaso 4: Calentar aceite abundante en una olla a 180°C.\nPaso 5: Freír los medallones 4-5 minutos hasta estar dorados y crujientes. Escurrir.\nPaso 6: Servir con ensalada chilena fresca y arroz blanco.',30,'all'),
        ('Plateada Braseada','comida',4,'{}','Paso 1: Salpimentar la plateada y sellar en una olla ancha con aceite caliente por todos lados.\nPaso 2: Retirar y en la misma olla sofreír cebolla en pluma, zanahoria, apio y ajo hasta dorar.\nPaso 3: Agregar vino tinto, dejar evaporar el alcohol 2 minutos.\nPaso 4: Devolver la carne, agregar laurel, tomillo y caldo hasta casi cubrir.\nPaso 5: Cocinar a fuego muy bajo, tapado, por 3 horas dando vuelta cada hora.\nPaso 6: La carne debe quedar muy tierna. Reducir el jugo y servir sobre la carne con puré.',180,'invierno'),
        ('Lomo a lo Pobre','plato',4,'{}','Paso 1: Cortar el lomo liso en bifes de 1.5 cm. Salpimentar.\nPaso 2: Cortar las papas en bastones gruesos y freír en aceite caliente hasta que estén doradas y crujientes. Reservar calientes.\nPaso 3: En una sartén bien caliente con un poco de aceite, cocinar los bifes 2-3 minutos por lado para término medio. Reservar.\nPaso 4: En la misma sartén, freír la cebolla en pluma hasta que esté muy dorada y caramelizada.\nPaso 5: En otra sartén, freír los huevos con la yema blanda.\nPaso 6: Armar el plato: bifes, montón de papas fritas, cebolla dorada encima y el huevo frito al lado.',35,'all'),
        ('Churrasco Italiano','plato',2,'{}','Paso 1: Aplanar el churrasco de vacuno con un mazo de cocina hasta dejarlo delgado y uniforme.\nPaso 2: Sazonar con sal, pimienta y un poco de ajo en polvo.\nPaso 3: Cocinar en una plancha o sartén muy caliente con un chorrito de aceite, 1-2 minutos por lado según grosor.\nPaso 4: Moler la palta con sal y limón.\nPaso 5: Picar el tomate en cubos pequeños y escurrir.\nPaso 6: Abrir el pan marraqueta o hallulla, colocar el churrasco, cubrir con palta molida y tomate picado. Servir inmediatamente.',15,'all'),
        ('Pastel de Jaiba','plato',4,'{}','Paso 1: Desmenuzar la carne de jaiba asegurándose de no dejar cartílagos.\nPaso 2: Hacer una salsa bechamel: derretir mantequilla, agregar harina, mezclar y añadir leche poco a poco revolviendo hasta espesar.\nPaso 3: Mezclar la salsa bechamel con la carne de jaiba, cebolla sofrita y un poco de ají verde picado.\nPaso 4: Rellenar conchas de jaiba o cazuelitas individuales con la mezcla.\nPaso 5: Cubrir con queso parmesano rallado y pan rallado.\nPaso 6: Gratinar al horno a temperatura máxima 10 minutos hasta dorar la superficie.',40,'all'),
        ('Plateada a la Cacerola','plato',4,'{}','Paso 1: Sellar la plateada en aceite bien caliente por todos lados hasta obtener una costra dorada.\nPaso 2: Picar en cubos: cebolla, zanahoria, apio y ajo.\nPaso 3: Sofreír las verduras en la misma olla hasta dorar.\nPaso 4: Agregar puré de tomate, vino tinto y agua hasta casi cubrir la carne.\nPaso 5: Cocinar tapado a fuego muy bajo 2.5 horas, girando la carne cada 45 minutos.\nPaso 6: Servir en trozos con las verduras y el jugo reducido. Ideal con puré o arroz.',150,'invierno'),
        ('Cazuela Marina','plato',4,'{}','Paso 1: En una olla grande, sofreír cebolla, ajo y pimentón en aceite hasta dorar.\nPaso 2: Agregar papa en trozos y zapallo en cubos. Sofreír 3 minutos.\nPaso 3: Cubrir con agua o caldo de pescado. Sazonar y cocinar 15 minutos.\nPaso 4: Incorporar los mariscos y el pescado cortado en trozos.\nPaso 5: Cocinar 8-10 minutos más sin dejar que hierva fuerte para no endurecer los mariscos.\nPaso 6: Servir en platos hondos con cilantro fresco y pan marraqueta.',40,'all'),
        ('Milanesas de Pollo','plato',4,'{}','Paso 1: Abrir las pechugas de pollo en mariposa y golpear con mazo hasta dejarlas delgadas.\nPaso 2: Sazonar con sal, pimienta, ajo en polvo y orégano.\nPaso 3: Pasar cada milanesa primero por harina, luego por huevo batido y finalmente por pan rallado, presionando bien.\nPaso 4: Calentar aceite en sartén a fuego medio-alto.\nPaso 5: Freír las milanesas 3-4 minutos por lado hasta que estén doradas y crujientes.\nPaso 6: Escurrir en papel absorbente. Servir con puré o papas fritas y ensalada.',30,'all'),
        ('Empanadas de Pino al Horno','plato',8,'{}','Paso 1: Preparar el pino la víspera: carne molida con cebolla, ají color, comino, huevo duro, aceitunas. Enfriar completamente.\nPaso 2: Hacer la masa mezclando harina, mantequilla, huevo, sal y agua tibia hasta obtener masa suave.\nPaso 3: Dividir en bollos, estirar círculos de 14 cm.\nPaso 4: Rellenar con pino frío, sellar y hacer el repulgue tradicional.\nPaso 5: Pintar con huevo batido mezclado con café o leche.\nPaso 6: Hornear a 200°C 25 minutos hasta que estén doradas y brillantes.',75,'all'),
        ('Chupe de Locos','plato',4,'{}','Paso 1: Cocer los locos 30 minutos en agua con sal hasta que estén tiernos. Enfriar y cortar en trozos.\nPaso 2: Hacer una salsa: sofrir cebolla y ajo, agregar ají verde, crema y queso rallado.\nPaso 3: Remojar pan en leche y agregar a la salsa para espesar.\nPaso 4: Incorporar los locos en trozos a la salsa.\nPaso 5: Verter en cazuelitas individuales de greda.\nPaso 6: Rallar queso encima y gratinar al horno 10 minutos hasta dorar.',60,'all'),
        ('Filete Salteado con Champiñones','plato',4,'{"keto"}','Paso 1: Cortar el filete en medallones de 2 cm. Salpimentar generosamente.\nPaso 2: Laminar los champiñones y picar el ajo finamente.\nPaso 3: En una sartén muy caliente con aceite de oliva, sellar los medallones 2 min por lado para término medio. Reservar.\nPaso 4: En la misma sartén, saltar los champiñones con ajo hasta dorar.\nPaso 5: Agregar un chorro de vino tinto y reducir 2 minutos. Agregar crema y cocinar hasta que la salsa espese.\nPaso 6: Servir los medallones con la salsa de champiñones encima.',25,'all'),
        ('Arrollado de Vacuno','plato',6,'{}','Paso 1: Extender láminas delgadas de carne vacuno, salpimentar y frotar con ajo machacado.\nPaso 2: Colocar jamón, huevo duro en cuartos y pimentón en tiras encima.\nPaso 3: Enrollar firmemente y atar con hilo de cocina cada 3 cm.\nPaso 4: Dorar el arrollado por todos lados en aceite caliente en una olla.\nPaso 5: Cubrir con agua o caldo, agregar laurel y cocinar tapado a fuego bajo 1.5 horas.\nPaso 6: Enfriar, retirar el hilo y cortar en rodajas. Servir frío o tibio con ensaladas.',90,'all'),
        ('Sándwich de Pernil','once',2,'{}','Paso 1: Marinar el trozo de pernil de cerdo con ajo, sal, comino y orégano durante 4 horas mínimo.\nPaso 2: Hornear a 160°C por 2 horas tapado y 30 minutos destapado hasta dorar.\nPaso 3: Enfriar ligeramente y cortar en láminas delgadas.\nPaso 4: Calentar la marraqueta o hallulla en el horno.\nPaso 5: Abrir el pan y colocar abundante pernil.\nPaso 6: Agregar palta molida, tomate y mayonesa al gusto. Servir caliente.',150,'all'),
        ('Pan con Queso y Tomate','once',2,'{"vegetariano"}','Paso 1: Cortar el pan por la mitad.\nPaso 2: Tostar el pan en la plancha o tostadora hasta dorar.\nPaso 3: Cortar el queso mantecoso en láminas.\nPaso 4: Cortar el tomate en rodajas finas y escurrir el exceso de líquido.\nPaso 5: Colocar las láminas de queso sobre el pan tostado caliente para que se derritan levemente.\nPaso 6: Agregar rodajas de tomate, sal, pimienta y orégano encima. Servir de inmediato.',10,'all'),
        ('Tostadas Francesas','once',4,'{"vegetariano"}','Paso 1: Batir los huevos con la leche, una cucharada de azúcar y una pizca de canela.\nPaso 2: Remojar las rebanadas de pan de molde en la mezcla de huevo unos 30 segundos por lado.\nPaso 3: Calentar una sartén con mantequilla a fuego medio.\nPaso 4: Cocinar las tostadas 2-3 minutos por lado hasta que estén doradas.\nPaso 5: Espolvorear azúcar flor y canela encima.\nPaso 6: Servir calientes con mermelada, manjar o fruta.',20,'all'),
        ('Dobladitas de Queso','once',4,'{}','Paso 1: Preparar la masa con harina, sal, aceite y agua tibia. Amasar hasta que sea suave.\nPaso 2: Dividir en bollos pequeños. Estirar cada uno formando un círculo delgado.\nPaso 3: Colocar queso mantecoso en una mitad.\nPaso 4: Doblar y sellar bien los bordes presionando con tenedor.\nPaso 5: Cocinar en plancha o sartén caliente sin aceite, dando vuelta cuando aparezcan manchas doradas.\nPaso 6: Servir calientes cuando el queso esté derretido.',25,'all'),
        ('Sopa de Pan','once',4,'{"vegetariano"}','Paso 1: Cortar el pan marraqueta en trozos medianos y tostar levemente en el horno.\nPaso 2: Picar finamente la cebolla y sofreír en aceite hasta transparentar.\nPaso 3: Agregar ajo machacado y sofreír 1 minuto más.\nPaso 4: Agregar agua o caldo, sal y pimienta. Hervir 5 minutos.\nPaso 5: Agregar el pan tostado al caldo caliente. Mezclar para que el pan absorba el líquido.\nPaso 6: Romper un huevo encima y tapar 3 minutos para que se cocine a vapor. Servir inmediatamente.',20,'invierno'),
        ('Leche Asada','once',4,'{"vegetariano"}','Paso 1: Batir los huevos con el azúcar hasta que estén espumosos.\nPaso 2: Agregar la leche tibia poco a poco sin dejar de batir.\nPaso 3: Añadir esencia de vainilla y mezclar bien.\nPaso 4: Caramelizar el azúcar en el molde directamente al fuego hasta que tome color dorado.\nPaso 5: Verter la mezcla de leche sobre el caramelo. Hornear a 160°C al baño María por 45 minutos.\nPaso 6: Enfriar completamente, desmoldar y refrigerar. Servir frío cortado en porciones.',60,'all'),
        ('Pan Batido Casero','once',8,'{"vegetariano"}','Paso 1: Disolver la levadura en agua tibia con una cucharadita de azúcar. Esperar 10 minutos hasta que espume.\nPaso 2: Mezclar la harina con la sal. Hacer un hoyo en el centro.\nPaso 3: Agregar la levadura, el aceite y agua tibia de a poco. Amasar 10 minutos hasta que la masa sea suave y elástica.\nPaso 4: Dejar levar tapado en lugar cálido por 1 hora hasta que duplique su volumen.\nPaso 5: Formar los panes, colocar en bandeja enmantequillada y dejar levar 30 minutos más.\nPaso 6: Pintar con agua y hornear a 200°C por 20-25 minutos hasta que estén dorados y suenen huecos.',90,'all'),
        ('Quesillo con Membrillo','once',4,'{"vegetariano","keto"}','Paso 1: Cortar el quesillo o queso fresco en láminas de 1 cm de grosor.\nPaso 2: Cortar el membrillo en rodajas o dados.\nPaso 3: Disponer el quesillo en un plato o tabla de madera.\nPaso 4: Colocar el membrillo al lado o encima del quesillo.\nPaso 5: Rociar con un hilo de miel si se desea.\nPaso 6: Servir acompañado de galletas o pan tostado.',5,'all'),
        ('Malaya Frita','once',4,'{}','Paso 1: Cortar la malaya (falda) de vacuno en tiras delgadas.\nPaso 2: Sazonar con sal, pimienta, ajo y orégano.\nPaso 3: Pasar por harina seasoned y huevo batido.\nPaso 4: Calentar abundante aceite en una sartén.\nPaso 5: Freír las tiras de malaya 2-3 minutos por lado hasta que estén crujientes.\nPaso 6: Escurrir en papel absorbente y servir con pan y pebre.',20,'all'),
        ('Mousse de Chocolate','postre',6,'{"vegetariano"}','Paso 1: Derretir el chocolate en baño María o en microondas en intervalos de 30 segundos. Reservar a temperatura ambiente.\nPaso 2: Separar las claras de las yemas. Batir las yemas con la mitad del azúcar hasta que blanqueen.\nPaso 3: Batir las claras a punto nieve con el azúcar restante hasta que estén firmes y brillantes.\nPaso 4: Mezclar el chocolate tibio con las yemas batidas.\nPaso 5: Incorporar las claras al punto nieve en forma envolvente de a poco.\nPaso 6: Distribuir en copas y refrigerar mínimo 2 horas. Decorar con cacao en polvo antes de servir.',30,'all'),
        ('Kuchen de Manzana','postre',8,'{"vegetariano"}','Paso 1: Hacer la masa: mezclar harina, mantequilla fría, azúcar, sal y yemas hasta obtener migajas. Agregar agua fría de a poco hasta unir.\nPaso 2: Extender en molde enmantequillado. Pinchar con tenedor y pre-hornear 10 minutos a 180°C.\nPaso 3: Pelar y cortar las manzanas en gajos finos. Mezclar con azúcar, canela y maicena.\nPaso 4: Distribuir las manzanas sobre la masa pre-horneada.\nPaso 5: Preparar el streusel: mezclar harina, azúcar y mantequilla fría con los dedos hasta migajas. Cubrir las manzanas.\nPaso 6: Hornear 35-40 minutos hasta dorar. Servir tibio o frío.',60,'all'),
        ('Flan de Leche Condensada','postre',6,'{"vegetariano"}','Paso 1: Caramelizar el azúcar en una olla o molde directamente, a fuego medio sin revolver hasta que tome color ámbar.\nPaso 2: Cubrir el fondo y paredes del molde con el caramelo. Reservar.\nPaso 3: Batir los huevos con la leche condensada y la leche entera hasta integrar.\nPaso 4: Agregar esencia de vainilla y mezclar bien.\nPaso 5: Colar la mezcla y verter sobre el caramelo.\nPaso 6: Hornear al baño María a 160°C por 50 minutos hasta que al insertar un palillo salga limpio. Enfriar y desmoldar.',60,'all'),
        ('Sopaipillas Pasadas','postre',4,'{"vegano"}','Paso 1: Preparar las sopaipillas siguiendo la receta clásica.\nPaso 2: Preparar la chancaca: hervir el bloque de chancaca con agua hasta que se disuelva y forme un jarabe espeso.\nPaso 3: Agregar cáscara de naranja y canela en rama al jarabe.\nPaso 4: Cuando el jarabe tenga consistencia de almíbar, sumergir las sopaipillas fritas.\nPaso 5: Dejar absorber el almíbar unos 5 minutos a fuego muy bajo.\nPaso 6: Servir calientes con el jarabe de chancaca.',45,'invierno'),
        ('Natillas Chilenas','postre',4,'{"vegetariano"}','Paso 1: Calentar la leche con canela en rama y cáscara de limón sin hervir.\nPaso 2: Batir las yemas con el azúcar y la maicena hasta obtener una pasta pálida.\nPaso 3: Verter la leche tibia sobre las yemas poco a poco, revolviendo constantemente.\nPaso 4: Devolver todo a la olla y cocinar a fuego bajo revolviendo sin parar hasta que espese.\nPaso 5: Retirar la canela y la cáscara. Verter en vasitos individuales.\nPaso 6: Enfriar completamente y refrigerar. Espolvorear canela molida antes de servir.',30,'all'),
        ('Arroz con Leche','postre',4,'{"vegetariano"}','Paso 1: Lavar el arroz y cocer en agua por 10 minutos. Escurrir.\nPaso 2: En una olla de fondo grueso, hervir la leche con canela en rama, cáscara de limón y una pizca de sal.\nPaso 3: Agregar el arroz a la leche hirviendo y bajar el fuego al mínimo.\nPaso 4: Cocinar revolviendo frecuentemente por 30-35 minutos hasta que el arroz esté muy tierno y la mezcla espesa.\nPaso 5: Agregar el azúcar y la vainilla. Mezclar y retirar del fuego.\nPaso 6: Servir tibio o frío en vasitos, espolvorear canela generosamente encima.',45,'all'),
        ('Torta de Manjar','postre',10,'{"vegetariano"}','Paso 1: Batir los huevos con el azúcar hasta triplicar el volumen (10 minutos). Incorporar la harina tamizada en forma envolvente.\nPaso 2: Verter en molde enmantequillado y enharinado. Hornear a 170°C por 30-35 minutos.\nPaso 3: Enfriar completamente. Cortar el bizcochuelo en 3 capas horizontales con un hilo dental.\nPaso 4: Batir la crema de leche con azúcar flor hasta que esté firme.\nPaso 5: Montar: primera capa de bizcochuelo, abundante manjar, segunda capa, más manjar, capa final.\nPaso 6: Cubrir toda la torta con la crema batida y decorar con manjar en espiral.',90,'all'),
        ('Calafate Sour','trago',2,'{"vegano"}','Paso 1: Colocar los cubos de hielo en una coctelera.\nPaso 2: Agregar el pisco, el jugo de limón, el azúcar y el jarabe de calafate (o cassis).\nPaso 3: Agitar vigorosamente durante 15-20 segundos hasta que el exterior de la coctelera esté muy frío.\nPaso 4: Colar en copas de cóctel previamente frías.\nPaso 5: Opcional: agregar una clara de huevo antes de agitar para obtener espuma.\nPaso 6: Decorar con un trozo de limón o una frambuesa en el borde de la copa.',5,'all'),
        ('Terremoto','trago',4,'{}','Paso 1: Tomar vasos altos de 500 ml o vasos de plástico grandes.\nPaso 2: Colocar una generosa bola de helado de piña en el fondo de cada vaso.\nPaso 3: Verter lentamente el vino blanco dulce (tipo pipeno) sobre el helado.\nPaso 4: Agregar un chorrito de granadina para darle color.\nPaso 5: El helado se derrite parcialmente creando la mezcla característica del terremoto.\nPaso 6: Servir con una cuchara y sorbete. No mezclar antes de tomar.',5,'verano'),
        ('Chicha de Uva Casera','trago',8,'{"vegano"}','Paso 1: Lavar y despalillar las uvas. Machacar o procesar sin exprimir completamente.\nPaso 2: Colocar en una vasija limpia o tinaja. Agregar agua y azúcar al gusto.\nPaso 3: Dejar fermentar en lugar oscuro y templado, tapado con un paño, 3 a 5 días.\nPaso 4: Revolver suavemente una vez al día.\nPaso 5: Colar con colador fino o tela. Refrigerar.\nPaso 6: Servir bien fría. Cuanto más días fermenta, más alcohol tendrá.',5,'verano'),
        ('Cola de Mono Navideña','trago',8,'{}','Paso 1: Calentar la leche con canela en rama, clavo de olor y cáscara de naranja sin hervir, unos 10 minutos. Enfriar.\nPaso 2: Mezclar el café instantáneo con un poco de agua caliente hasta disolver.\nPaso 3: En un bol grande, batir los huevos con el azúcar hasta integrar.\nPaso 4: Agregar la leche fría colada, el café y la esencia de vainilla.\nPaso 5: Incorporar el aguardiente o pisco de a poco, mezclando suavemente.\nPaso 6: Refrigerar mínimo 4 horas. Servir muy frío en vasitos o copas pequeñas con canela encima.',20,'all'),
        ('Mote con Huesillo Moderno','trago',4,'{"vegano"}','Paso 1: Preparar el mote el día anterior: hervir en abundante agua con sal hasta que esté muy tierno y esponjoso.\nPaso 2: Hidratar los huesillos en agua fría desde la noche anterior.\nPaso 3: Cocinar los huesillos con su agua de remojo, azúcar, canela y cáscara de naranja por 25 minutos hasta que el líquido forme un jarabe.\nPaso 4: Enfriar completamente en el refrigerador mínimo 2 horas.\nPaso 5: En vasos altos de vidrio, poner el mote escurrido.\nPaso 6: Agregar 2 huesillos y bañar con el jarabe bien frío. Servir con hielo si se desea.',30,'verano'),
        ('Ponche de Frutas de Verano','trago',10,'{"vegano"}','Paso 1: Picar en cubos medianos las frutas: durazno, sandía, piña y uvas.\nPaso 2: Colocar todas las frutas en una ponchera o bol grande.\nPaso 3: Añadir el jugo de naranja fresco y el jugo de limón.\nPaso 4: Agregar azúcar al gusto y mezclar hasta disolver.\nPaso 5: Verter el vino blanco frío o agua mineral con gas.\nPaso 6: Agregar hielo en abundancia y decorar con rodajas de naranja y menta. Servir de inmediato.',15,'verano'),
        ('Navegado Chileno','trago',6,'{}','Paso 1: En una olla pequeña, calentar el vino tinto a fuego bajo sin hervir.\nPaso 2: Agregar la canela en rama, el clavo de olor, la cáscara de naranja y limón.\nPaso 3: Incorporar el azúcar y revolver hasta disolver.\nPaso 4: Mantener a fuego muy bajo tapado por 15 minutos para que los aromas se integren.\nPaso 5: Probar y rectificar azúcar si se desea.\nPaso 6: Servir caliente en tazas o vasos resistentes al calor, colando las especias.',20,'invierno'),
        ('Leche con Plátano','trago',2,'{"vegetariano"}','Paso 1: Pelar el plátano bien maduro y cortarlo en trozos.\nPaso 2: Colocar en la licuadora con la leche fría.\nPaso 3: Agregar azúcar al gusto y una pizca de canela.\nPaso 4: Licuar a velocidad alta por 30 segundos hasta que esté completamente suave y cremoso.\nPaso 5: Probar y rectificar dulzor.\nPaso 6: Servir inmediatamente en vasos altos con hielo si se desea.',5,'all'),
        ('Limonada de Menta','trago',4,'{"vegano"}','Paso 1: Exprimir los limones para obtener unos 150 ml de jugo fresco.\nPaso 2: Preparar un jarabe simple: disolver el azúcar en 100 ml de agua caliente. Enfriar.\nPaso 3: En una jarra, mezclar el jugo de limón con el jarabe.\nPaso 4: Agregar hojas de menta fresca y macerar suavemente.\nPaso 5: Completar con agua mineral fría o agua con gas.\nPaso 6: Agregar abundante hielo y rodajas de limón para decorar.',10,'verano'),
        ('Borgoña','trago',6,'{"vegano"}','Paso 1: Lavar y picar las frutillas en cuartos, eliminando el pedúnculo.\nPaso 2: Colocar las frutillas en una jarra grande.\nPaso 3: Agregar el azúcar sobre las frutillas y mezclar. Dejar reposar 15 minutos para que suelten su jugo.\nPaso 4: Verter el vino tinto frío sobre las frutillas maceradas.\nPaso 5: Mezclar suavemente y agregar cubos de hielo.\nPaso 6: Servir en vasos con algunas frutillas y hielo. Decorar con hoja de menta.',20,'verano'),
        ('Caipiroska de Kiwi','trago',2,'{"vegano"}','Paso 1: Pelar el kiwi y cortarlo en gajos. Colocar en el vaso.\nPaso 2: Agregar el azúcar y machar el kiwi con el azúcar hasta que suelte su jugo.\nPaso 3: Exprimir el limón directamente sobre el kiwi macerado.\nPaso 4: Llenar el vaso con hielo picado hasta el borde.\nPaso 5: Verter el vodka o pisco sobre el hielo.\nPaso 6: Revolver bien con una cuchara larga y decorar con un gajo de kiwi.',5,'verano')
        ON CONFLICT (name) DO NOTHING
    `);
    await client.query(`SELECT setval('recipes_id_seq', (SELECT MAX(id) FROM recipes))`);

    /* ── Ingredientes para las nuevas recetas ── */
    const newRecipeIngredients = [
        ['Ensalada de Betarraga con Queso Fresco', [['betarraga',400,'g'],['queso_fresco',150,'g'],['aceite_oliva',30,'ml'],['vinagre',15,'ml'],['albahaca',10,'g']]],
        ['Ceviche de Corvina', [['corvina',600,'g'],['limon',100,'ml'],['cebolla_morada',100,'g'],['cilantro',15,'g'],['pimenton',50,'g']]],
        ['Hummus Casero', [['garbanzos',300,'g'],['ajo',3,'unidades'],['limon',50,'ml'],['aceite_oliva',40,'ml'],['sal',5,'g']]],
        ['Caldo de Patas', [['zanahoria',2,'unidades'],['arvejas',100,'g'],['cebolla',150,'g'],['ajo',3,'unidades'],['cilantro',20,'g']]],
        ['Pebre Casero', [['tomate',200,'g'],['cilantro',30,'g'],['cebolla',100,'g'],['aceite',20,'ml'],['vinagre',15,'ml']]],
        ['Ostiones al Parmesano', [['ostiones',500,'g'],['mantequilla',40,'g'],['ajo',2,'unidades'],['queso_parmesano',80,'g'],['perejil',10,'g']]],
        ['Machas a la Parmesana', [['machas',600,'g'],['mantequilla',50,'g'],['ajo',2,'unidades'],['queso_parmesano',100,'g'],['limon',30,'ml']]],
        ['Empanadas al Horno de Pino', [['harina',500,'g'],['carne_molida',400,'g'],['cebolla',200,'g'],['huevos',4,'unidades'],['mantequilla',80,'g']]],
        ['Cochayuyo Guisado', [['cochayuyo',200,'g'],['cebolla',150,'g'],['tomate',150,'g'],['pimenton',80,'g'],['ajo',2,'unidades']]],
        ['Sopa de Verduras Chilena', [['zanahoria',2,'unidades'],['papa',3,'unidades'],['zapallo',300,'g'],['apio',100,'g'],['puerro',100,'g']]],
        ['Pastel de Papas', [['papa',1000,'g'],['carne_molida',500,'g'],['cebolla',200,'g'],['huevos',3,'unidades'],['queso_mantecoso',150,'g'],['leche',150,'ml'],['mantequilla',50,'g']]],
        ['Cazuela de Pollo', [['pollo',800,'g'],['papa',4,'unidades'],['zapallo',300,'g'],['zanahoria',2,'unidades'],['arroz',80,'g'],['maiz_choclo',1,'unidades']]],
        ['Osobuco Estofado', [['osobuco',1000,'g'],['cebolla',200,'g'],['zanahoria',2,'unidades'],['apio',100,'g'],['pure_tomate',100,'g'],['vino_tinto',200,'ml']]],
        ['Tallarines con Salsa de Carne', [['fideos_tallarines',400,'g'],['carne_molida',400,'g'],['cebolla',150,'g'],['ajo',3,'unidades'],['salsa_tomate',400,'g'],['queso_parmesano',50,'g']]],
        ['Porotos Granados', [['poroto_granado',500,'g'],['maiz_choclo',2,'unidades'],['zapallo',200,'g'],['albahaca',20,'g'],['cebolla',150,'g'],['tomate',150,'g']]],
        ['Salmón al Horno con Limón', [['salmon',600,'g'],['limon',60,'ml'],['ajo',2,'unidades'],['aceite_oliva',30,'ml'],['albahaca',10,'g']]],
        ['Arrollado de Huaso', [['carne_vacuno',800,'g'],['tocino',150,'g'],['huevos',3,'unidades'],['pimenton',100,'g'],['ajo',4,'unidades']]],
        ['Reineta Frita', [['reineta',800,'g'],['harina',100,'g'],['huevos',2,'unidades'],['pan_rallado',100,'g'],['aceite',300,'ml']]],
        ['Costillar de Cerdo al Horno', [['costilla_cerdo',1200,'g'],['ajo',4,'unidades'],['limon',60,'ml'],['aceite_oliva',30,'ml'],['merkén',5,'g']]],
        ['Congrio Frito con Ensalada Chilena', [['congrio',800,'g'],['harina',100,'g'],['huevos',2,'unidades'],['pan_rallado',100,'g'],['aceite',300,'ml'],['tomate',150,'g'],['cebolla',80,'g']]],
        ['Plateada Braseada', [['plateada',1000,'g'],['cebolla',200,'g'],['zanahoria',2,'unidades'],['apio',100,'g'],['vino_tinto',300,'ml']]],
        ['Lomo a lo Pobre', [['lomo_liso',600,'g'],['papa',600,'g'],['cebolla',200,'g'],['huevos',4,'unidades'],['aceite',300,'ml']]],
        ['Churrasco Italiano', [['churrasco',300,'g'],['palta',150,'g'],['tomate',150,'g'],['pan_marraqueta',2,'unidades']]],
        ['Pastel de Jaiba', [['queso_parmesano',80,'g'],['harina',50,'g'],['mantequilla',40,'g'],['leche',300,'ml'],['pan_rallado',50,'g'],['cebolla',100,'g']]],
        ['Plateada a la Cacerola', [['plateada',1000,'g'],['cebolla',200,'g'],['zanahoria',2,'unidades'],['pure_tomate',100,'g'],['vino_tinto',200,'ml'],['ajo',3,'unidades']]],
        ['Cazuela Marina', [['mariscos_surtidos',500,'g'],['pescado',400,'g'],['papa',3,'unidades'],['zapallo',200,'g'],['cebolla',150,'g'],['cilantro',20,'g']]],
        ['Milanesas de Pollo', [['pollo_pechuga',600,'g'],['harina',100,'g'],['huevos',2,'unidades'],['pan_rallado',150,'g'],['aceite',300,'ml']]],
        ['Empanadas de Pino al Horno', [['harina',500,'g'],['carne_molida',400,'g'],['cebolla',200,'g'],['huevos',5,'unidades'],['mantequilla',100,'g']]],
        ['Chupe de Locos', [['locos',600,'g'],['cebolla',150,'g'],['ajo',2,'unidades'],['crema_leche',200,'ml'],['queso_mantecoso',150,'g'],['pan_marraqueta',2,'unidades'],['leche',150,'ml']]],
        ['Filete Salteado con Champiñones', [['filete_vacuno',600,'g'],['champiñon',300,'g'],['ajo',3,'unidades'],['vino_tinto',100,'ml'],['crema_leche',150,'ml'],['aceite_oliva',30,'ml']]],
        ['Arrollado de Vacuno', [['carne_vacuno',800,'g'],['jamón',150,'g'],['huevos',3,'unidades'],['pimenton',100,'g'],['ajo',3,'unidades']]],
        ['Sándwich de Pernil', [['carne_cerdo',800,'g'],['pan_marraqueta',2,'unidades'],['ajo',3,'unidades'],['palta',150,'g'],['tomate',150,'g']]],
        ['Pan con Queso y Tomate', [['pan_marraqueta',2,'unidades'],['queso_mantecoso',150,'g'],['tomate',200,'g']]],
        ['Tostadas Francesas', [['pan_molde',8,'unidades'],['huevos',3,'unidades'],['leche',150,'ml'],['azucar',30,'g'],['canela',3,'g'],['mantequilla',30,'g']]],
        ['Dobladitas de Queso', [['harina',400,'g'],['queso_mantecoso',250,'g'],['aceite',30,'ml']]],
        ['Sopa de Pan', [['pan_marraqueta',3,'unidades'],['cebolla',150,'g'],['ajo',2,'unidades'],['huevos',2,'unidades'],['aceite',20,'ml']]],
        ['Leche Asada', [['leche',1000,'ml'],['huevos',4,'unidades'],['azucar',150,'g'],['vainilla',5,'ml']]],
        ['Pan Batido Casero', [['harina',500,'g'],['aceite',50,'ml'],['azucar',20,'g'],['sal',5,'g']]],
        ['Quesillo con Membrillo', [['queso_fresco',300,'g'],['miel',30,'g']]],
        ['Malaya Frita', [['carne_vacuno',400,'g'],['harina',80,'g'],['huevos',2,'unidades'],['aceite',200,'ml']]],
        ['Mousse de Chocolate', [['chocolate',200,'g'],['huevos',4,'unidades'],['azucar',80,'g'],['crema_leche',200,'ml']]],
        ['Kuchen de Manzana', [['manzana',4,'unidades'],['harina',300,'g'],['mantequilla',150,'g'],['azucar',150,'g'],['canela',5,'g'],['huevos',2,'unidades']]],
        ['Flan de Leche Condensada', [['leche_condensada',400,'ml'],['leche',400,'ml'],['huevos',4,'unidades'],['azucar',100,'g'],['vainilla',5,'ml']]],
        ['Sopaipillas Pasadas', [['harina',500,'g'],['zapallo',300,'g'],['aceite',300,'ml'],['chancaca',200,'g'],['canela',5,'g']]],
        ['Natillas Chilenas', [['leche',1000,'ml'],['azucar',120,'g'],['huevos',4,'unidades'],['maicena',30,'g'],['canela',3,'g']]],
        ['Arroz con Leche', [['arroz',200,'g'],['leche',1000,'ml'],['azucar',100,'g'],['canela',5,'g'],['vainilla',5,'ml']]],
        ['Torta de Manjar', [['huevos',6,'unidades'],['azucar',200,'g'],['harina',200,'g'],['manjar',400,'g'],['crema_leche',400,'ml'],['azucar_flor',50,'g']]],
        ['Calafate Sour', [['pisco',180,'ml'],['limon',80,'ml'],['azucar',40,'g']]],
        ['Terremoto', [['vino_blanco',500,'ml'],['azucar',30,'g']]],
        ['Chicha de Uva Casera', [['uvas',1000,'g'],['azucar',200,'g']]],
        ['Cola de Mono Navideña', [['leche',1000,'ml'],['cafe',20,'g'],['huevos',3,'unidades'],['azucar',150,'g'],['pisco',300,'ml'],['canela',5,'g']]],
        ['Mote con Huesillo Moderno', [['mote',300,'g'],['huesillo',6,'unidades'],['azucar',150,'g'],['canela',5,'g']]],
        ['Ponche de Frutas de Verano', [['durazno',3,'unidades'],['sandia',1000,'g'],['piña',500,'g'],['uvas',300,'g'],['jugo_naranja',500,'ml'],['vino_blanco',500,'ml'],['azucar',100,'g']]],
        ['Navegado Chileno', [['vino_tinto',750,'ml'],['azucar',80,'g'],['canela',10,'g'],['naranja',1,'unidades']]],
        ['Leche con Plátano', [['leche',400,'ml'],['platano',2,'unidades'],['azucar',20,'g'],['canela',2,'g']]],
        ['Limonada de Menta', [['limon',150,'ml'],['azucar',80,'g'],['agua_mineral',500,'ml']]],
        ['Borgoña', [['frutillas',500,'g'],['vino_tinto',750,'ml'],['azucar',80,'g']]],
        ['Caipiroska de Kiwi', [['kiwi',2,'unidades'],['limon',40,'ml'],['azucar',30,'g'],['pisco',120,'ml']]]
    ];
    for (const [recipeName, ings] of newRecipeIngredients) {
        const recipeRes = await client.query(`SELECT id FROM recipes WHERE name = $1`, [recipeName]);
        if (recipeRes.rows.length > 0) {
            const recipeId = recipeRes.rows[0].id;
            for (const [ingId, qty, unit] of ings) {
                await client.query(
                    `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, qty, unit) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                    [recipeId, ingId, qty, unit]
                ).catch(() => {});
            }
        }
    }

    /* ── Lote 2: completar 20 recetas por tipo ── */
    await client.query(`
        INSERT INTO recipes (name, type, base_portions, diets, instructions, cook_time_minutes, season) VALUES
        ('Estofado de Asado de Tira','comida',4,'{}','Paso 1: Sellar el asado de tira en aceite caliente por todos lados hasta dorar.\nPaso 2: Retirar y sofreír cebolla, zanahoria y ajo en la misma olla.\nPaso 3: Devolver la carne, agregar puré de tomate y vino tinto, cubrir con agua.\nPaso 4: Cocinar tapado a fuego bajo 2 horas hasta que la carne esté muy tierna.\nPaso 5: Rectificar sal y servir con puré de papas o arroz.',135,'invierno'),
        ('Pollo al Curry con Arroz','comida',4,'{}','Paso 1: Cortar el pollo en trozos y sazonar con sal y pimienta.\nPaso 2: Dorar el pollo en aceite caliente y reservar.\nPaso 3: Sofreír cebolla y ajo, agregar curry en polvo y cocinar 1 minuto para liberar aroma.\nPaso 4: Devolver el pollo, agregar leche y crema, cocinar tapado 20 minutos.\nPaso 5: Servir caliente sobre arroz blanco graneado.',45,'all'),
        ('Guiso de Choclo con Pollo','comida',4,'{}','Paso 1: Dorar las presas de pollo en aceite caliente.\nPaso 2: Sofreír cebolla y pimentón, agregar choclo desgranado.\nPaso 3: Devolver el pollo, cubrir con agua y cocinar 25 minutos.\nPaso 4: Agregar albahaca y rectificar sal.\nPaso 5: Servir caliente en platos hondos.',45,'verano'),
        ('Albóndigas en Salsa','comida',4,'{}','Paso 1: Mezclar carne molida con huevo, pan rallado, ajo y condimentos. Formar bolitas.\nPaso 2: Dorar las albóndigas en aceite caliente por todos lados. Reservar.\nPaso 3: En la misma olla, sofreír cebolla y agregar salsa de tomate, orégano y un poco de agua.\nPaso 4: Devolver las albóndigas a la salsa y cocinar tapado 20 minutos.\nPaso 5: Servir con tallarines o arroz, bañadas en salsa.',45,'all'),
        ('Cazuela de Cordero','comida',4,'{}','Paso 1: Sellar los trozos de cordero en aceite caliente hasta dorar.\nPaso 2: Cubrir con agua y cocinar a fuego medio 40 minutos hasta espumar el caldo.\nPaso 3: Agregar papas enteras, zapallo en trozos y zanahoria.\nPaso 4: Incorporar arroz y cocinar 20 minutos más.\nPaso 5: Servir caliente con cilantro fresco picado.',90,'invierno'),
        ('Carbonada','comida',4,'{}','Paso 1: Cortar la carne en cubos pequeños y dorar en aceite caliente.\nPaso 2: Sofreír cebolla, zanahoria y pimentón junto a la carne.\nPaso 3: Agregar agua, papa en cubos y choclo desgranado. Cocinar 25 minutos.\nPaso 4: Incorporar fideos cortados y cocinar 10 minutos más hasta que estén tiernos.\nPaso 5: Rectificar sal y servir caliente con bastante caldo.',50,'verano'),
        ('Guatitas a la Jardinera','comida',4,'{}','Paso 1: Cocer las guatitas (panza de vacuno) previamente limpias en agua con sal hasta ablandar, unas 2 horas. Cortar en tiras.\nPaso 2: Sofreír cebolla, zanahoria, pimentón y arvejas en aceite.\nPaso 3: Agregar puré de tomate, ají color y comino.\nPaso 4: Incorporar las guatitas cocidas y un poco del caldo de cocción. Cocinar 20 minutos.\nPaso 5: Servir caliente con arroz blanco o papas cocidas.',150,'invierno'),
        ('Tallarines con Pollo','comida',4,'{}','Paso 1: Cocer los tallarines en agua con sal según el envase.\nPaso 2: Cortar el pollo en tiras y saltear en aceite caliente hasta dorar.\nPaso 3: Agregar cebolla, ajo y champiñones, sofreír 8 minutos.\nPaso 4: Incorporar crema de leche y queso parmesano, cocinar a fuego bajo hasta espesar.\nPaso 5: Mezclar con los tallarines escurridos y servir caliente.',30,'all'),
        ('Curanto en Olla','comida',6,'{}','Paso 1: En una olla muy grande, colocar hojas de repollo en el fondo.\nPaso 2: Agregar capas de mariscos surtidos, longaniza, carne de cerdo y pollo.\nPaso 3: Intercalar con papas y más hojas de repollo entre capas.\nPaso 4: Agregar un poco de agua y vino blanco, tapar herméticamente.\nPaso 5: Cocinar a fuego medio-bajo 1.5 horas sin destapar hasta que todo esté cocido.\nPaso 6: Servir directamente de la olla con el caldo resultante.',100,'all'),
        ('Tomates Rellenos con Atún','entrada',4,'{}','Paso 1: Cortar la parte superior de los tomates y vaciar con cuidado, reservando la pulpa.\nPaso 2: Mezclar el atún escurrido con mayonesa, cebolla picada fina y la pulpa de tomate picada.\nPaso 3: Sazonar con sal, pimienta y jugo de limón.\nPaso 4: Rellenar los tomates con la mezcla de atún.\nPaso 5: Refrigerar 20 minutos antes de servir.',20,'verano'),
        ('Causa de Palta y Atún','entrada',4,'{}','Paso 1: Cocer las papas, pelar y moler hasta obtener un puré liso.\nPaso 2: Sazonar el puré con aceite, sal, limón y un poco de ají amarillo si se dispone.\nPaso 3: Mezclar el atún escurrido con mayonesa y cebolla picada fina.\nPaso 4: Armar capas en un molde: puré de papa, atún, puré de palta molida con limón, terminar con puré.\nPaso 5: Refrigerar 30 minutos y desmoldar antes de servir.',35,'all'),
        ('Ensalada de Palta y Camarón','entrada',4,'{"keto"}','Paso 1: Cocer los camarones en agua con sal por 3 minutos, enfriar en agua con hielo.\nPaso 2: Cortar la palta en cubos grandes.\nPaso 3: Mezclar suavemente la palta con los camarones para no deshacerlos.\nPaso 4: Aliñar con aceite de oliva, limón, sal y pimienta.\nPaso 5: Servir fría decorada con cilantro.',20,'verano'),
        ('Crema de Zapallo','entrada',4,'{"vegetariano"}','Paso 1: Cortar el zapallo en cubos y sofreír con cebolla en mantequilla.\nPaso 2: Cubrir con agua o caldo y cocinar 20 minutos hasta que el zapallo esté muy tierno.\nPaso 3: Licuar todo hasta obtener una crema lisa.\nPaso 4: Devolver a la olla, agregar crema de leche y rectificar sal.\nPaso 5: Servir caliente con crutones de pan.',35,'invierno'),
        ('Crema de Zanahoria','entrada',4,'{"vegetariano"}','Paso 1: Sofreír la zanahoria en rodajas con cebolla en mantequilla por 5 minutos.\nPaso 2: Cubrir con agua o caldo y cocinar 20 minutos hasta ablandar.\nPaso 3: Licuar hasta obtener una crema homogénea.\nPaso 4: Devolver al fuego, agregar un poco de leche y sazonar con sal y pimienta.\nPaso 5: Servir caliente con un toque de crema fresca.',35,'all'),
        ('Tabla de Quesos y Embutidos','entrada',6,'{"keto"}','Paso 1: Cortar el queso mantecoso y el queso fresco en cubos o láminas.\nPaso 2: Disponer el jamón y el salchichón en rollitos sobre una tabla.\nPaso 3: Agregar aceitunas y nueces para complementar.\nPaso 4: Acompañar con pan o galletas.\nPaso 5: Servir a temperatura ambiente.',15,'all'),
        ('Tartar de Salmón','entrada',4,'{"keto"}','Paso 1: Cortar el salmón fresco en cubos muy pequeños y uniformes.\nPaso 2: Mezclar con cebolla morada picada fina, cilantro y un chorrito de aceite de oliva.\nPaso 3: Sazonar con limón, sal y pimienta.\nPaso 4: Mezclar suavemente y dejar marinar 10 minutos en frío.\nPaso 5: Servir frío con tostadas o galletas de agua.',20,'all'),
        ('Carpaccio de Vacuno','entrada',4,'{"keto"}','Paso 1: Congelar ligeramente el filete de vacuno por 30 minutos para facilitar el corte.\nPaso 2: Cortar láminas muy finas con cuchillo afilado o cortafiambres.\nPaso 3: Disponer las láminas extendidas en un plato.\nPaso 4: Rociar con aceite de oliva, jugo de limón, sal y pimienta.\nPaso 5: Decorar con láminas de queso parmesano y rúcula si se dispone. Servir frío.',15,'all'),
        ('Choritos a la Chalaca','entrada',4,'{"keto"}','Paso 1: Cocer los choritos al vapor hasta que abran, descartar los que no se abran.\nPaso 2: Retirar la concha superior y dejar el chorito en la media concha.\nPaso 3: Picar finamente tomate, cebolla morada y cilantro.\nPaso 4: Mezclar con jugo de limón, sal y un toque de ají.\nPaso 5: Cubrir cada chorito con la mezcla y servir frío.',20,'verano'),
        ('Empanaditas de Camarón y Queso','entrada',8,'{}','Paso 1: Preparar una masa simple con harina, mantequilla, agua fría y sal.\nPaso 2: Sofreír los camarones picados con cebolla y un poco de ají color.\nPaso 3: Mezclar los camarones con queso mantecoso rallado.\nPaso 4: Rellenar pequeños círculos de masa, sellar bien los bordes.\nPaso 5: Freír en aceite caliente hasta dorar o hornear a 200°C por 18 minutos.',40,'all'),
        ('Tartaletas de Verduras','entrada',6,'{"vegetariano"}','Paso 1: Cubrir moldes pequeños con masa quebrada (harina, mantequilla, agua, sal).\nPaso 2: Pre-hornear las bases a 180°C por 10 minutos.\nPaso 3: Saltear zapallo italiano, pimentón y cebolla en aceite.\nPaso 4: Batir huevos con leche, sal y pimienta. Mezclar con las verduras.\nPaso 5: Rellenar las bases y hornear 20 minutos más hasta cuajar. Servir tibias.',45,'all'),
        ('Pan Amasado','once',8,'{"vegetariano"}','Paso 1: Mezclar harina con sal y polvos de hornear.\nPaso 2: Agregar manteca o mantequilla derretida y agua tibia de a poco.\nPaso 3: Amasar firmemente por 10 minutos hasta obtener una masa lisa y elástica.\nPaso 4: Dejar reposar tapado 30 minutos.\nPaso 5: Formar panes redondos, pinchar con tenedor y hornear a 200°C por 25 minutos.',60,'all'),
        ('Berlines Rellenos','once',8,'{"vegetariano"}','Paso 1: Preparar una masa con harina, levadura, huevo, azúcar, mantequilla y leche tibia. Amasar y dejar levar 1 hora.\nPaso 2: Formar bolitas y dejar levar 30 minutos más.\nPaso 3: Freír en aceite a 170°C hasta dorar por ambos lados.\nPaso 4: Escurrir y rellenar con manjar o mermelada usando manga pastelera.\nPaso 5: Espolvorear azúcar flor antes de servir.',90,'all'),
        ('Queque de Plátano','once',8,'{"vegetariano"}','Paso 1: Batir mantequilla con azúcar hasta cremar. Agregar huevos uno a uno.\nPaso 2: Moler los plátanos maduros y agregar a la mezcla.\nPaso 3: Incorporar harina con polvos de hornear en forma envolvente.\nPaso 4: Verter en molde enmantequillado y enharinado.\nPaso 5: Hornear a 180°C por 45 minutos hasta que un palillo salga limpio.',60,'all'),
        ('Calzones Rotos','once',8,'{"vegano"}','Paso 1: Mezclar harina con huevo, azúcar, manteca derretida, esencia de naranja y una pizca de sal.\nPaso 2: Amasar hasta obtener masa lisa. Dejar reposar 15 minutos.\nPaso 3: Estirar la masa fina y cortar rombos, hacer un corte central y pasar una punta por el orificio.\nPaso 4: Freír en aceite caliente hasta dorar por ambos lados.\nPaso 5: Escurrir y espolvorear azúcar flor antes de servir.',40,'all'),
        ('Huevos Revueltos con Tomate','once',2,'{"vegetariano"}','Paso 1: Picar el tomate en cubos pequeños, escurriendo el exceso de líquido.\nPaso 2: Batir los huevos con sal y pimienta.\nPaso 3: Calentar mantequilla en sartén, agregar el tomate y cocinar 2 minutos.\nPaso 4: Verter los huevos batidos y revolver constantemente a fuego bajo.\nPaso 5: Retirar cuando estén cremosos, sin dejar que se sequen. Servir con pan.',10,'all'),
        ('Pan con Palta y Huevo','once',2,'{"vegetariano"}','Paso 1: Cocer un huevo duro durante 10 minutos, enfriar y picar.\nPaso 2: Moler la palta con sal y limón.\nPaso 3: Tostar el pan elegido.\nPaso 4: Untar la palta sobre el pan.\nPaso 5: Agregar el huevo picado encima y servir.',15,'all'),
        ('Bizcochuelo Simple','once',8,'{"vegetariano"}','Paso 1: Batir los huevos con el azúcar a velocidad alta hasta triplicar el volumen, unos 10 minutos.\nPaso 2: Incorporar la harina tamizada con polvos de hornear en forma envolvente, sin batir fuerte.\nPaso 3: Agregar esencia de vainilla.\nPaso 4: Verter en molde enmantequillado y enharinado.\nPaso 5: Hornear a 170°C por 30 minutos hasta dorar.',45,'all'),
        ('Sándwich de Jamón y Queso','once',2,'{}','Paso 1: Cortar el pan de molde o marraqueta por la mitad.\nPaso 2: Colocar láminas de jamón sobre el pan.\nPaso 3: Agregar láminas de queso mantecoso encima.\nPaso 4: Calentar en sartén o plancha hasta que el queso se derrita.\nPaso 5: Servir caliente, cortado por la mitad.',10,'all'),
        ('Yogurt con Granola Casera','once',2,'{"vegetariano"}','Paso 1: Tostar la avena en sartén seca con miel y nueces picadas a fuego bajo, revolviendo hasta dorar.\nPaso 2: Dejar enfriar la granola completamente para que quede crujiente.\nPaso 3: Colocar yogurt natural en un vaso o copa.\nPaso 4: Agregar la granola encima.\nPaso 5: Decorar con frutillas o plátano picado y servir.',15,'all'),
        ('Torta de Mil Hojas','once',10,'{"vegetariano"}','Paso 1: Preparar una masa simple con harina, manteca, agua y sal. Dividir en 6-8 discos delgados.\nPaso 2: Hornear cada disco a 200°C por 8-10 minutos hasta dorar levemente. Enfriar.\nPaso 3: Batir manjar para suavizarlo.\nPaso 4: Armar la torta intercalando discos con manjar entre cada capa.\nPaso 5: Espolvorear azúcar flor encima y refrigerar antes de servir.',90,'all'),
        ('Tiramisu Chileno','postre',8,'{"vegetariano"}','Paso 1: Preparar café fuerte y dejar enfriar.\nPaso 2: Batir la crema de leche con azúcar hasta punto chantilly. Mezclar con queso crema o ricotta.\nPaso 3: Remojar bizcochos o pan de molde en el café.\nPaso 4: Armar capas alternando bizcocho remojado y crema en un molde.\nPaso 5: Espolvorear cacao en polvo encima y refrigerar mínimo 4 horas antes de servir.',30,'all'),
        ('Panqueques con Manjar','postre',4,'{"vegetariano"}','Paso 1: Batir harina, huevos, leche y una pizca de sal hasta obtener una mezcla líquida sin grumos.\nPaso 2: Calentar una sartén con un poco de mantequilla y verter una capa fina de la mezcla.\nPaso 3: Cocinar 1-2 minutos por lado hasta dorar levemente.\nPaso 4: Rellenar cada panqueque con manjar y doblar en cuartos.\nPaso 5: Espolvorear azúcar flor y servir tibios.',30,'all'),
        ('Helado de Lúcuma Casero','postre',6,'{"vegetariano"}','Paso 1: Procesar la pulpa de lúcuma (o duraznos si no se dispone) hasta obtener un puré liso.\nPaso 2: Mezclar con leche condensada y crema de leche.\nPaso 3: Batir todo junto hasta integrar completamente.\nPaso 4: Verter en un molde apto para congelador.\nPaso 5: Congelar mínimo 6 horas, batiendo cada 2 horas para evitar cristales. Servir en bochas.',30,'verano'),
        ('Brazo de Reina','postre',8,'{"vegetariano"}','Paso 1: Batir huevos con azúcar hasta triplicar volumen. Incorporar harina en forma envolvente.\nPaso 2: Extender la mezcla en una bandeja plana forrada con papel mantequilla.\nPaso 3: Hornear a 200°C por 10 minutos hasta dorar levemente.\nPaso 4: Desmoldar caliente sobre un paño con azúcar y enrollar inmediatamente. Enfriar enrollado.\nPaso 5: Desenrollar, rellenar con manjar, volver a enrollar y espolvorear azúcar flor.',40,'all'),
        ('Pie de Limón','postre',8,'{"vegetariano"}','Paso 1: Preparar la base mezclando galletas molidas con mantequilla derretida. Presionar en un molde y refrigerar.\nPaso 2: Batir yemas con leche condensada y jugo de limón hasta espesar.\nPaso 3: Verter sobre la base y hornear a 160°C por 15 minutos.\nPaso 4: Batir las claras a punto nieve con azúcar para el merengue.\nPaso 5: Cubrir el pie con merengue y dorar con soplete o en horno con grill. Refrigerar antes de servir.',45,'verano'),
        ('Crema Volteada','postre',6,'{"vegetariano"}','Paso 1: Caramelizar azúcar en el molde hasta dorar.\nPaso 2: Batir huevos con leche condensada, leche evaporada y vainilla.\nPaso 3: Verter sobre el caramelo en el molde.\nPaso 4: Cocinar al baño María en el horno a 160°C por 50 minutos.\nPaso 5: Enfriar completamente, refrigerar y desmoldar antes de servir.',65,'all'),
        ('Galletas de Avena','postre',12,'{"vegetariano"}','Paso 1: Batir mantequilla con azúcar hasta cremar. Agregar huevo y vainilla.\nPaso 2: Incorporar harina, avena y polvos de hornear, mezclando hasta integrar.\nPaso 3: Agregar pasas si se desea.\nPaso 4: Formar bolitas y aplastar levemente sobre una bandeja con papel mantequilla.\nPaso 5: Hornear a 180°C por 12-15 minutos hasta dorar los bordes.',30,'all'),
        ('Picarones','postre',6,'{"vegano"}','Paso 1: Cocer zapallo y camote hasta tiernizar. Moler hasta puré.\nPaso 2: Mezclar el puré con harina, levadura, azúcar y agua tibia hasta obtener una masa elástica.\nPaso 3: Dejar reposar tapado 30 minutos.\nPaso 4: Formar anillos con la masa usando las manos húmedas y freír en aceite caliente hasta dorar.\nPaso 5: Bañar con chancaca derretida con canela y naranja. Servir tibios.',50,'invierno'),
        ('Empolvados','postre',10,'{"vegetariano"}','Paso 1: Batir mantequilla con azúcar flor hasta cremar.\nPaso 2: Agregar maicena y harina tamizadas, formando una masa suave.\nPaso 3: Formar bolitas pequeñas y aplastar levemente.\nPaso 4: Hornear a 160°C por 15 minutos sin dejar dorar.\nPaso 5: Pasar por azúcar flor aún calientes y nuevamente cuando enfríen.',35,'all'),
        ('Alfajores Chilenos','postre',10,'{"vegetariano"}','Paso 1: Mezclar harina, maicena, mantequilla, azúcar y yemas hasta formar una masa suave.\nPaso 2: Estirar la masa y cortar círculos delgados.\nPaso 3: Hornear a 180°C por 10 minutos hasta dorar levemente. Enfriar.\nPaso 4: Rellenar con manjar entre dos discos.\nPaso 5: Pasar los bordes por coco rallado y espolvorear azúcar flor.',45,'all'),
        ('Torta de Frutillas','postre',10,'{"vegetariano"}','Paso 1: Hornear un bizcochuelo simple y dejar enfriar. Cortar en dos capas.\nPaso 2: Lavar y picar las frutillas, macerar con azúcar.\nPaso 3: Batir crema de leche con azúcar hasta punto chantilly.\nPaso 4: Armar la torta con una capa de bizcocho, crema, frutillas, repetir y cubrir toda la torta con crema.\nPaso 5: Decorar con frutillas enteras encima y refrigerar antes de servir.',60,'verano'),
        ('Copa de Frutas con Helado','postre',4,'{"vegetariano"}','Paso 1: Picar en cubos las frutas de estación disponibles (durazno, piña, plátano, uvas).\nPaso 2: Mezclar las frutas en un bol con un poco de jugo de naranja.\nPaso 3: Distribuir las frutas en copas individuales.\nPaso 4: Agregar una bocha de helado encima.\nPaso 5: Decorar con una galleta y servir de inmediato.',15,'verano'),
        ('Queque de Naranja','postre',8,'{"vegetariano"}','Paso 1: Batir mantequilla con azúcar hasta cremar. Agregar huevos uno a uno.\nPaso 2: Incorporar ralladura y jugo de naranja.\nPaso 3: Agregar harina con polvos de hornear en forma envolvente.\nPaso 4: Verter en molde enmantequillado.\nPaso 5: Hornear a 180°C por 40-45 minutos hasta que un palillo salga limpio.',60,'all'),
        ('Vaina','trago',4,'{}','Paso 1: Batir una yema de huevo con azúcar flor hasta espesar.\nPaso 2: Agregar el oporto o vino dulce a la mezcla.\nPaso 3: Incorporar coñac o pisco al gusto.\nPaso 4: Batir bien hasta integrar completamente y formar espuma leve.\nPaso 5: Servir en copas pequeñas espolvoreando canela o cacao encima.',10,'invierno'),
        ('Cuba Libre','trago',2,'{}','Paso 1: Llenar un vaso alto con abundante hielo.\nPaso 2: Agregar el ron.\nPaso 3: Completar con bebida cola fría.\nPaso 4: Exprimir un trozo de limón y dejarlo caer dentro del vaso.\nPaso 5: Revolver suavemente con una cuchara larga y servir.',5,'verano'),
        ('Piscola','trago',2,'{}','Paso 1: Llenar un vaso largo con hielo hasta el borde.\nPaso 2: Verter el pisco sobre el hielo.\nPaso 3: Completar con bebida cola bien fría.\nPaso 4: Revolver suavemente con una bombilla o cuchara.\nPaso 5: Decorar con una rodaja de limón si se desea y servir de inmediato.',5,'all'),
        ('Daiquiri de Frutilla','trago',2,'{"vegano"}','Paso 1: Lavar y picar las frutillas, retirando el pedúnculo.\nPaso 2: Colocar en la licuadora con el ron, jugo de limón y azúcar.\nPaso 3: Agregar abundante hielo picado.\nPaso 4: Licuar a velocidad alta hasta obtener una mezcla homogénea y helada.\nPaso 5: Servir de inmediato en copas frías.',10,'verano'),
        ('Mojito Chileno','trago',2,'{"vegano"}','Paso 1: Colocar hojas de menta y azúcar en el fondo de un vaso.\nPaso 2: Machacar suavemente la menta con el azúcar para liberar los aceites.\nPaso 3: Agregar jugo de limón y el ron.\nPaso 4: Llenar el vaso con hielo picado.\nPaso 5: Completar con agua mineral con gas y revolver suavemente. Decorar con menta fresca.',10,'verano'),
        ('Sangría Chilena','trago',8,'{"vegano"}','Paso 1: Picar en cubos naranja, manzana y durazno.\nPaso 2: Colocar las frutas en una jarra grande junto con azúcar.\nPaso 3: Verter el vino tinto sobre las frutas y dejar macerar 1 hora en el refrigerador.\nPaso 4: Antes de servir, agregar un chorro de jugo de naranja y hielo.\nPaso 5: Servir en vasos con frutas y un poco de líquido.',75,'verano'),
        ('Café Helado con Licor','trago',2,'{"vegetariano"}','Paso 1: Preparar café cargado y dejar enfriar completamente.\nPaso 2: Llenar un vaso con hielo.\nPaso 3: Verter el café frío sobre el hielo.\nPaso 4: Agregar un toque de licor de café o pisco si se desea.\nPaso 5: Completar con un poco de leche o crema y servir con bombilla.',15,'verano'),
        ('Ponche Romano','trago',6,'{"vegano"}','Paso 1: Preparar un almíbar con azúcar y agua, dejar enfriar.\nPaso 2: Mezclar el almíbar con jugo de naranja y limón.\nPaso 3: Agregar vino blanco frío y un chorro de pisco.\nPaso 4: Incorporar abundante hielo picado.\nPaso 5: Servir en copas frías decoradas con una rodaja de naranja.',15,'verano'),
        ('Jugo de Frutilla con Menta','trago',4,'{"vegano"}','Paso 1: Lavar las frutillas y retirar el pedúnculo.\nPaso 2: Licuar las frutillas con agua fría y azúcar.\nPaso 3: Colar si se prefiere una textura más fina.\nPaso 4: Agregar hojas de menta picada.\nPaso 5: Servir bien frío con hielo.',10,'verano'),
        ('Asado de Tira a la Parrilla','plato',4,'{}','Paso 1: Sazonar el asado de tira con sal gruesa una hora antes de cocinar.\nPaso 2: Encender el carbón o la parrilla y esperar a que tenga brasas parejas.\nPaso 3: Colocar la carne sobre la parrilla a fuego medio-alto.\nPaso 4: Cocinar 12-15 minutos por lado según el grosor, dando vuelta solo una vez.\nPaso 5: Dejar reposar 5 minutos antes de cortar. Servir con pebre y ensalada.',40,'verano'),
        ('Anticuchos','plato',4,'{}','Paso 1: Cortar la carne en cubos parejos y marinar con ajo, comino, ají color y vinagre por 2 horas.\nPaso 2: Ensartar los trozos de carne alternando con cebolla y pimentón en palitos de brocheta.\nPaso 3: Calentar la parrilla o sartén grill a fuego alto.\nPaso 4: Cocinar las brochetas 3-4 minutos por lado hasta dorar.\nPaso 5: Servir calientes con papas cocidas y ají.',40,'verano'),
        ('Choripán','plato',4,'{}','Paso 1: Cocinar los chorizos a la parrilla o en sartén a fuego medio hasta que estén bien cocidos por dentro, unos 12 minutos.\nPaso 2: Calentar el pan marraqueta o hallulla en la parrilla.\nPaso 3: Preparar pebre con tomate, cebolla, cilantro y ají.\nPaso 4: Cortar el chorizo a lo largo y colocar dentro del pan.\nPaso 5: Cubrir con pebre y servir caliente.',25,'verano'),
        ('Parrillada Mixta','plato',6,'{}','Paso 1: Sazonar carne de vacuno, pollo, longaniza y chorizo con sal gruesa.\nPaso 2: Encender la parrilla y esperar a que tenga brasas parejas.\nPaso 3: Cocinar primero los embutidos, luego las carnes según su grosor, comenzando con las de cocción más larga.\nPaso 4: Dar vuelta una sola vez cada pieza para mantener los jugos.\nPaso 5: Servir todo junto en una fuente grande con pebre y ensaladas.',60,'verano'),
        ('Pollo Asado con Papas','plato',4,'{}','Paso 1: Frotar el pollo entero con ajo machacado, sal, pimienta y orégano por dentro y por fuera.\nPaso 2: Cortar papas en cuartos y disponer alrededor del pollo en una fuente.\nPaso 3: Rociar todo con aceite de oliva.\nPaso 4: Hornear a 200°C por 70-80 minutos, bañando con su jugo cada 20 minutos.\nPaso 5: Verificar que el jugo salga claro al pinchar el muslo. Servir caliente.',90,'all'),
        ('Cerdo Agridulce','plato',4,'{}','Paso 1: Cortar la pulpa de cerdo en cubos y dorar en aceite caliente.\nPaso 2: Agregar pimentón y cebolla en cuadrados, sofreír 5 minutos.\nPaso 3: Preparar la salsa mezclando salsa de soya, azúcar, vinagre y un poco de maicena disuelta en agua.\nPaso 4: Verter la salsa sobre el cerdo y cocinar revolviendo hasta que espese, unos 8 minutos.\nPaso 5: Servir caliente sobre arroz blanco.',40,'all'),
        ('Salmón a la Mantequilla','plato',4,'{"keto"}','Paso 1: Salpimentar los filetes de salmón.\nPaso 2: Calentar mantequilla en una sartén a fuego medio-alto.\nPaso 3: Cocinar el salmón 4 minutos por el lado de la piel hasta dorar y crujiente.\nPaso 4: Dar vuelta, agregar ajo machacado y jugo de limón, cocinar 3 minutos más bañando con la mantequilla.\nPaso 5: Servir de inmediato con la salsa de mantequilla por encima.',20,'all'),
        ('Cazuela de Pavo','plato',4,'{}','Paso 1: Dorar los trozos de pavo en aceite caliente.\nPaso 2: Cubrir con agua y cocinar a fuego medio 30 minutos.\nPaso 3: Agregar papas enteras, zapallo en trozos y zanahoria.\nPaso 4: Incorporar arroz y cocinar 20 minutos más hasta que todo esté tierno.\nPaso 5: Servir caliente en platos hondos con cilantro fresco.',60,'invierno'),
        ('Filete a lo Pobre','plato',4,'{}','Paso 1: Salpimentar los filetes de vacuno.\nPaso 2: Freír papas en bastones hasta que estén doradas y crujientes. Reservar calientes.\nPaso 3: Cocinar los filetes en sartén caliente 2-3 minutos por lado.\nPaso 4: Freír cebolla en pluma hasta dorar y caramelizar.\nPaso 5: Freír huevos con yema blanda. Armar el plato con filete, papas, cebolla y huevo encima.',30,'all'),
        ('Vacuno Salteado con Verduras','plato',4,'{"keto"}','Paso 1: Cortar el lomo liso en tiras delgadas.\nPaso 2: Calentar aceite a fuego alto y saltear la carne rápidamente hasta sellar. Reservar.\nPaso 3: En la misma sartén, saltear pimentón, cebolla y brócoli a fuego alto por 4 minutos.\nPaso 4: Devolver la carne a la sartén, agregar salsa de soya y ajo.\nPaso 5: Saltear todo junto 2 minutos más y servir caliente con arroz.',25,'all')
        ON CONFLICT (name) DO NOTHING
    `);
    await client.query(`SELECT setval('recipes_id_seq', (SELECT MAX(id) FROM recipes))`);

    const batch2Ingredients = [
        ['Estofado de Asado de Tira', [['asado_tira',1000,'g'],['cebolla',200,'g'],['zanahoria',2,'unidades'],['ajo',3,'unidades'],['pure_tomate',100,'g'],['vino_tinto',200,'ml']]],
        ['Pollo al Curry con Arroz', [['pollo',800,'g'],['cebolla',150,'g'],['ajo',2,'unidades'],['leche',200,'ml'],['crema_leche',100,'ml'],['arroz',300,'g']]],
        ['Guiso de Choclo con Pollo', [['pollo',800,'g'],['cebolla',150,'g'],['pimenton',100,'g'],['maiz_choclo',3,'unidades'],['albahaca',10,'g']]],
        ['Albóndigas en Salsa', [['carne_molida',500,'g'],['huevos',1,'unidades'],['pan_rallado',50,'g'],['ajo',2,'unidades'],['salsa_tomate',400,'g'],['cebolla',100,'g']]],
        ['Cazuela de Cordero', [['carne_vacuno',800,'g'],['papa',4,'unidades'],['zapallo',300,'g'],['zanahoria',2,'unidades'],['arroz',80,'g'],['cilantro',15,'g']]],
        ['Carbonada', [['carne_vacuno',500,'g'],['cebolla',150,'g'],['zanahoria',2,'unidades'],['pimenton',80,'g'],['papa',3,'unidades'],['maiz_choclo',1,'unidades'],['fideos',150,'g']]],
        ['Guatitas a la Jardinera', [['carne_vacuno',800,'g'],['cebolla',150,'g'],['zanahoria',2,'unidades'],['pimenton',80,'g'],['arvejas',100,'g'],['pure_tomate',100,'g']]],
        ['Tallarines con Pollo', [['fideos_tallarines',400,'g'],['pollo',500,'g'],['cebolla',100,'g'],['ajo',2,'unidades'],['champiñon',200,'g'],['crema_leche',200,'ml'],['queso_parmesano',50,'g']]],
        ['Curanto en Olla', [['mariscos_surtidos',500,'g'],['longaniza',3,'unidades'],['carne_cerdo',400,'g'],['pollo',500,'g'],['papa',6,'unidades'],['repollo',300,'g'],['vino_blanco',150,'ml']]],
        ['Tomates Rellenos con Atún', [['tomate',4,'unidades'],['atun_tarro',200,'g'],['mayonesa',60,'g'],['cebolla',50,'g'],['limon',20,'ml']]],
        ['Causa de Palta y Atún', [['papa',800,'g'],['atun_tarro',300,'g'],['mayonesa',80,'g'],['palta',200,'g'],['limon',40,'ml'],['cebolla',50,'g']]],
        ['Ensalada de Palta y Camarón', [['palta',300,'g'],['camarones',300,'g'],['limon',30,'ml'],['aceite_oliva',20,'ml'],['cilantro',10,'g']]],
        ['Crema de Zapallo', [['zapallo',600,'g'],['cebolla',100,'g'],['mantequilla',30,'g'],['crema_leche',100,'ml']]],
        ['Crema de Zanahoria', [['zanahoria',5,'unidades'],['cebolla',100,'g'],['mantequilla',30,'g'],['leche',150,'ml']]],
        ['Tabla de Quesos y Embutidos', [['queso_mantecoso',200,'g'],['queso_fresco',150,'g'],['jamón',150,'g'],['salchichón',150,'g']]],
        ['Tartar de Salmón', [['salmon',400,'g'],['cebolla_morada',50,'g'],['cilantro',10,'g'],['limon',30,'ml'],['aceite_oliva',20,'ml']]],
        ['Carpaccio de Vacuno', [['filete_vacuno',400,'g'],['aceite_oliva',30,'ml'],['limon',20,'ml'],['queso_parmesano',50,'g']]],
        ['Choritos a la Chalaca', [['mariscos_surtidos',600,'g'],['tomate',150,'g'],['cebolla_morada',80,'g'],['cilantro',15,'g'],['limon',40,'ml']]],
        ['Empanaditas de Camarón y Queso', [['harina',300,'g'],['mantequilla',100,'g'],['camarones',300,'g'],['queso_mantecoso',150,'g'],['cebolla',80,'g']]],
        ['Tartaletas de Verduras', [['harina',250,'g'],['mantequilla',100,'g'],['huevos',3,'unidades'],['leche',150,'ml'],['pimenton',100,'g'],['cebolla',80,'g']]],
        ['Pan Amasado', [['harina',600,'g'],['mantequilla',60,'g'],['polvo_hornear',10,'g'],['sal',10,'g']]],
        ['Berlines Rellenos', [['harina',500,'g'],['huevos',2,'unidades'],['azucar',80,'g'],['mantequilla',60,'g'],['leche',150,'ml'],['manjar',200,'g'],['aceite',300,'ml']]],
        ['Queque de Plátano', [['platano',4,'unidades'],['mantequilla',150,'g'],['azucar',150,'g'],['huevos',3,'unidades'],['harina',250,'g'],['polvo_hornear',10,'g']]],
        ['Calzones Rotos', [['harina',400,'g'],['huevos',2,'unidades'],['azucar',60,'g'],['aceite',300,'ml'],['azucar_flor',30,'g']]],
        ['Huevos Revueltos con Tomate', [['huevos',4,'unidades'],['tomate',150,'g'],['mantequilla',20,'g']]],
        ['Pan con Palta y Huevo', [['pan_marraqueta',2,'unidades'],['palta',150,'g'],['huevos',1,'unidades']]],
        ['Bizcochuelo Simple', [['huevos',6,'unidades'],['azucar',200,'g'],['harina',200,'g'],['polvo_hornear',10,'g'],['vainilla',5,'ml']]],
        ['Sándwich de Jamón y Queso', [['pan_molde',4,'unidades'],['jamón',100,'g'],['queso_mantecoso',100,'g']]],
        ['Yogurt con Granola Casera', [['avena',150,'g'],['miel',40,'g'],['nuez',40,'g'],['yogurt',400,'g'],['frutillas',100,'g']]],
        ['Torta de Mil Hojas', [['harina',500,'g'],['mantequilla',150,'g'],['manjar',600,'g'],['azucar_flor',40,'g']]],
        ['Tiramisu Chileno', [['cafe',20,'g'],['crema_leche',300,'ml'],['azucar',100,'g'],['ricotta',250,'g'],['pan_molde',8,'unidades'],['cacao',20,'g']]],
        ['Panqueques con Manjar', [['harina',200,'g'],['huevos',3,'unidades'],['leche',400,'ml'],['manjar',300,'g'],['mantequilla',30,'g']]],
        ['Helado de Lúcuma Casero', [['durazno',4,'unidades'],['leche_condensada',400,'ml'],['crema_leche',300,'ml']]],
        ['Brazo de Reina', [['huevos',5,'unidades'],['azucar',150,'g'],['harina',150,'g'],['manjar',300,'g'],['azucar_flor',30,'g']]],
        ['Pie de Limón', [['harina',200,'g'],['mantequilla',100,'g'],['leche_condensada',400,'ml'],['huevos',4,'unidades'],['limon',100,'ml'],['azucar',100,'g']]],
        ['Crema Volteada', [['azucar',150,'g'],['huevos',5,'unidades'],['leche_condensada',400,'ml'],['leche_evaporada',400,'ml'],['vainilla',5,'ml']]],
        ['Galletas de Avena', [['mantequilla',150,'g'],['azucar',150,'g'],['huevos',1,'unidades'],['harina',200,'g'],['avena',150,'g'],['pasas',60,'g']]],
        ['Picarones', [['zapallo',400,'g'],['harina',400,'g'],['azucar',50,'g'],['chancaca',200,'g'],['canela',5,'g'],['aceite',400,'ml']]],
        ['Empolvados', [['mantequilla',200,'g'],['azucar_flor',150,'g'],['maicena',150,'g'],['harina',150,'g']]],
        ['Alfajores Chilenos', [['harina',250,'g'],['maicena',100,'g'],['mantequilla',150,'g'],['azucar',80,'g'],['manjar',300,'g']]],
        ['Torta de Frutillas', [['huevos',5,'unidades'],['azucar',150,'g'],['harina',150,'g'],['frutillas',400,'g'],['crema_leche',300,'ml']]],
        ['Copa de Frutas con Helado', [['durazno',2,'unidades'],['piña',200,'g'],['platano',2,'unidades'],['uvas',150,'g'],['jugo_naranja',100,'ml']]],
        ['Queque de Naranja', [['mantequilla',150,'g'],['azucar',150,'g'],['huevos',3,'unidades'],['naranja',2,'unidades'],['harina',250,'g'],['polvo_hornear',10,'g']]],
        ['Vaina', [['huevos',1,'unidades'],['azucar_flor',30,'g'],['vino_tinto',200,'ml'],['pisco',100,'ml'],['canela',2,'g']]],
        ['Cuba Libre', [['ron',120,'ml'],['limon',20,'ml']]],
        ['Piscola', [['pisco',150,'ml']]],
        ['Daiquiri de Frutilla', [['frutillas',200,'g'],['ron',150,'ml'],['limon',40,'ml'],['azucar',30,'g']]],
        ['Mojito Chileno', [['ron',150,'ml'],['limon',60,'ml'],['azucar',30,'g'],['agua_mineral',200,'ml']]],
        ['Sangría Chilena', [['vino_tinto',750,'ml'],['naranja',1,'unidades'],['manzana',1,'unidades'],['durazno',1,'unidades'],['azucar',60,'g'],['jugo_naranja',150,'ml']]],
        ['Café Helado con Licor', [['cafe',20,'g'],['pisco',60,'ml'],['leche',100,'ml']]],
        ['Ponche Romano', [['azucar',100,'g'],['jugo_naranja',200,'ml'],['limon',40,'ml'],['vino_blanco',400,'ml'],['pisco',100,'ml']]],
        ['Jugo de Frutilla con Menta', [['frutillas',400,'g'],['azucar',60,'g']]],
        ['Asado de Tira a la Parrilla', [['asado_tira',1200,'g']]],
        ['Anticuchos', [['carne_vacuno',600,'g'],['ajo',3,'unidades'],['comino',5,'g'],['aji_color',5,'g'],['cebolla',150,'g'],['pimenton',100,'g']]],
        ['Choripán', [['longaniza',4,'unidades'],['pan_marraqueta',4,'unidades'],['tomate',150,'g'],['cilantro',15,'g']]],
        ['Parrillada Mixta', [['carne_vacuno',600,'g'],['pollo',500,'g'],['longaniza',3,'unidades'],['vienesa',4,'unidades']]],
        ['Pollo Asado con Papas', [['pollo',1500,'g'],['papa',800,'g'],['ajo',4,'unidades'],['aceite_oliva',40,'ml']]],
        ['Cerdo Agridulce', [['pulpa_cerdo',600,'g'],['pimenton',150,'g'],['cebolla',150,'g'],['salsa_soya',40,'ml'],['azucar',30,'g'],['vinagre',30,'ml'],['maicena',10,'g']]],
        ['Salmón a la Mantequilla', [['salmon',600,'g'],['mantequilla',60,'g'],['ajo',2,'unidades'],['limon',30,'ml']]],
        ['Cazuela de Pavo', [['pollo',800,'g'],['papa',4,'unidades'],['zapallo',300,'g'],['zanahoria',2,'unidades'],['arroz',80,'g']]],
        ['Filete a lo Pobre', [['filete_vacuno',600,'g'],['papa',600,'g'],['cebolla',200,'g'],['huevos',4,'unidades'],['aceite',300,'ml']]],
        ['Vacuno Salteado con Verduras', [['lomo_liso',500,'g'],['pimenton',100,'g'],['cebolla',100,'g'],['brocoli',200,'g'],['salsa_soya',30,'ml'],['ajo',2,'unidades']]]
    ];
    for (const [recipeName, ings] of batch2Ingredients) {
        const recipeRes = await client.query(`SELECT id FROM recipes WHERE name = $1`, [recipeName]);
        if (recipeRes.rows.length > 0) {
            const recipeId = recipeRes.rows[0].id;
            for (const [ingId, qty, unit] of ings) {
                await client.query(
                    `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, qty, unit) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                    [recipeId, ingId, qty, unit]
                ).catch(() => {});
            }
        }
    }
}

/* ================= INGREDIENTS ================= */
app.get('/api/ingredients', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM ingredients ORDER BY name');
        const db = {};
        rows.forEach(r => { db[r.id] = { name: r.name, baseUnit: r.base_unit, pricePerBase: parseFloat(r.price_per_base), conversion: r.conversion || {}, nutrition: r.nutrition || {}, category: r.category || 'otros' }; });
        res.json(db);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ingredients', async (req, res) => {
    try {
        const { id, name, baseUnit, pricePerBase, conversion, nutrition, category } = req.body;
        await pool.query(`INSERT INTO ingredients (id, name, base_unit, price_per_base, conversion, nutrition, category) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, name, baseUnit, pricePerBase, conversion, nutrition, category || 'otros']);
        res.json({ success: true });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Ingrediente ya existe' });
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/ingredients/:id/price', async (req, res) => {
    try {
        const { price_per_base } = req.body;
        if (typeof price_per_base !== 'number' || price_per_base < 0) return res.status(400).json({ error: 'Precio inválido' });
        await pool.query('UPDATE ingredients SET price_per_base = $1 WHERE id = $2', [price_per_base, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── ACTUALIZACIÓN MASIVA DE PRECIOS (promedio mercado chileno 2025-2026) ─── */
// price_per_base = precio en CLP por unidad base (por gramo, por ml o por unidad)
// Fuente: promedio supermercados chilenos (Jumbo, Líder, Unimarc, Santa Isabel)
const MARKET_PRICES_CLP = {
    /* ── CARNES (CLP/g) ── */
    pollo:3.2, pollo_pechuga:4.2, pollo_muslo:3.5, pavo:5.5, pechuga_pavo:6.0,
    muslo_pavo:5.0, carne_vacuno:8.5, carne_molida:6.0, filete_vacuno:18.0,
    lomo_liso:12.0, lomo_vetado:15.0, asado_tira:8.0, costilla_cerdo:5.5,
    carne_cerdo:6.5, pulpa_cerdo:7.0, cordero:11.0, pierna_cordero:10.5,
    longaniza:5.5, vienesa:5.0, jamón:7.5, tocino:6.0, salchichón:6.5,
    osobuco:6.5, plateada:9.0, churrasco:11.0, pato:11.0,
    abastero:9.5, aguja_vacuno:7.5, asado_paleta:9.5, asado_tapa:9.0,
    bistec_vacuno:12.0, cazuela_vacuno:8.5, cerdo_molido:6.5, chuleta_cerdo:7.0,
    chuleta_vacuno:9.5, cogote_vacuno:8.0, colita_cuadril:10.0, corazon_vacuno:5.5,
    entraña:14.0, higado_pollo:4.5, higado_vacuno:5.5, huachalomo:8.5,
    hueso_vacuno:2.5, mechada_vacuno:8.5, mollejas:9.0, nalga_vacuno:9.5,
    osobuco_cerdo:7.0, palanca:10.0, panceta:7.0, patitas_cerdo:4.0,
    pernil_cerdo:6.0, posta_negra:9.0, posta_rosada:9.5, punta_paleta:8.5,
    rabo_vacuno:5.5, riñon_vacuno:4.5, salchicha_vacuno:7.5, ternera:13.0,
    vacuno_estofado:8.0, cecinas:8.5, carne_conejo:10.0,
    /* ── PESCADOS Y MARISCOS (CLP/g) ── */
    salmon:13.0, trucha:10.0, congrio:10.0, reineta:6.0, lenguado:9.0,
    albacora:10.0, corvina:9.5, merluza:7.0, jurel_tarro:3.5, atun_tarro:6.5,
    camarones:14.0, jaiba:8.0, centolla:30.0, machas:10.0, ostiones:22.0,
    locos:25.0, pulpo:12.0, mariscos_surtidos:12.0, cochayuyo:4.0,
    anchoveta:3.5, bacalao_seco:14.0, calamares:8.0, cangrejo:18.0,
    cojinoba:8.0, erizo_mar:25.0, gambas:18.0, jurel_fresco:4.5, langostinos:14.0,
    lapas:9.0, lisa:4.5, mejillones:6.0, navajas:14.0, ostra:25.0,
    pejegallo:6.0, pejerrey:5.5, piure:7.0, robalo:9.0, salmon_ahumado:18.0,
    sardina_fresca:4.5, sardinas_aceite:6.0, sierra:7.0, tilapia:7.5,
    vieiras:20.0, choro:4.5, calamar_tubo:9.0, camarón_pelado:12.0, langosta:30.0,
    atun_agua:6.5, atun_aceite:7.0, salmon_congelado:12.0, macha_fresca:9.0,
    navajuela:10.0, cochayuyo_seco:9.0, filete_rebozado:8.0, calamar_anillos:10.0,
    albacora_lata:9.0, jibia:5.5, peces_caldo:2.5,
    /* ── LÁCTEOS (CLP/g o CLP/ml) ── */
    leche:0.95, leche_coco:3.5, leche_condensada:8.0, leche_evaporada:5.5,
    mantequilla:11.0, queso_fresco:9.0, queso_mantecoso:10.0, queso_parmesano:20.0,
    crema_leche:7.0, crema_acida:6.0, crema_queso:10.0, ricotta:7.5, yogurt:1.8,
    buttermilk:1.0, cheddar:16.0, crema_chantilly:5.5, gouda:14.0, kefir:2.5,
    leche_almendra:3.0, leche_avena:2.5, leche_descremada:0.75, leche_entera_larga:0.95,
    leche_polvo:20.0, leche_soya:2.0, mantequilla_sin_sal:11.0, mozzarella:14.0,
    queso_azul:20.0, queso_brie:22.0, queso_cabra:25.0, queso_chanco:12.0,
    queso_cottage:9.0, queso_crema_light:10.0, queso_de_campo:11.0, queso_edam:13.0,
    queso_gruyere:25.0, queso_laminado:11.0, queso_rallado:13.0, queso_tilsit:12.0,
    yogurt_griego:4.5, yogurt_light:3.5, yogurt_natural:3.5,
    /* ── VERDURAS (CLP/g) ── */
    tomate:1.8, cebolla:0.9, papa:1.0, zanahoria:0.9, lechuga:1.5, palta:4.0,
    brocoli:2.5, espinaca:1.8, champiñon:4.5, zapallo:0.9, zapallo_italiano:1.5,
    pepino:1.2, pimenton:2.5, pimenton_verde:2.0, ajo:4.5, apio:1.5,
    betarraga:1.2, choclo:1.8, col_bruselas:1.8, coliflor:1.5, berenjena:1.5,
    esparragos:5.0, poroto_verde:1.8, repollo:0.9, rucula:5.5, cebolla_morada:1.2,
    cebolla_verde:1.2, puerro:2.5, camote:2.2, arvejas:1.8, garbanzos:3.0,
    lentejas:2.5, lenteja_roja:3.0, porotos:2.2, poroto_negro:2.5, poroto_granado:2.8,
    quinoa:6.0, mote:2.0, alcachofa:3.5, callampas:6.0, maiz_choclo:1.8,
    acelga:1.0, acelga_blanca:1.0, alcachofas_conserva:9.0, arveja_seca:2.0,
    berros:1.8, bok_choy:1.5, brocoli_romanesco:3.0, brote_alfalfa:4.5,
    brote_soya:3.0, cardo:2.0, cebollino:3.5, chaucha:1.5, choclo_lata:4.0,
    col_rizada:2.5, colinabo:1.5, daikon:1.2, endivia:3.0, escarola:2.5,
    flor_calabaza:6.0, garbanzo_cocido:4.0, habas:1.8, hinojo:2.5,
    jengibre_fresco:4.5, kale:4.0, lechugas_mix:4.5, lenteja_verde:2.5,
    maiz_morado:3.5, nabo:1.0, pak_choi:1.8, palmito_lata:9.5, papa_camote_morado:2.0,
    papa_nativa:1.8, perejil_crespo:3.0, pimenton_amarillo:3.0, pimenton_morrón:3.5,
    porotos_alubia:2.5, porotos_canario:3.0, porotos_pinto:2.5, poroto_lata:4.5,
    rabano:1.2, repollo_morado:1.2, seta_portobello:4.5, seta_shiitake:12.0,
    soja_verde:3.5, tomate_cherry:4.0, tomate_deshidratado:14.0, tomate_lata:3.5,
    tomate_pera:2.5, verdolaga:2.5, yuca:1.8, champiñones_lata:6.0,
    garbanzos_lata:5.0, lentejas_lata:5.0, maiz_dulce_lata:4.0, esparragos_lata:10.0,
    cebada_perla:2.0, arvejas_lata:4.0, seta_ostra:9.0, puerro_baby:4.0,
    micro_vegetales:22.0, cogollo_lechuga:4.0, rúcula_baby:6.0,
    alcachofa_conserva2:8.0, chayote:1.5, remolacha_amarilla:3.0, brote_girasol:7.0,
    lenteja_beluga:4.0, jicama:3.0, edamame_congelado:4.5,
    /* ── FRUTAS (CLP/g) ── */
    manzana:2.2, naranja:1.8, platano:1.8, limon:2.2, pera:2.8, frutillas:4.0,
    uvas:3.5, piña:2.5, kiwi:4.0, sandia:0.9, melon:1.8, durazno:2.5,
    frambuesa:6.0, arandanos:7.0, membrillo:2.0, lucuma:5.0, datil:12.0,
    huesillo:3.0, guinda:5.0, pomelo:2.0,
    arándano_rojo:9.0, babaco:3.5, caqui:3.5, cerezas:7.0, ciruela:3.0,
    ciruela_seca:8.0, coco_fresco:4.0, damasco:3.0, feijoa:3.5, frambuesa_negra:5.5,
    fruta_confitada:7.0, granada:4.0, grosellas:8.0, guayaba:3.0, higo:5.0,
    kiwi_amarillo:5.0, lichee:6.0, lima:2.5, limon_pica:3.0, mango:3.5,
    maracuya:4.5, melon_calameño:2.2, mora:4.5, murta:9.0, nectarina:3.0,
    papaya:3.0, pera_packham:2.5, pera_williams:2.5, platano_verde:1.8,
    pomelo_rosado:2.5, tamarindo:6.0, tuna:2.0, uva_blanca:3.0, uva_moscatel:3.5,
    uva_negra:3.0, uva_pasa_rubia:6.0, zarzamora:4.5, manzana_fuji:2.5,
    manzana_granny:2.5, manzana_royal:3.0, durazno_conserva:5.5,
    frutilla_congelada:4.0, guinda_acida:5.5, limon_eureka:2.0, arandano_seco:14.0,
    coco_agua:1.5, jugo_naranja_lata:1.8, aceituna_negra:6.0, aceituna_verde:6.0,
    chirimoya:4.0,
    /* ── ABARROTES (CLP/g o CLP/ml) ── */
    arroz:1.5, arroz_integral:1.8, harina:0.9, harina_integral:1.2, azucar:1.1,
    azucar_flor:1.3, aceite:2.5, aceite_canola:2.5, aceite_oliva:6.5,
    aceites:2.5, sal:0.6, pimienta:22.0, vinagre:2.5, salsa_soya:5.0,
    salsa_tomate:3.5, pure_tomate:4.0, ketchup:4.5, mayonesa:4.5, mostaza:3.0,
    manjar:6.0, miel:9.0, mermelada:5.5, vainilla:15.0, levadura:12.0,
    polvo_hornear:8.0, bicarbonato:3.5, maicena:3.0, semola:2.5,
    caldo_cubo:14.0, fideos:1.8, fideos_espirales:1.8, fideos_tallarines:1.8,
    pasta_lasana:2.0, garbanzos:3.0, lentejas:2.5, porotos:2.2, quinoa:6.0,
    avena:1.5, nuez:12.0, pasas:6.0, coco_rallado:8.0, chocolate:12.0, cacao:12.0,
    pan_rallado:4.0, masa_hojaldre:6.0, tortilla_trigo:3.0, mote:2.0,
    arroz_integral:1.8, aceitunas:5.5, salsa_inglesa:6.0, curry_polvo:13.0,
    chancaca:5.0, bicarbonato:3.5, datil:12.0, almendra:14.0,
    aceite_girasol:2.2, aceite_maravilla:2.0, aceite_palta:9.0, aceite_sesamo:12.0,
    arroz_arborio:4.0, arroz_basmati:3.0, arroz_grano_largo:1.8, arroz_parboil:2.0,
    avena_fina:1.4, avena_gruesa:1.5, bulgur:2.5, chia:9.0, fideos_arroz:3.0,
    fideos_cabello:1.8, fideos_penne:1.8, fideos_rigatoni:1.8, fideos_spaghetti:1.8,
    fideos_farfalle:2.0, fideos_lasagna:2.0, linaza:5.0, milho:2.0, noodles_ramen:3.5,
    orzo:2.2, polenta:2.0, quinoa_negra:6.0, quinoa_roja:6.0, salvado_avena:3.5,
    salvado_trigo:3.0, sesamo:7.0, tapioca:3.5, trigo_sarraceno:5.0, miso:8.0,
    amaranto:6.0, espelta:4.0, harina_arroz:3.0, harina_garbanzo:3.5,
    harina_sin_gluten:6.0, harina_maiz_nixtamal:3.0, harina_almendra:18.0,
    lenteja_pardina:2.5, poroto_pinto:2.5, frijol_canario:3.0, chuño:5.0,
    porotos_negros_lata:5.0, porotos_blancos_lata:5.0, avena_instantanea:1.8,
    granola:4.5, muesli:4.0, cereal_corn_flakes:4.5, cereal_bran:5.0,
    cereal_arroz_inflado:5.5, tortilla_maiz:3.5, wonton_masa:6.0, pasta_lasana_verde:2.5,
    aceite_trufa:35.0, aliño_completo:9.0, chimichurri:10.0, harissa:12.0,
    hummus:7.0, mostaza_dijon:7.0, mostaza_americana:4.5, pesto_albahaca:14.0,
    salsa_barbacoa:6.0, salsa_cesar:9.0, salsa_cocktail_mar:6.0, salsa_ostras:8.0,
    salsa_picante:7.0, salsa_ranch:9.0, tahini:10.0, vinagre_arroz:4.0,
    vinagre_manzana:3.0, vinagre_vino_tinto:3.5, wasabi_pasta:14.0,
    tamarindo_pasta:9.0, mostaza_grano:6.0, alioli:9.0, salsa_soya_reducida:6.0,
    salsa_teriyaki:7.0, salsa_hoisin:8.0, crema_avellana:9.0, mermelada_frutilla:6.0,
    mermelada_naranja:6.0, mermelada_durazno:6.0, mermelada_berries:7.0,
    jarabe_arce:14.0, pure_tomate2:3.5, extracto_tomate:7.0, pure_palta:9.0,
    leche_condensada_sin:7.0, gelatina_sin_sabor:35.0, levadura_seca:18.0,
    bicarbonato_sodio:3.5, crema_tartaro:22.0, colorante_rojo:18.0, colorante_amarillo:18.0,
    esencia_vainilla:12.0, extracto_vainilla_puro:22.0, almendra_tostada:17.0,
    nuez_pecana:20.0, pistachos:22.0, macadamia:25.0, nuez_brasil:18.0, mani:4.5,
    mani_tostado:5.5, mantequilla_mani:9.0, mantequilla_almendra:17.0,
    pepita_zapallo:9.0, nuez_pino:28.0, almendras:14.0,
    azucar_morena:1.8, azucar_glass:1.8, panela:3.5, stevia:45.0, glucosa_liquida:6.0,
    cacao_polvo:12.0, chocolate_amargo:14.0, chocolate_blanco:12.0,
    chocolate_chips:12.0, chocolate_fondant:17.0, merengue_polvo:14.0,
    gelatina_sabor:9.0, pudin_mix:7.0, mezcla_torta:6.0, mezcla_muffin:6.5,
    fondant_pasta:9.0, mazapan:12.0, jengibre_cristalizado:14.0,
    fruta_confitada_mix:8.0, chantilly_polvo:7.0, cafe_soluble:22.0, cafe_molido:18.0,
    te_negro:18.0, te_verde:20.0, te_herbal:18.0, manzanilla:18.0,
    hierba_luisa:14.0, yerba_mate:9.0, galleta_maria:6.0, galleta_wafer:6.0,
    crackers:6.5, barra_cereal:7.0, chips_papas:9.0, popcorn:3.5, maicena_azul:3.0,
    arruruz:6.0, proteina_soya:5.0, proteina_whey:28.0, leche_malteada:8.0,
    extracto_malta:6.0, caldo_pescado_cubo:18.0, caldo_verdura_cubo:14.0,
    sopa_sobre:7.0, maizena_lista:3.5, salsa_soya_dulce:7.0, merken_seco:20.0,
    aji_cacho_cabra:18.0, pimienta_negra_molida:22.0, sal_gruesa:0.6, sal_ahumada:9.0,
    aceituna_negra:6.0, aceituna_verde:6.0, alfajor:700,
    pan_hamburguesa:200, hot_dog_pan:200,
    /* ── ESPECIAS (CLP/g) ── */
    aji_color:12.0, oregano:12.0, comino:14.0, canela:20.0, pimienta:22.0,
    laurel:16.0, merkén:20.0, jengibre:5.0, cilantro:2.5, albahaca:3.0,
    perejil:2.5, eneldo:20.0, romero:13.0, tomillo:13.0, menta:3.0,
    curry_polvo:14.0,
    anís_estrellado:22.0, azafran:220.0, cardamomo:28.0, cayena:20.0,
    clavo_especia:22.0, comino_semilla:14.0, coriandro_molido:14.0, curcuma:17.0,
    eneldo_seco:20.0, estragón:22.0, fenogreco:12.0, galangal:22.0,
    hinojo_semilla:14.0, laurel_seco:17.0, lemongrass:9.0, mejorana_seca:20.0,
    mostaza_semilla:9.0, nuez_moscada_molida:28.0, oregano_seco:12.0,
    paprika_ahumada:17.0, paprika_dulce:14.0, perejil_seco:17.0, pimienta_blanca:22.0,
    pimienta_roja:22.0, romero_seco:14.0, sumac:20.0, tomillo_seco:14.0,
    zaatar:17.0, ajo_en_polvo:14.0, cebolla_polvo:14.0, aji_seco:16.0,
    canela_rama:20.0, albahaca_seca:17.0, cilantro_seco:14.0, pimienta_mixta:22.0,
    flor_sal:17.0, sal_de_mar:2.5, curry_amarillo:14.0, curry_rojo:14.0, lemon_pepper:16.0,
    /* ── PANADERÍA (CLP/g o CLP/unidad) ── */
    pan_marraqueta:3.5, pan_integral:4.0, pan_molde:3.5, hallulla:3.0,
    pan_completo:4.0, marraqueta_integral:4.0, masa_hojaldre:6.5,
    baguette:4.0, brioche:6.0, ciabatta:4.5, croissant:6.0, factura:5.0,
    hallulla_integral:4.0, hot_dog_pan:200, marraqueta:3.0, pan_de_campo:3.5,
    pan_frances:4.0, pan_lactal:4.0, pan_miga:4.5, pan_negro:4.5, pan_pita:4.0,
    pan_sin_gluten:8.0, pretzel:6.0, sopaipilla_lista:4.5, tostadas_pan:6.0,
    masa_pizza_lista:4.5, pan_hamburguesa:200, pan_artesanal:6.0, pan_chapata:4.0,
    /* ── BEBESTIBLES (CLP/ml) ── */
    agua_mineral:0.6, jugo_naranja:1.2, cafe:18.0, te:17.0, cerveza:1.5,
    vino_tinto:5.5, vino_blanco:5.0, pisco:9.0, ron:8.0, vodka:8.0,
    aguardiente:7.0,
    agua_gasificada:0.5, agua_saborizada:1.0, agua_tonica:1.0, bebida_energetica:3.5,
    bebida_cola:0.8, bebida_naranja:0.8, bebida_zero:0.8, cafe_capuchino_inst:20.0,
    cafe_frio:3.0, cerveza_artesanal:3.0, cerveza_sin_alcohol:1.5, chicha_uva:2.5,
    chicha_manzana:2.0, cola_de_mono:6.0, espumante:6.0, gin:9.0,
    jugo_durazno:1.2, jugo_limon_listo:2.5, jugo_maracuya:1.5, jugo_manzana:1.2,
    jugo_pera:1.2, jugo_pina:1.2, jugo_tomate_listo:1.5, jugo_uva:1.8,
    kombucha:3.5, limonada_lista:1.8, pisco_sour_mix:5.0, refresco_limon:1.0,
    ron_añejo:10.0, sake:8.0, sidra:3.5, tequila:12.0, vino_rose:4.5,
    vino_espumante:7.0, whisky:14.0, zumo_frutas_mix:1.8, nescafe_cappuccino:2.5,
    bebida_isotonica:1.8, coco_agua:1.8,
};

app.post('/api/ingredients/update-prices', async (req, res) => {
    try {
        const client = await pool.connect();
        let updated = 0;
        try {
            await client.query('BEGIN');
            for (const [id, price] of Object.entries(MARKET_PRICES_CLP)) {
                const result = await client.query(
                    'UPDATE ingredients SET price_per_base = $1 WHERE id = $2',
                    [price, id]
                );
                if (result.rowCount > 0) updated++;
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
        // Devolver todos los ingredientes actualizados
        const { rows } = await pool.query('SELECT * FROM ingredients ORDER BY name');
        const db = {};
        rows.forEach(r => {
            db[r.id] = { name: r.name, baseUnit: r.base_unit, pricePerBase: parseFloat(r.price_per_base), conversion: r.conversion || {}, nutrition: r.nutrition || {}, category: r.category || 'otros' };
        });
        res.json({ success: true, updated, ingredients: db });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= PANTRY ================= */
app.get('/api/pantry', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT ingredient_id, quantity, expiry_date FROM pantry');
        const pantry = {};
        rows.forEach(r => { pantry[r.ingredient_id] = { quantity: parseFloat(r.quantity), expiry_date: r.expiry_date }; });
        res.json(pantry);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pantry', async (req, res) => {
    try {
        const { ingredientId, quantity, expiry_date } = req.body;
        await pool.query(
            `INSERT INTO pantry (ingredient_id, quantity, expiry_date) VALUES ($1,$2,$3)
             ON CONFLICT (ingredient_id) DO UPDATE SET quantity = pantry.quantity + $2, expiry_date = COALESCE($3, pantry.expiry_date)`,
            [ingredientId, quantity, expiry_date || null]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/pantry/:id', async (req, res) => {
    try {
        const { quantity, expiry_date } = req.body;
        await pool.query('UPDATE pantry SET quantity=$1, expiry_date=COALESCE($2, expiry_date) WHERE ingredient_id=$3', [quantity, expiry_date || null, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/pantry/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pantry WHERE ingredient_id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= RECIPES ================= */
app.get('/api/recipes', async (req, res) => {
    try {
        const recipesRes = await pool.query('SELECT * FROM recipes ORDER BY id');
        const ingsRes = await pool.query('SELECT * FROM recipe_ingredients');
        const recipes = recipesRes.rows.map(r => ({
            id: r.id, name: r.name, type: r.type, basePortions: r.base_portions,
            diets: r.diets || [], instructions: r.instructions,
            cookTime: r.cook_time_minutes, season: r.season,
            ingredients: ingsRes.rows.filter(ri => ri.recipe_id === r.id).map(ri => ({ id: ri.ingredient_id, qty: parseFloat(ri.qty), unit: ri.unit }))
        }));
        res.json(recipes);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recipes', async (req, res) => {
    const client = await pool.connect();
    try {
        const { name, type, basePortions, diets, instructions, ingredients, cookTime, season } = req.body;
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO recipes (name, type, base_portions, diets, instructions, cook_time_minutes, season) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [name, type, basePortions, diets, instructions, cookTime || 30, season || 'all']
        );
        const recipeId = result.rows[0].id;
        for (const ing of ingredients) {
            await client.query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, qty, unit) VALUES ($1,$2,$3,$4)`, [recipeId, ing.id, ing.qty, ing.unit]);
        }
        await client.query('COMMIT');
        res.json({ success: true, id: recipeId });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

/* ================= RATINGS ================= */
app.get('/api/ratings', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM recipe_ratings');
        const ratings = {};
        rows.forEach(r => { ratings[r.recipe_id] = { rating: r.rating, comment: r.comment, rated_at: r.rated_at }; });
        res.json(ratings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recipes/:id/rating', async (req, res) => {
    try {
        const { rating, comment } = req.body;
        await pool.query(
            `INSERT INTO recipe_ratings (recipe_id, rating, comment, rated_at) VALUES ($1,$2,$3,NOW())
             ON CONFLICT (recipe_id) DO UPDATE SET rating=$2, comment=$3, rated_at=NOW()`,
            [req.params.id, rating, comment || null]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= NOTES ================= */
app.get('/api/notes', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM recipe_notes');
        const notes = {};
        rows.forEach(r => { notes[r.recipe_id] = r.note; });
        res.json(notes);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recipes/:id/note', async (req, res) => {
    try {
        const { note } = req.body;
        if (!note || !note.trim()) {
            await pool.query('DELETE FROM recipe_notes WHERE recipe_id=$1', [req.params.id]);
        } else {
            await pool.query(
                `INSERT INTO recipe_notes (recipe_id, note, updated_at) VALUES ($1,$2,NOW())
                 ON CONFLICT (recipe_id) DO UPDATE SET note=$2, updated_at=NOW()`,
                [req.params.id, note.trim()]
            );
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= PHOTOS ================= */
app.get('/api/photos', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT recipe_id, uploaded_at FROM recipe_photos');
        const photos = {};
        rows.forEach(r => { photos[r.recipe_id] = true; });
        res.json(photos);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/recipes/:id/photo', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT photo_data FROM recipe_photos WHERE recipe_id=$1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'No hay foto' });
        res.json({ photo_data: rows[0].photo_data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recipes/:id/photo', async (req, res) => {
    try {
        const { photo_data } = req.body;
        await pool.query(
            `INSERT INTO recipe_photos (recipe_id, photo_data, uploaded_at) VALUES ($1,$2,NOW())
             ON CONFLICT (recipe_id) DO UPDATE SET photo_data=$2, uploaded_at=NOW()`,
            [req.params.id, photo_data]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/recipes/:id/photo', async (req, res) => {
    try {
        await pool.query('DELETE FROM recipe_photos WHERE recipe_id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= COOK HISTORY ================= */
app.get('/api/history', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM cook_history ORDER BY cooked_at DESC LIMIT 100');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/history', async (req, res) => {
    try {
        const { recipe_id, portions, cooked_at } = req.body;
        await pool.query('INSERT INTO cook_history (recipe_id, portions, cooked_at) VALUES ($1,$2,$3)', [recipe_id, portions || 4, cooked_at || new Date().toISOString().split('T')[0]]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/history', async (req, res) => {
    try {
        await pool.query('DELETE FROM cook_history');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= FAMILY MEMBERS ================= */
app.get('/api/family', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM family_members ORDER BY id');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/family', async (req, res) => {
    try {
        const { name, allergies, dislikes, diets } = req.body;
        const { rows } = await pool.query('INSERT INTO family_members (name, allergies, dislikes, diets) VALUES ($1,$2,$3,$4) RETURNING *', [name, allergies || [], dislikes || [], diets || []]);
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/family/:id', async (req, res) => {
    try {
        const { name, allergies, dislikes, diets, is_active } = req.body;
        await pool.query('UPDATE family_members SET name=$1, allergies=$2, dislikes=$3, diets=$4, is_active=$5 WHERE id=$6', [name, allergies || [], dislikes || [], diets || [], is_active !== undefined ? is_active : true, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/family/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM family_members WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= SAVED MENUS ================= */
app.get('/api/menus/saved', async (req, res) => {
    try {
        const menusRes = await pool.query('SELECT * FROM saved_menus ORDER BY created_at DESC LIMIT 20');
        const daysRes = await pool.query('SELECT * FROM saved_menu_days');
        const menus = menusRes.rows.map(m => ({
            ...m,
            days: daysRes.rows.filter(d => d.menu_id === m.id)
        }));
        res.json(menus);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/menus/saved', async (req, res) => {
    const client = await pool.connect();
    try {
        const { label, week_start, persons, budget, days } = req.body;
        await client.query('BEGIN');
        const result = await client.query('INSERT INTO saved_menus (label, week_start, persons, budget) VALUES ($1,$2,$3,$4) RETURNING id', [label, week_start, persons || 4, budget || 0]);
        const menuId = result.rows[0].id;
        for (const day of days) {
            await client.query('INSERT INTO saved_menu_days (menu_id, day_name, recipe_id, day_type) VALUES ($1,$2,$3,$4)', [menuId, day.day_name, day.recipe_id, day.day_type || 'normal']);
        }
        await client.query('COMMIT');
        res.json({ success: true, id: menuId });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

app.delete('/api/menus/saved/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM saved_menus WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= BUDGET ================= */
app.get('/api/budget', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM weekly_budget ORDER BY week_start DESC LIMIT 10');
        const budgets = {};
        rows.forEach(r => { budgets[r.week_start] = r.amount; });
        res.json(budgets);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/budget', async (req, res) => {
    try {
        const { week_start, amount } = req.body;
        await pool.query('INSERT INTO weekly_budget (week_start, amount) VALUES ($1,$2) ON CONFLICT (week_start) DO UPDATE SET amount=$2', [week_start, amount]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= REMINDER ================= */
app.get('/api/reminder', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM daily_reminder WHERE id=1');
        res.json(rows[0] || { reminder_time: null, is_active: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reminder', async (req, res) => {
    try {
        const { reminder_time, is_active } = req.body;
        await pool.query('INSERT INTO daily_reminder (id, reminder_time, is_active) VALUES (1,$1,$2) ON CONFLICT (id) DO UPDATE SET reminder_time=$1, is_active=$2', [reminder_time, is_active]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= SHARED VIEWS (Link Familiar) ================= */
app.post('/api/share', async (req, res) => {
    try {
        const id = crypto.randomBytes(4).toString('hex'); // 8 chars hex
        await pool.query('INSERT INTO shared_views (id, data) VALUES ($1, $2)', [id, req.body]);
        // Clean old shares (>7 days)
        await pool.query("DELETE FROM shared_views WHERE created_at < NOW() - INTERVAL '7 days'");
        res.json({ id, url: `/compartir/${id}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/share/:id', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT data FROM shared_views WHERE id = $1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'No encontrado o expirado' });
        res.json(rows[0].data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/compartir/:id', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Menú Familiar — CocinaMágica</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
<style>
  body { background: #f0fdf4; font-family: 'Inter', sans-serif; }
  .hero { background: linear-gradient(135deg, #16a34a, #059669); color: white; padding: 2rem; border-radius: 0 0 1.5rem 1.5rem; margin-bottom: 1.5rem; }
  .day-card { background: white; border-radius: 1rem; padding: 1rem; margin-bottom: .75rem; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
  .shopping-item { padding: .4rem 0; border-bottom: 1px solid #f0f0f0; }
  .tag { background: #dcfce7; color: #16a34a; border-radius: 999px; padding: .15rem .6rem; font-size: .75rem; font-weight: 600; }
</style>
</head>
<body>
<div class="hero text-center">
  <div style="font-size:2.5rem">🍳</div>
  <h2 class="fw-bold mb-1">Menú Familiar</h2>
  <p class="opacity-75 mb-0" id="heroSub">CocinaMágica</p>
</div>
<div class="container" style="max-width:600px">
  <div id="content"><div class="text-center text-muted py-5"><div class="spinner-border"></div></div></div>
</div>
<script>
const id = location.pathname.split('/').pop();
fetch('/api/share/' + id).then(r => r.json()).then(data => {
  if (data.error) { document.getElementById('content').innerHTML = '<div class="alert alert-danger">Este enlace expiró o no existe.</div>'; return; }
  const el = document.getElementById('content');
  document.getElementById('heroSub').textContent = 'Compartido el ' + new Date(data.createdAt).toLocaleDateString('es-CL');
  let html = '';
  if (data.menu && data.menu.length > 0) {
    html += '<h5 class="fw-bold mb-3"><i class="fa-solid fa-calendar-week text-success me-2"></i>Menú de la Semana</h5>';
    data.menu.forEach(item => {
      html += '<div class="day-card"><div class="d-flex justify-content-between align-items-center"><div><span class="tag me-2">' + item.day + '</span><strong>' + item.recipe + '</strong></div><span class="text-muted small">' + item.cost + '</span></div></div>';
    });
    html += '<hr class="my-4">';
  }
  if (data.shopping && data.shopping.length > 0) {
    html += '<h5 class="fw-bold mb-3"><i class="fa-solid fa-cart-shopping text-primary me-2"></i>Lista de Compras</h5>';
    data.shopping.forEach(item => {
      html += '<div class="shopping-item d-flex justify-content-between"><span>☐ ' + item.name + '</span><span class="text-muted small">' + item.qty + ' ' + item.unit + '</span></div>';
    });
  }
  el.innerHTML = html || '<div class="text-muted text-center py-4">Sin contenido compartido.</div>';
}).catch(() => { document.getElementById('content').innerHTML = '<div class="alert alert-danger">Error al cargar.</div>'; });
</script>
</body>
</html>`);
});

/* ================= ARRANQUE ================= */
const PORT = process.env.PORT || 3001;
initDB()
    .then(() => app.listen(PORT, () => console.log(`CocinaMágica corriendo en http://localhost:${PORT}`)))
    .catch(err => { console.error('Error al inicializar la base de datos:', err.message); process.exit(1); });
