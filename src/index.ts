import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import router from "./routes";
dotenv.config();

const app = express();

app.use(cors({
  origin: [
    'http://localhost:8000',              // Your frontend
    'https://www.youtube.com',            // YouTube domain where extension runs
    'chrome-extension://*',               // Chrome extensions
    'https://*.youtube.com'               // All YouTube subdomains
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Parse JSON request bodies
app.use(express.json());

// Mount API routes
app.use("/api", router);

// Add a simple health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
