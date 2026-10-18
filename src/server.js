require("dotenv").config();

const categoryRoutes = require("./routes/categoryRoutes");
const productRoutes = require("./routes/productRoutes");
const adminRoutes = require("./routes/adminRoutes");
const managementRoutes = require("./routes/managementRoutes");
const managementProductRoutes = require("./routes/managementProductRoutes");
const orderRoutes = require("./routes/orderRoutes");
const financialRoutes = require("./routes/financialRoutes");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const app = express();
app.set('trust proxy', 1);
const authRoutes = require("./routes/authRoutes");
const port = Number(process.env.PORT || 4000);

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Configure your .env file first.");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
ssl: { rejectUnauthorized: false }});

app.disable("x-powered-by");

app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error("Origin is not allowed by CORS."));
    }
}));

app.use(express.json({ limit: "1mb" }));

app.use("/api", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false
}));

app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/management", managementRoutes);
app.use("/api/management/products", managementProductRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/finance", financialRoutes);
app.use("/api/payments", require("./routes/paymentRoutes"));

app.get("/", (req, res) => {
    res.json({
        name: "Mbare Musika API",
        message: "Welcome to the Mbare Musika marketplace API.",
        version: "1.0.0",
        health: "/api/health"
    });
});

app.get("/api/health", async (req, res, next) => {
    try {
        const result = await pool.query("SELECT NOW() AS database_time");

        res.json({
            success: true,
            service: "Mbare Musika API",
            database: "connected",
            databaseTime: result.rows[0].database_time
        });
    } catch (error) {
        next(error);
    }
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "API endpoint not found."
    });
});

app.use((error, req, res, next) => {
    console.error(error.message);

    if (res.headersSent) {
        return next(error);
    }

    res.status(error.status || 500).json({
        success: false,
        message: process.env.NODE_ENV === "production"
            ? "An unexpected server error occurred."
            : error.message
    });
});

async function start() {
    const fs = require("fs");
    const path = require("path");

    const schemaPath = path.join(__dirname, "..", "database", "schema.sql");
    const schemaSql = await fs.promises.readFile(schemaPath, "utf8");

    await pool.query(schemaSql);
    console.log("Database schema initialized automatically.");

    await pool.query("SELECT 1");

    const server = app.listen(port, "0.0.0.0", () => {
        console.log(`Mbare Musika API running on port ${port}`);
        console.log(`Health endpoint: http://localhost:${port}/api/health`);
    });

    async function shutdown() {
        server.close(async () => {
            await pool.end();
            process.exit(0);
        });
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

start().catch((error) => {
    console.error("Failed to start Mbare Musika API:", error.message);
    process.exit(1);
});


