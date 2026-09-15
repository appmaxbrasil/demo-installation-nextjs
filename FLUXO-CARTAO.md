# Fluxo de cartão de crédito — passo a passo

> ✅ **Funciona em sandbox.** Uma versão anterior deste documento afirmava o
> contrário (achado F26: "tokenização quebrada em sandbox, teste só em
> produção"). Estava errado, e o erro custou caro: mandava o integrador
> cobrar cartão de verdade pra testar. O endpoint de tokenização do sandbox
> responde `201` normalmente — o que falhava era o `external_id` que
> estávamos mandando.

Mapa em uma tela (contrato **verificado ao vivo**, não o documentado):

```
Browser (app/page.tsx)         appmax.min.js              /api/checkout/credit-card
 │                                  │                          │
 │  AppmaxScripts.init(             │                          │
 │    onSuccess, onError,           │                          │
 │    externalId, ...) ────────────>│                          │
 │                                  │  onSuccess({ ip })       │
 │  <───────────────────────────────│  (objeto, no init)       │
 │                                  │                          │
 │  preenche form                   │                          │
 │  data-appmax-checkout            │                          │
 │  submit ────────────────────────>│                          │
 │                                  │  POST .../v1/payments/    │
 │                                  │  tokenize                 │
 │                                  │  header: external-id      │
 │  onSuccess("<token>") <──────────│  (STRING CRUA, não        │
 │                                  │   objeto — ver §2)        │
 │  submitCreditCardPayment(token)  │                          │
 │───────────────────────────────────────────────────────────>│
 │                                  │                          │  POST /v1/payments/
 │                                  │                          │  credit-card
 │  aprovado/rejeitado <──────────────────────────────────────│
```

## 1. O form — `data-appmax-checkout` + `appmax-form-element`

Ver o `<form ref={cardFormRef} data-appmax-checkout>` em
[`app/page.tsx`](app/page.tsx). Cada campo precisa do atributo
`appmax-form-element` com um valor fixo — não é o `name` do input:

| Campo | `appmax-form-element` | `name` (lido pelo SDK) |
|---|---|---|
| Número do cartão | `number` | `card-number` |
| Nome impresso | `holder_name` | `card-holder-name` |
| Mês de validade | `expiration_month` | `exp-month` |
| Ano de validade | `expiration_year` | `exp-year` |
| CVV | `cvv` | `cvv` |

**Os dois atributos importam, e por motivos diferentes.** O SDK lê os valores
com `new FormData(form)` pelos **`name`** (`PaymentFormHandler.js:69-76`) —
os `name` da tabela acima são os que ele espera, não são livres. Por isso os
inputs do cartão são **não controlados** (`defaultValue`, não `value`): o
React não participa da leitura.

O form fica **sempre montado no DOM**, só escondido via CSS quando
`step !== "ready"`. Isso é obrigatório: o SDK registra o listener de submit
uma única vez, durante o `init()` (`setupFormSubmission()`), e um form que
nasce depois nunca é interceptado — mesma pegadinha do container do Apple Pay
(F08).

O ano aceita 2 ou 4 dígitos (`31` e `2031` ambos tokenizam) — testado.

## 2. `onSuccess` é POLIMÓRFICO — a doc está errada

A doc (`/guides/appmax-js`) promete `onSuccess({ ip, token? })`. **Esse
objeto com `token` não existe.** No fonte do SDK:

```js
// PaymentFormHandler.js:27 e :34 — no init
this.onSuccess({ ip: this.ip });     // objeto

// PaymentFormHandler.js:83 — depois de tokenizar
this.onSuccess(token);               // STRING CRUA
```

Ler `data.token` dá `undefined` (é uma string, não objeto) e o pagamento
**morre em silêncio**: a tokenização retorna `201`, e nada mais acontece —
nenhum erro, nenhuma requisição. Por isso o handler faz `typeof`:

```ts
(data) => {
  if (typeof data === "string") { /* token do cartão */ }
  else if (data?.ip)            { /* coleta de IP */ }
}
```

## 3. ⚠️ O SDK dispara DOIS pagamentos por clique

Bug do `appmax.min.js`, não da integração:

```js
// PaymentFormHandler.js:17 — o construtor já chama:
this.initialize();
// FormAdapter.js:19 — e o init() chama de novo:
paymentHandler.initialize();
```

Dois listeners de submit no mesmo form ⇒ **duas tokenizações e duas
tentativas de pagamento por clique**. Confirmado ao vivo: uma aprovada e
outra recusada com `400`/`409` no mesmo pedido.

De-duplicar por token **não funciona** — cada listener tokeniza por conta
própria e os tokens são diferentes. A trava tem que ser por pedido, e é o que
`cardPaymentLockRef` faz em [`app/page.tsx`](app/page.tsx).

Em produção, com cartão real, isso é risco de cobrança dupla. A correção do
lado do SDK é deletar a linha 19 do `FormAdapter.js`.

## 4. `submitCreditCardPayment(token)`

Em [`app/page.tsx`](app/page.tsx) — mesmo formato de `submitApplePayment`
(ver [`FLUXO-APPLE-PAY.md`](FLUXO-APPLE-PAY.md)), só troca o endpoint:

```ts
await fetch("/api/checkout/credit-card", {
  method: "POST",
  body: JSON.stringify({ orderId, customerId, token, installments, holderDocumentNumber, holderName }),
});
```

## 5. `POST /api/checkout/credit-card`

[`app/api/checkout/credit-card/route.ts`](app/api/checkout/credit-card/route.ts)
→ [`lib/appmax/creditCard.ts`](lib/appmax/creditCard.ts) →
`POST /v1/payments/credit-card` (`/api-reference/payments/cartao-credito`):

```json
{
  "order_id": 123,
  "customer_id": 456,
  "payment_data": {
    "credit_card": {
      "token": "...",
      "holder_document_number": "...",
      "holder_name": "...",
      "installments": 1,
      "soft_descriptor": "..."
    }
  }
}
```

O número do cartão e o CVV **nunca** chegam nesse endpoint — só o `token`
já gerado pelo `appmax.min.js` no browser.

## O que o SDK manda pra tokenizar

Útil pra reproduzir no `curl` quando algo falha:

```
POST https://<host>/v1/payments/tokenize
headers: content-type: application/json
         external-id: <o external_id da instalação>
body: {"payment_data":{"credit_card":{
        "number","holder_name","expiration_month","expiration_year","cvv"}}}
```

`origin`, `referer` e os `sec-fetch-*` **não** influenciam em nada —
testado trocando todos. Só o `external-id` decide.

O host depende do bundle carregado, e **eles divergem**:

| | tokenize |
|---|---|
| bundle de sandbox | `2ufaxwvzb7.execute-api.`**`us-east-1`**`.amazonaws.com/`**`development`** |
| bundle de produção | `hdixjlm06b.execute-api.`**`sa-east-1`**`.amazonaws.com/`**`production`** |

Os dois são API Gateway em modo `HTTP_PROXY` (repassam o header
`external-id` intacto) pro backend V4 do ambiente correspondente — quem
responde `"Merchant not found"` é a V4, não a Lambda.

## Diagnóstico — sintoma → causa

| Sintoma | Causa provável |
|---|---|
| `onError`: `"Failed to process payment: Failed to tokenize card."` | Genérico do SDK pra QUALQUER falha de rede na tokenização. Abra o Network tab e olhe o status real do `POST .../tokenize` |
| `404 {"message":"Merchant not found"}` no tokenize | O `external_id` enviado não existe no registro de merchants daquele ambiente. Não é o endpoint fora do ar. Confira o log `[Appmax] init() com external_id=…` e reinstale se preciso |
| `400 Missing required request parameters: [external-id]` | `init()` rodou sem `external_id` — o checkout deveria ter bloqueado antes |
| Tokeniza com `201` mas nada acontece depois | Lendo `data.token` num `onSuccess` que recebeu string (§2) |
| Dois pagamentos no mesmo pedido | Duplo `initialize()` do SDK (§3) — a trava por pedido é obrigatória |
| `POST /v1/payments/credit-card` devolve 400 | Confira se `installments` é `number` (não string) — diferente do Apple Pay, que a doc pede string |
| Trocar o `external_id` não muda a request | O SDK captura o valor no construtor e não tem teardown — só recarregando a página. O código força o reload sozinho |
