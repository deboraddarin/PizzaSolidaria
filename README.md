# Pizza Solidária Água Viva

Site de pedidos com área administrativa e integração Mercado Pago.

## Como configurar

1. Copie `.env.example` para `.env`.
2. Preencha `MERCADO_PAGO_ACCESS_TOKEN` com o Access Token da aplicação Mercado Pago.
3. Em `BASE_URL`, coloque a URL pública do site. O Mercado Pago precisa acessar essa URL para enviar o webhook.
4. Ajuste `ADMIN_PASSWORD` se quiser trocar a senha administrativa.
5. Inicie o servidor:

```bash
npm start
```

O site abre em `http://localhost:3000` quando rodado localmente.

## Webhook Mercado Pago

O backend recebe notificações em:

```text
/api/webhooks/mercado-pago
```

Quando o Mercado Pago informar um pagamento aprovado, o pedido será marcado como `Pago` automaticamente e a forma de pagamento será preenchida conforme o tipo retornado pelo Mercado Pago.

Pagamentos em dinheiro continuam podendo ser confirmados manualmente na área administrativa.
