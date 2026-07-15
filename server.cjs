const http = require("http");
const fs = require("fs");
const path = require("path");
const { 
  S3Client, 
  PutObjectCommand, 
  GetObjectCommand, 
  ListObjectsV2Command, 
  DeleteObjectCommand 
} = require("@aws-sdk/client-s3");

const PORT = 3001;
const BUCKET_NAME = "cg-process-flow";

// Initialize S3 Client (will resolve credentials from credentials file locally, or IAM role on EC2)
const s3 = new S3Client({ region: "eu-west-2" });

// Utility to parse request body as JSON
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

// Helper to send JSON responses
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  try {
    // ====================================================
    // API ROUTES
    // ====================================================

    // ----------------------------------------------------
    // GET /diagram/api/users (List all usernames with data folders in S3)
    // ----------------------------------------------------
    if (pathname === "/diagram/api/users" && req.method === "GET") {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: "data/",
        Delimiter: "/"
      });
      const data = await s3.send(command);
      const dirs = (data.CommonPrefixes || []).map((p) => {
        const parts = p.Prefix.split("/");
        return parts[parts.length - 2]; // Extract the directory name (username)
      });
      return sendJson(res, 200, { users: dirs });
    }

    // ----------------------------------------------------
    // GET /diagram/api/flows (List diagrams for user/admin)
    // ----------------------------------------------------
    if (pathname === "/diagram/api/flows" && req.method === "GET") {
      const username = parsedUrl.searchParams.get("username");
      const role = parsedUrl.searchParams.get("role");
      const targetUser = parsedUrl.searchParams.get("targetUser") || username;

      if (!username) {
        return sendJson(res, 400, { error: "Missing username parameter." });
      }

      let prefix = `data/${targetUser}/`;
      if (role === "appadmin" && targetUser === "all") {
        prefix = "data/";
      }

      const listCmd = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix
      });
      const listData = await s3.send(listCmd);
      const files = (listData.Contents || []).filter((item) => item.Key.endsWith(".json"));

      // Fetch and parse all matching JSON files in parallel
      const diagrams = await Promise.all(
        files.map(async (file) => {
          try {
            const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: file.Key });
            const s3Res = await s3.send(getCmd);
            const body = await s3Res.Body.transformToString();
            const fileData = JSON.parse(body);

            // Extract username from S3 Key: "data/<username>/<id>.json"
            const parts = file.Key.split("/");
            const uName = parts[1];

            return {
              id: fileData.id,
              name: fileData.name,
              type: fileData.type,
              updatedAt: fileData.updatedAt,
              username: uName
            };
          } catch (e) {
            return null;
          }
        })
      );

      // Filter out nulls and sort by updatedAt desc
      const sortedDiagrams = diagrams
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      return sendJson(res, 200, { diagrams: sortedDiagrams });
    }

    // ----------------------------------------------------
    // GET /diagram/api/flows/get (Retrieve specific diagram payload)
    // ----------------------------------------------------
    if (pathname === "/diagram/api/flows/get" && req.method === "GET") {
      const username = parsedUrl.searchParams.get("username");
      const id = parsedUrl.searchParams.get("id");

      if (!username || !id) {
        return sendJson(res, 400, { error: "Missing username or id parameter." });
      }

      const key = `data/${username}/${id}.json`;
      try {
        const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
        const s3Res = await s3.send(getCmd);
        const fileContent = await s3Res.Body.transformToString();
        return sendJson(res, 200, JSON.parse(fileContent));
      } catch (err) {
        return sendJson(res, 404, { error: "Diagram not found." });
      }
    }

    // ----------------------------------------------------
    // POST /diagram/api/flows (Save or update a diagram)
    // ----------------------------------------------------
    if (pathname === "/diagram/api/flows" && req.method === "POST") {
      const body = await parseJsonBody(req);
      const { username, id, name, type, payload } = body;

      if (!username || !id || !name || !type || !payload) {
        return sendJson(res, 400, { error: "Missing required fields in payload." });
      }

      const key = `data/${username}/${id}.json`;
      const diagramData = {
        id,
        name,
        type,
        payload,
        updatedAt: new Date().toISOString(),
      };

      const putCmd = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: JSON.stringify(diagramData, null, 2),
        ContentType: "application/json"
      });

      await s3.send(putCmd);
      return sendJson(res, 200, { success: true, diagram: { id, name, type, updatedAt: diagramData.updatedAt, username } });
    }

    // ----------------------------------------------------
    // DELETE /diagram/api/flows (Delete a diagram)
    // ----------------------------------------------------
    if (pathname === "/diagram/api/flows" && req.method === "DELETE") {
      const username = parsedUrl.searchParams.get("username");
      const id = parsedUrl.searchParams.get("id");

      if (!username || !id) {
        return sendJson(res, 400, { error: "Missing username or id parameter." });
      }

      const key = `data/${username}/${id}.json`;
      try {
        const deleteCmd = new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key });
        await s3.send(deleteCmd);
        return sendJson(res, 200, { success: true });
      } catch (err) {
        return sendJson(res, 404, { error: "Diagram not found." });
      }
    }

    // ====================================================
    // STATIC ASSETS SERVING (FOR HOSTING ON EC2)
    // ====================================================
    if (!pathname.startsWith("/diagram/api/")) {
      let relPath = pathname.replace(/^\/diagram\/?/, "");
      
      // Serve index.html for empty/home path or client routes
      if (!relPath || relPath === "" || relPath.indexOf(".") === -1) {
        relPath = "index.html";
      }

      const filePath = path.join(__dirname, "dist", relPath);
      
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          ".html": "text/html",
          ".css": "text/css",
          ".js": "application/javascript",
          ".json": "application/json",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon"
        };
        const contentType = mimeTypes[ext] || "application/octet-stream";
        const headers = { "Content-Type": contentType };
        if (relPath === "index.html") {
          headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
          headers["Pragma"] = "no-cache";
          headers["Expires"] = "0";
        }
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
      } else {
        // Fallback to index.html for React SPA Router support
        const indexHtml = path.join(__dirname, "dist", "index.html");
        if (fs.existsSync(indexHtml)) {
          const headers = { "Content-Type": "text/html" };
          headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
          headers["Pragma"] = "no-cache";
          headers["Expires"] = "0";
          res.writeHead(200, headers);
          fs.createReadStream(indexHtml).pipe(res);
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
      }
      return;
    }

    // Default 404 for missing API route
    return sendJson(res, 404, { error: "API Route not found" });

  } catch (err) {
    console.error("Server error:", err);
    return sendJson(res, 500, { error: err.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`[API Server] Running on http://localhost:${PORT}`);
});
