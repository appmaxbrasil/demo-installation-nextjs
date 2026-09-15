# Fluxo de Apple Pay — passo a passo

Mapa em uma tela:

```
Safari (app/page.tsx)          appmax.min.js              Apple Pay (Safari)        /api/checkout/apple-pay
 │                                  │                          │                          │
 │  AppmaxScripts.init(             │                          │                          │
 │    onSuccess, onError,           │                          │                          │
 │    externalId, onUpdate,         │                          │                          │
 │    onAuthorize) ────────────────>│                          │                          │
 │                                  │  injeta botão em          │                          │
 │                                  │  .appmax-apple-pay-btn    │                          │
 │  toque no botão ─────────────────>│                          │                          │
 │                                  │  abre ApplePaySession ───>│                          │
 │                                  │  chama onUpdate() <───────│  (monta PaymentSheet)    │
 │                                  │  valida merchant session   │                          │
 │                                  │  (Lambda separada, sem     │                          │
 │                                  │   bearer — ver abaixo)     │                          │
 │                                  │                          │  confirma pagamento ─────>│
 │                                  │  chama onAuthorize(token) <────────────────────────────│
 │  submitApplePayment(appleToken) │                          │                          │
 │──────────────────────────────────────────────────────────────────────────────────────>│
 │                                  │                          │  POST /v1/payments/       │
 │                                  │                          │  apple-pay                │
 │  aprova/rejeita a Promise <──────────────────────────────────────────────────────────────│
 │  session.completePayment(status)│                          │                          │
```

## 1. `AppmaxScripts.init(...)`

No efeito de inicialização em [`app/page.tsx`](app/page.tsx) — chamado assim
que o script carrega (`scriptReady`) e `config` está pronto. Fluxo
**gerenciado**: em vez de montar a `ApplePaySession` nós mesmos, o próprio
`appmax.min.js` cuida de tudo (botão, validação de merchant, `PaymentSheet`)
— a gente só passa os callbacks.

```ts
window.AppmaxScripts.init(
  onSuccess,            // polimórfico: { ip } no init, string (token) no cartão
  onError,
  effectiveExternalId,  // obrigatório: sem ele o checkout nem carrega o SDK
  getCheckoutData,      // onUpdate
  onAuthorize
);
```

⚠️ Sem `externalId`, passar `onUpdate`/`onAuthorize` faz o `init()` lançar
`"External ID is required for Apple Pay use."` de forma síncrona (F09). O
código nunca chega lá: um guard bloqueia o checkout inteiro — e nem carrega o
`appmax.min.js` — enquanto não houver `external_id` no banco.

⚠️ O `init()` roda **uma vez por carga de página**. O SDK captura o
`externalId` no construtor do handler e não expõe teardown, então uma troca
de id em runtime não muda a requisição — só empilha listener. Quando o id
muda, o código força `window.location.reload()`. Ver
[`FLUXO-CARTAO.md`](FLUXO-CARTAO.md) §3.

## 2. O container do botão precisa existir ANTES do `init()`

Em [`app/page.tsx`](app/page.tsx):

```tsx
<div className={`appmax-apple-pay-btn h-12 ${step === "ready" ? "" : "hidden"}`} />
```

**Achado da auditoria (F08)**: o script procura esse container **só durante
o `init()`**, uma vez. Se ele nascer depois (num `if` condicional do React,
por exemplo), o clique nunca é registrado — em silêncio, sem erro nenhum.
Por isso ele fica sempre montado no DOM, só escondido via CSS.

## 3. `onUpdate()` — formato do carrinho

`getCheckoutData` em [`app/page.tsx`](app/page.tsx). A doc não
documenta o contrato de retorno em lugar nenhum (achado F23) — descobrimos
testando que precisa ser exatamente:

```ts
{ orderId: string, total: number, freight: number, discount: number, installments: number, products: [...] }
```

`total`/`freight`/`discount`/preços dos produtos em **reais** (não centavos)
— passar centavos ou string quebra com `cart.total.toFixed is not a
function` dentro do próprio script.

## 4. `onAuthorize(appleToken)` — rejeitar, não retornar `false`

`onAuthorize` em [`app/page.tsx`](app/page.tsx):

```ts
const onAuthorize = useCallback(async (appleToken: AppleToken) => {
  const ok = await submitApplePayment(appleToken);
  if (!ok) throw new Error("Pagamento não aprovado");
}, [submitApplePayment]);
```

**Achado crítico (F24)**: o SDK só entende falha por **rejeição da
Promise**. Se a função só devolver `false` (sem lançar), o script chama
`session.completePayment(STATUS_SUCCESS)` mesmo com o pagamento tendo
falhado — o cliente vê "pagamento aprovado" no Safari sem ter pago nada.

## 5. Merchant session — a chamada que a doc não documenta

Ver o comentário completo em [`lib/appmax/applePay.ts`](lib/appmax/applePay.ts).
Resumo: a doc aponta pra `POST /v1/apple-pay/merchant-session` na API
principal, com Bearer do merchant — mas o script de verdade chama uma
**Lambda pública separada** (`*.execute-api.sa-east-1.amazonaws.com`), sem
Bearer nenhum, só um header `external-id`. Por não precisar de segredo, essa
chamada roda **direto no client**, dentro do próprio `appmax.min.js` — não
passa pelo nosso backend.

## 6. `POST /api/checkout/apple-pay`

[`app/api/checkout/apple-pay/route.ts`](app/api/checkout/apple-pay/route.ts)
→ [`lib/appmax/applePay.ts`](lib/appmax/applePay.ts) →
`POST /v1/payments/apple-pay`. Recebe o `appleToken` cru (paymentData +
paymentMethod do Apple Pay nativo, repassado como veio) e o `orderId`/
`customerId` criados no passo anterior (`POST /api/checkout`).

## Diagnóstico — sintoma → causa

| Sintoma | Causa provável |
|---|---|
| Botão não aparece | Não é Safari, sem cartão na Wallet, ou container ausente no DOM durante `init()` (F08) |
| `cart.total.toFixed is not a function` | `onUpdate` devolvendo formato errado (F23) — confira números em reais, não string/centavos |
| Cliente vê "aprovado" mas o pagamento falhou no backend | `onAuthorize` retornando `false` em vez de lançar (F24) |
| `init()` lança exceção síncrona na tela | Faltou `externalId` (F09) |
| Merchant session sempre falha, `"Failed to get session"` | **Limitação conhecida**: só funciona em produção (`APPMAX_ENV=production`) — sandbox falha essa validação de forma consistente |
| IP coletado duas vezes por `init()` | Comportamento do próprio SDK: `PaymentFormHandler` chama `initialize()` no construtor E o `FormAdapter.init()` chama de novo (ver [`FLUXO-CARTAO.md`](FLUXO-CARTAO.md) §3). Inofensivo pro IP; grave pro cartão |
| Pagamento disparado duas vezes | Mesma causa acima. O `init()` também não é idempotente (F15): garanta uma chamada por carga de página |
| Merchant session falha depois de trocar de ambiente | Token OAuth é cacheado por ambiente; se persistir, confira qual ambiente está ativo no seletor do Header |
