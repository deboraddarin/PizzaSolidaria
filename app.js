const PIZZA_PRICE = 50;

const form = document.querySelector("#orderForm");
const receipt = document.querySelector("#receipt");
const receiptTemplate = document.querySelector("#receiptTemplate");
const orderTotal = document.querySelector("#orderTotal");
const mussarelaQty = document.querySelector("#mussarelaQty");
const calabresaQty = document.querySelector("#calabresaQty");
const phoneInput = document.querySelector("#phone");
const adminAccess = document.querySelector("#adminAccess");
const backToOrder = document.querySelector("#backToOrder");
const ordersTable = document.querySelector("#ordersTable");
const ordersCount = document.querySelector("#ordersCount");
const paidCount = document.querySelector("#paidCount");
const exportCsvButton = document.querySelector("#exportCsv");

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

let adminPassword = "";
let adminOrders = [];

function getQuantity(input) {
  return Math.max(0, Number.parseInt(input.value, 10) || 0);
}

function formatPhone(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);

  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function updateTotal() {
  const total = (getQuantity(mussarelaQty) + getQuantity(calabresaQty)) * PIZZA_PRICE;
  orderTotal.textContent = money.format(total);
  return total;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(adminPassword ? { "x-admin-password": adminPassword } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || "Não foi possível concluir a operação.");
  }

  return data;
}

function orderMessage(order) {
  return [
    "🍕 PEDIDO RECEBIDO!",
    "Obrigado pela participação!",
    `Nome do responsável: ${order.guardianName}`,
    `Seu número de pedido é: ${order.orderNumber}`,
    `Status: ${order.statusText || "aguardando confirmação de pagamento"}`,
    "Para efetivar o pedido, finalize o pagamento no link abaixo:",
    order.paymentLink || "",
    "Seu pedido só será efetivado após o pagamento.",
  ].join("\n");
}

function emailComposeUrl(order, subject, message) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: order.email,
    su: subject,
    body: message,
  });

  return `https://mail.google.com/mail/?${params.toString()}`;
}

function showReceipt(order) {
  const node = receiptTemplate.content.cloneNode(true);
  node.querySelector("[data-field='guardian']").textContent = order.guardianName;
  node.querySelector("[data-field='orderNumber']").textContent = order.orderNumber;
  const link = node.querySelector("[data-field='paymentLink']");
  link.href = order.paymentLink || "#";
  link.textContent = order.paymentLink ? "Mercado Pago" : "Link indisponível";
  link.toggleAttribute("aria-disabled", !order.paymentLink);

  receipt.replaceChildren(node);
  receipt.classList.remove("hidden");

  if (order.email) {
    const actions = document.createElement("div");
    const emailLink = document.createElement("a");
    const copyButton = document.createElement("button");
    const message = orderMessage(order);

    actions.className = "receipt-actions";
    emailLink.className = "pay-link";
    emailLink.href = emailComposeUrl(order, `Pedido ${order.orderNumber}`, message);
    emailLink.target = "_blank";
    emailLink.rel = "noreferrer";
    emailLink.textContent = "Abrir email para envio";

    copyButton.className = "secondary";
    copyButton.type = "button";
    copyButton.textContent = "Copiar mensagem";
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(message);
      copyButton.textContent = "Mensagem copiada";
    });

    actions.append(emailLink, copyButton);
    receipt.querySelector(".message-box").appendChild(actions);
  }
}

