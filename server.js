const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "AguaViva2026@Argentina";
const MP_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || "";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const PIZZA_PRICE = 50;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

ensureDataFile();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);

    if (req.method === "POST" && url.pathname === "/api/orders") {
      return createOrder(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/admin/orders") {
      requireAdmin(req);
      return sendJson(res, readOrders());
    }

    if (url.pathname.startsWith("/api/admin/orders/")) {
      requireAdmin(req);
      const id = decodeURIComponent(url.pathname.replace("/api/admin/orders/", ""));

      if (req.method === "PATCH") {
        return updateOrder(req, res, id);
      }

      if (req.method === "DELETE") {
        const orders = readOrders().filter((order) => order.id !== id);
        writeOrders(orders);
        return sendJson(res, { ok: true });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/webhooks/mercado-pago") {
      return handleMercadoPagoWebhook(req, res, url);
    }

    if (req.method === "GET" && url.pathname === "/api/orders/status") {
      const orderNumber = url.searchParams.get("order");
      const order = readOrders().find((item) => item.orderNumber === orderNumber);
      return sendJson(res, order ? publicOrder(order) : null);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, { error: "Rota não encontrada." }, 404);
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, { error: error.message || "Erro interno." }, status);
  }
});

server.listen(PORT, () => {
  console.log(`Site disponível em http://localhost:${PORT}`);
});

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = valueParts.join("=").trim();
    }
  }
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, "[]\n", "utf8");
  }
}

function readOrders() {
  return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
}

function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, `${JSON.stringify(orders, null, 2)}\n`, "utf8");
}

