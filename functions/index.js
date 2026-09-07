const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dns = require("dns");
const http = require("http");
const https = require("https");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;
dns.setServers(["8.8.8.8", "1.1.1.1"]);
mongoose.connect(uri);
const connection = mongoose.connection;

if (require.main === module) {
  connection.once("open", () => {
    console.info("MongoDB database connection established successfully");
    app.listen(port, () => {
      console.info(`Server is running on port: ${port}`);
    });
  });
}

const authRouter = require("./routes/auth");
const unitsRouter = require("./routes/units");
const financeRouter = require("./routes/finance");
const chatRouter = require("./routes/chat");
const {requireAuth} = require("./middleware/auth");

app.use("/auth", authRouter);
app.use("/units", unitsRouter);
app.use("/finance", financeRouter);
app.use("/chat", chatRouter);

function attachGatewayUserId(req, res, next) {
  req.headers["x-auth-user-id"] = req.user._id.toString();
  next();
}

function pythonProxy(req, res) {
  const target = new URL(process.env.PYTHON_API_URL || "http://localhost:8000");
  const headers = {...req.headers, host: target.host};
  const requestLib = target.protocol === "https:" ? https : http;
  let body = null;
  if (req.body !== undefined && Object.keys(req.body).length > 0) {
    body = JSON.stringify(req.body);
    headers["content-length"] = Buffer.byteLength(body);
  }
  const proxyReq = requestLib.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: req.originalUrl,
        method: req.method,
        headers: headers,
      },
      (proxyRes) => {
        console.log("[proxy]", req.method, req.originalUrl, "-> upstream", proxyRes.statusCode);
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      },
  );
  proxyReq.on("error", (err) => {
    console.error("[proxy] error:", err.message);
    if (!res.headersSent) {
      res.status(502).json({detail: "Upstream server error"});
    } else {
      res.end();
    }
  });
  if (body !== null) {
    proxyReq.end(body);
  } else {
    req.pipe(proxyReq);
  }
}

app.use("/chat/text", requireAuth, attachGatewayUserId, pythonProxy);
app.use("/chat/voice", requireAuth, attachGatewayUserId, pythonProxy);
app.use("/rag/context", requireAuth, attachGatewayUserId, pythonProxy);
app.use("/rag/packs", requireAuth, attachGatewayUserId, pythonProxy);
app.use("/admin", pythonProxy);

app.get("/health", (req, res) => {
  res.status(200).json({status: "ok"});
});

app.use((err, req, res, next) => {
  console.error("[error]", req.method, req.originalUrl, err.stack);
  if (res.headersSent) return res.end();
  if (err.type === "entity.parse.failed") {
    return res.status(422).json({
      detail: [{loc: ["body"], msg: "JSON decode error", type: "json_invalid"}],
    });
  }
  res.status(500).json({detail: "Internal server error"});
});

exports.app = functions.https.onRequest(app);