function renderOrders(orders) {
  adminOrders = orders;
  ordersTable.innerHTML = "";
  ordersCount.textContent = `${orders.length} ${orders.length === 1 ? "pedido" : "pedidos"}`;
  paidCount.textContent = `${orders.filter((order) => order.status === "Pago").length} confirmados`;

  if (!orders.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="empty" colspan="10">Nenhum pedido registrado ainda.</td>`;
    ordersTable.appendChild(row);
    return;
  }

  orders.forEach((order) => {
    const row = document.createElement("tr");
    const paid = order.status === "Pago";
    row.innerHTML = `
      <td>${escapeHtml(order.guardianName)}</td>
      <td>${escapeHtml(order.orderNumber)}</td>
      <td>${escapeHtml(order.studentName || "-")}</td>
      <td>${escapeHtml(order.className || "-")}</td>
      <td>${order.mussarelaQty}</td>
      <td>${order.calabresaQty}</td>
      <td>${money.format(order.total)}</td>
      <td>
        <select class="payment-method" data-payment-method="${order.id}" aria-label="Forma de pagamento do pedido ${escapeHtml(order.orderNumber)}">
          ${paid ? "" : '<option value="" selected>Não informado</option>'}
          <option value="Pix/Mercado Pago" ${order.paymentMethod === "Pix/Mercado Pago" ? "selected" : ""}>Pix/Mercado Pago</option>
          <option value="Cartão de crédito" ${order.paymentMethod === "Cartão de crédito" ? "selected" : ""}>Cartão de crédito</option>
          <option value="Cartão de débito" ${order.paymentMethod === "Cartão de débito" ? "selected" : ""}>Cartão de débito</option>
          <option value="Dinheiro" ${order.paymentMethod === "Dinheiro" ? "selected" : ""}>Dinheiro</option>
          <option value="Outro" ${order.paymentMethod === "Outro" ? "selected" : ""}>Outro</option>
        </select>
      </td>
      <td><span class="status ${paid ? "paid" : "pending"}">${paid ? "Pago" : "Aguardando pagamento"}</span></td>
      <td>
        <div class="row-actions">
          <button class="secondary" type="button" data-confirm="${order.id}">${paid ? "Desmarcar" : "Confirmar dinheiro"}</button>
          <button class="danger" type="button" data-delete="${order.id}">Excluir</button>
        </div>
      </td>
    `;
    ordersTable.appendChild(row);
  });
}

async function loadAdminOrders() {
  const orders = await api("/api/admin/orders");
  renderOrders(orders);
}

function showView(viewId) {
  document.querySelectorAll(".tab, .view").forEach((element) => element.classList.remove("active"));
  document.querySelector(`#${viewId}`).classList.add("active");

  if (viewId === "orderView") {
    document.querySelector("[data-view='orderView']").classList.add("active");
  }
}

function downloadCsv() {
  const header = [
    "Nome do responsável",
    "Número do pedido",
    "Nome do aluno",
    "Série",
    "Mussarela",
    "Calabresa",
    "Total",
    "Forma de pagamento",
    "Status",
  ];
  const rows = adminOrders.map((order) => [
    order.guardianName,
    order.orderNumber,
    order.studentName,
    order.className,
    order.mussarelaQty,
    order.calabresaQty,
    money.format(order.total),
    order.status === "Pago" ? order.paymentMethod || "Mercado Pago" : "Não informado",
    order.status,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value || "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "relatorio-pizza-solidaria.csv";
  link.click();
  URL.revokeObjectURL(url);
}

document.querySelector("[data-view='orderView']").addEventListener("click", () => {
  showView("orderView");
});

adminAccess.addEventListener("click", async () => {
  if (!adminPassword) {
    adminPassword = window.prompt("Digite a senha administrativa:") || "";
  }

  try {
    await loadAdminOrders();
    showView("adminView");
  } catch (error) {
    adminPassword = "";
    alert(error.message);
  }
});

backToOrder.addEventListener("click", () => {
  showView("orderView");
});

[mussarelaQty, calabresaQty].forEach((input) => input.addEventListener("input", updateTotal));

phoneInput.addEventListener("input", () => {
  phoneInput.value = formatPhone(phoneInput.value);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const total = updateTotal();
  const mussarela = getQuantity(mussarelaQty);
  const calabresa = getQuantity(calabresaQty);

  if (mussarela + calabresa === 0) {
    alert("Informe a quantidade de pelo menos uma pizza.");
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Gerando pedido...";

  try {
    const data = new FormData(form);
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        guardianName: data.get("guardianName").trim(),
        studentName: data.get("studentName").trim(),
        className: data.get("className").trim(),
        phone: data.get("phone").trim(),
        email: data.get("email").trim(),
        mussarelaQty: mussarela,
        calabresaQty: calabresa,
        total,
      }),
    });

    showReceipt(order);
    form.reset();
    mussarelaQty.value = 0;
    calabresaQty.value = 0;
    updateTotal();
  } catch (error) {
    alert(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Gerar pedido";
  }
});

ordersTable.addEventListener("click", async (event) => {
  const confirmButton = event.target.closest("[data-confirm]");
  const deleteButton = event.target.closest("[data-delete]");

  try {
    if (deleteButton) {
      const order = adminOrders.find((item) => item.id === deleteButton.dataset.delete);
      if (!order) return;

      const shouldDelete = window.confirm(`Deseja excluir o pedido ${order.orderNumber}?`);
      if (!shouldDelete) return;

      await api(`/api/admin/orders/${order.id}`, { method: "DELETE" });
      await loadAdminOrders();
      return;
    }

    if (!confirmButton) return;

    const order = adminOrders.find((item) => item.id === confirmButton.dataset.confirm);
    if (!order) return;

    const nextStatus = order.status === "Pago" ? "Aguardando pagamento" : "Pago";
    const paymentMethod = nextStatus === "Pago" ? "Dinheiro" : "";
    const updated = await api(`/api/admin/orders/${order.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus, paymentMethod }),
    });

    await loadAdminOrders();

    if (updated.status === "Pago" && updated.email) {
      const message = orderMessage({ ...updated, statusText: "pagamento confirmado" });
      window.open(emailComposeUrl(updated, `Confirmação do pedido ${updated.orderNumber}`, message), "_blank", "noreferrer");
    }
  } catch (error) {
    alert(error.message);
  }
});

ordersTable.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-payment-method]");
  if (!select) return;

  try {
    await api(`/api/admin/orders/${select.dataset.paymentMethod}`, {
      method: "PATCH",
      body: JSON.stringify({ paymentMethod: select.value }),
    });
    await loadAdminOrders();
  } catch (error) {
    alert(error.message);
  }
});

exportCsvButton.addEventListener("click", downloadCsv);

updateTotal();