async function createOrder(req, res) {
  const body = await readJson(req);
  const mussarelaQty = Math.max(0, Number.parseInt(body.mussarelaQty, 10) || 0);
  const calabresaQty = Math.max(0, Number.parseInt(body.calabresaQty, 10) || 0);
  const total = (mussarelaQty + calabresaQty) * PIZZA_PRICE;

  if (!body.guardianName || !body.phone) {
    return sendJson(res, { error: "Informe nome do responsável e telefone." }, 400);
  }

  if (mussarelaQty + calabresaQty === 0) {
    return sendJson(res, { error: "Informe a quantidade de pelo menos uma pizza." }, 400);
  }

  if (!MP_ACCESS_TOKEN) {
    return sendJson(res, { error: "Configure MERCADO_PAGO_ACCESS_TOKEN no arquivo .env para gerar o link de pagamento." }, 500);
  }

  const orders = readOrders();
  const order = {
    id: generateId(),
    orderNumber: generateOrderNumber(orders.length + 1),
    guardianName: String(body.guardianName).trim(),
    studentName: String(body.studentName || "").trim(),
    className: String(body.className || "").trim(),
    phone: String(body.phone).trim(),
    email: String(body.email || "").trim(),
    mussarelaQty,
    calabresaQty,
    total,
    paymentMethod: "",
    mercadoPagoPaymentId: "",
    mercadoPagoPreferenceId: "",
    paymentLink: "",
    status: "Aguardando pagamento",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const preference = await createMercadoPagoPreference(order);
  order.mercadoPagoPreferenceId = preference.id || "";
  order.paymentLink = preference.init_point || preference.sandbox_init_point || "";

  orders.push(order);
  writeOrders(orders);
  sendJson(res, publicOrder(order), 201);
}

async function updateOrder(req, res, id) {
  const body = await readJson(req);
  const orders = readOrders();
  const order = orders.find((item) => item.id === id);

  if (!order) {
    return sendJson(res, { error: "Pedido não encontrado." }, 404);
  }

  if (typeof body.status === "string") {
    order.status = body.status;
  }

  if (typeof body.paymentMethod === "string") {
    order.paymentMethod = body.paymentMethod;
  }

  if (order.status === "Pago" && !order.paymentMethod) {
    order.paymentMethod = "Dinheiro";
  }

  if (order.status !== "Pago" && body.status) {
    order.paymentMethod = "";
  }

  order.updatedAt = new Date().toISOString();
  writeOrders(orders);
  sendJson(res, order);
}

async function handleMercadoPagoWebhook(req, res, url) {
  const body = await readJson(req).catch(() => ({}));
  const topic = body.type || body.topic || url.searchParams.get("topic") || url.searchParams.get("type");
  const paymentId = body?.data?.id || body.id || url.searchParams.get("id") || url.searchParams.get("data.id");

  sendJson(res, { ok: true });

  if (topic !== "payment" || !paymentId || !MP_ACCESS_TOKEN) {
    return;
  }

  try {
    const payment = await mercadoPagoGet(`/v1/payments/${paymentId}`);
    if (payment.status !== "approved") return;

    const orders = readOrders();
    const order = orders.find((item) => item.orderNumber === payment.external_reference);
    if (!order) return;

    order.status = "Pago";
    order.paymentMethod = mapPaymentMethod(payment);
    order.mercadoPagoPaymentId = String(payment.id || paymentId);
    order.updatedAt = new Date().toISOString();
    writeOrders(orders);
  } catch (error) {
    console.error("Erro ao processar webhook Mercado Pago:", error.message);
  }
}

async function createMercadoPagoPreference(order) {
  const items = [];

  if (order.mussarelaQty > 0) {
    items.push({
      title: "Pizza Mussarela",
      quantity: order.mussarelaQty,
      unit_price: PIZZA_PRICE,
      currency_id: "BRL",
    });
  }

  if (order.calabresaQty > 0) {
    items.push({
      title: "Pizza Calabresa",
      quantity: order.calabresaQty,
      unit_price: PIZZA_PRICE,
      currency_id: "BRL",
    });
  }

  return mercadoPagoPost("/checkout/preferences", {
    items,
    payer: {
      name: order.guardianName,
      email: order.email || undefined,
    },
    external_reference: order.orderNumber,
    notification_url: `${BASE_URL}/api/webhooks/mercado-pago`,
    back_urls: {
      success: `${BASE_URL}/?order=${encodeURIComponent(order.orderNumber)}&payment=success`,
      pending: `${BASE_URL}/?order=${encodeURIComponent(order.orderNumber)}&payment=pending`,
      failure: `${BASE_URL}/?order=${encodeURIComponent(order.orderNumber)}&payment=failure`,
    },
    statement_descriptor: "PIZZA AGUA VIVA",
  });
}

async function mercadoPagoPost(endpoint, payload) {
  const response = await fetch(`https://api.mercadopago.com${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return mercadoPagoResponse(response);
}

async function mercadoPagoGet(endpoint) {
  const response = await fetch(`https://api.mercadopago.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
    },
  });

  return mercadoPagoResponse(response);
}

async function mercadoPagoResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.message || data.error || "Erro ao consultar o Mercado Pago.");
  }

  return data;
}

function mapPaymentMethod(payment) {
  const type = payment.payment_type_id;
  const method = payment.payment_method_id;

  if (type === "credit_card") return "Cartão de crédito";
  if (type === "debit_card") return "Cartão de débito";
  if (type === "bank_transfer" || method === "pix") return "Pix/Mercado Pago";
  if (type === "account_money") return "Saldo Mercado Pago";
  if (type === "ticket") return "Boleto";
  return method ? `Mercado Pago - ${method}` : "Mercado Pago";
}

function publicOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    guardianName: order.guardianName,
    studentName: order.studentName,
    className: order.className,
    phone: order.phone,
    email: order.email,
    mussarelaQty: order.mussarelaQty,
    calabresaQty: order.calabresaQty,
    total: order.total,
    paymentLink: order.paymentLink,
    status: order.status,
  };
}

function generateOrderNumber(sequence) {
  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  return `#PS-${stamp}-${String(sequence).padStart(4, "0")}`;
}

function generateId() {
  return `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requireAdmin(req) {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    const error = new Error("Senha administrativa incorreta.");
    error.statusCode = 401;
    throw error;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Corpo da requisição muito grande."));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, data, statusCode = 200) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Arquivo não encontrado.");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}
