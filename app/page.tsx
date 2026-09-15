"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Script from "next/script";
import Link from "next/link";
import { TEST_PRODUCT, formatBRL } from "@/lib/checkout/product";
import type { AppleToken } from "@/lib/appmax/applePay";

/**
 * Fluxo GERENCIADO pelo appmax.min.js: em vez de montar a ApplePaySession
 * nós mesmos, deixamos o próprio script cuidar de tudo (botão, validação de
 * merchant, PaymentSheet) via `AppmaxScripts.init(..., onUpdate,
 * onAuthorize)`. Confirmado funcionando via testes instrumentados — ver
 * FLUXO-APPLE-PAY.md. Só precisamos de `canMakePayments` pra
 * decidir se mostramos a seção de Apple Pay.
 */
declare global {
  interface Window {
    ApplePaySession?: { canMakePayments: () => boolean };
    AppmaxScripts?: {
      init: (
        // ATENÇÃO: `onSuccess` é POLIMÓRFICO. A doc oficial
        // (/guides/appmax-js) diz que ele recebe `{ ip, token? }` — está
        // errado. Confirmado no fonte do SDK
        // (appmax-fingersecurity, PaymentFormHandler.js):
        //
        //   linha 27/34  → this.onSuccess({ ip: this.ip })   objeto, no init
        //   linha 83     → this.onSuccess(token)             STRING crua,
        //                                                    após tokenizar
        //
        // Ou seja: o token NUNCA chega como `data.token`. Ler `data.token`
        // dá `undefined` (é uma string, não objeto) e o pagamento
        // simplesmente não acontece — tokeniza com 201 e morre ali, sem
        // erro nenhum. Por isso o handler abaixo faz `typeof data`.
        onSuccess: (data: { ip: string } | string) => void,
        onError: (err: unknown) => void,
        externalId?: string,
        onUpdate?: () => AppmaxCheckoutData,
        onAuthorize?: (appleToken: AppleToken) => void | Promise<void>
      ) => void;
    };
  }
}

/**
 * Retorno esperado pelo `onUpdate` — o SDK usa isso pra montar a
 * PaymentSheet (itens de linha + total). Ver /guides/appmax-js.
 */
type AppmaxCheckoutData = {
  orderId: string;
  total: number;
  freight: number;
  discount: number;
  installments: number;
  products: { name: string; price: number; quantity: number }[];
};

type PublicConfig = {
  environment: "sandbox" | "production";
  scriptUrl: string;
  externalId: string | null;
  merchantConfigured: boolean;
  product: typeof TEST_PRODUCT;
};

type Step = "form" | "ready" | "processing" | "success" | "error";

/**
 * Comprador fictício, só pra não ficar digitando a cada teste — tudo
 * editável no form.
 *
 * Nada aqui pode ser dado de pessoa real: este repositório é público e a
 * tela roda atrás de um túnel aberto. Por isso:
 * - CPF `111.444.777-35` — dígitos verificadores válidos (a Appmax valida o
 *   checksum e recusa CPF malformado), mas é o número de teste mais
 *   conhecido do Brasil, não pertence a ninguém.
 * - E-mail em `example.com`, domínio reservado pra documentação/teste
 *   (RFC 2606) — não existe caixa de entrada pra receber nada.
 * - Endereço da Avenida Paulista, logradouro público e genérico.
 */
const emptyForm = {
  firstName: "Maria",
  lastName: "Teste",
  email: "comprador.teste@example.com",
  phone: "11999999999",
  documentNumber: "11144477735",
  postcode: "01310100",
  street: "Avenida Paulista",
  number: "1000",
  district: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

/**
 * Cartão de teste da Appmax em sandbox. Usado como `defaultValue` (e não
 * `value`) de propósito: os campos do cartão são NÃO controlados porque
 * quem os lê é o próprio SDK, via `new FormData(form)` sobre os atributos
 * `name` (PaymentFormHandler.js:69-76). Um `value` controlado pelo React
 * não mudaria o que o SDK enxerga, e ainda travaria a edição.
 */
const TEST_CARD = {
  number: "4000000000000010",
  holderName: "MARIA TESTE",
  expirationMonth: "12",
  expirationYear: "2031",
  cvv: "123",
};

// Fora do componente: identidade estável, senão useSyncExternalStore re-assina a cada render.
function subscribeApplePaySession() {
  return () => {};
}
function getApplePaySnapshot() {
  if (typeof window === "undefined" || !window.ApplePaySession) return false;
  try {
    return window.ApplePaySession.canMakePayments();
  } catch {
    return false;
  }
}
function getApplePayServerSnapshot() {
  return false;
}

export default function CheckoutPage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [ip, setIp] = useState<string | null>(null);
  // useSyncExternalStore em vez de useState+useEffect: `canMakePayments()` só
  // existe no browser, então precisamos de um valor consistente no SSR (false)
  // que se atualiza para o valor real do client sem gerar warning de hydration.
  const applePayAvailable = useSyncExternalStore(
    subscribeApplePaySession,
    getApplePaySnapshot,
    getApplePayServerSnapshot
  );
  const [form, setForm] = useState(emptyForm);
  const [installments, setInstallments] = useState(1);
  const [step, setStep] = useState<Step>("form");
  const [message, setMessage] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState<number | null>(null);
  // Qual `external_id` já foi passado pro `AppmaxScripts.init()`. O SDK NÃO
  // é idempotente e não expõe teardown: cada `init()` constrói um
  // `PaymentFormHandler` novo, que captura o `externalId` no construtor e
  // registra MAIS UM listener de submit no mesmo
  // `<form data-appmax-checkout>` (fonte: appmax-fingersecurity,
  // PaymentFormHandler.js linhas 12 e 56-64). Os listeners antigos
  // continuam vivos, com o id ANTIGO.
  //
  // Consequência prática, que apareceu em teste real: trocar o external_id
  // e re-inicializar não troca o id da requisição — o listener velho
  // dispara primeiro e tokeniza com o valor anterior. Só um reload
  // resolvia. Por isso aqui o `init()` acontece UMA vez por carga de
  // página, e uma troca de id depois disso força o reload em vez de
  // tentar um segundo init que não funcionaria.
  //
  // (Isto também cobre o replay do StrictMode, que em dev chamava o init
  // duas vezes e gerava dois POST de tokenize por clique.)
  const initializedForRef = useRef<string | null>(null);
  // Pedido que já tem um pagamento de cartão em voo (ou concluído).
  //
  // O SDK dispara DOIS submits por clique — não é o StrictMode, é bug dele:
  // o `PaymentFormHandler` chama `this.initialize()` no construtor
  // (PaymentFormHandler.js:17) e o `FormAdapter.init()` chama
  // `paymentHandler.initialize()` DE NOVO logo depois (FormAdapter.js:19),
  // registrando dois listeners de submit no mesmo form. Cada um tokeniza
  // por conta própria, então chegam dois `onSuccess` com tokens
  // DIFERENTES — de-duplicar por valor de token não funciona, tem que ser
  // por pedido. Confirmado ao vivo: sem isto, uma tentativa era aprovada e
  // a outra voltava HTTP 400/409 no mesmo pedido.
  //
  // Liberado no catch de `submitCreditCardPayment` pra não travar o retry
  // quando o pagamento falha de verdade.
  const cardPaymentLockRef = useRef<number | null>(null);
  const ipFormRef = useRef<HTMLFormElement>(null);
  const cardFormRef = useRef<HTMLFormElement>(null);
  const [cardHolderName, setCardHolderName] = useState(TEST_CARD.holderName);

  // Override manual do external_id, editável na tela — mais rápido que
  // mudar env var + redeploy pra testar. Fica em localStorage (não em
  // estado inicial, pra não divergir do HTML gerado no build e gerar
  // warning de hydration) e sobrevive ao reload que o round-trip do IP
  // (abaixo) provoca.
  const [externalIdOverride, setExternalIdOverride] = useState("");
  useEffect(() => {
    // Hidratação única a partir de localStorage (não uma assinatura a uma
    // store externa que muda ao longo da vida do componente) — por isso um
    // effect de mount é apropriado aqui, mesmo a lint preferindo
    // useSyncExternalStore para o caso geral.
    const stored = window.localStorage.getItem("appmax_external_id_override");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setExternalIdOverride(stored);
  }, []);
  function updateExternalIdOverride(value: string) {
    setExternalIdOverride(value);
    if (value.trim()) {
      window.localStorage.setItem("appmax_external_id_override", value.trim());
    } else {
      window.localStorage.removeItem("appmax_external_id_override");
    }
  }
  const effectiveExternalId = externalIdOverride.trim() || config?.externalId || null;
  // `config` carregado e ainda assim sem external_id: o SDK não é inicializado
  // e o checkout inteiro fica bloqueado (ver o efeito de init mais abaixo).
  const missingExternalId = Boolean(config) && !effectiveExternalId;

  // Espelha o estado mais recente para os callbacks do AppmaxScripts, que são
  // registrados uma única vez no `init` e por isso fechariam sobre valores
  // desatualizados se lessem `orderId`/`installments` diretamente do state.
  const latest = useRef({ orderId, customerId, installments, form, cardHolderName });
  useEffect(() => {
    latest.current = { orderId, customerId, installments, form, cardHolderName };
  }, [orderId, customerId, installments, form, cardHolderName]);

  useEffect(() => {
    fetch("/api/appmax/public-config")
      .then((res) => res.json())
      .then((next: PublicConfig) => {
        console.log("[Appmax] config do servidor:", {
          ambiente: next.environment,
          scriptUrl: next.scriptUrl,
          externalIdDoBanco: next.externalId ?? "(vazio)",
        });
        setConfig(next);
      })
      .catch(() => setMessage("Não foi possível carregar a configuração do servidor."));
  }, []);

  const totalCents = TEST_PRODUCT.unitValueCents * TEST_PRODUCT.quantity;

  // `onUpdate` do AppmaxScripts.init — o script chama isso pra montar os
  // itens/total da PaymentSheet. orderId aqui é só informativo pro SDK;
  // o order_id que realmente importa é o que mandamos em
  // POST /v1/payments/apple-pay (dentro de submitApplePayment).
  const getCheckoutData = useCallback((): AppmaxCheckoutData => {
    const { orderId, installments } = latest.current;
    return {
      orderId: orderId ? String(orderId) : "",
      total: totalCents / 100,
      freight: 0,
      discount: 0,
      installments,
      products: [
        {
          name: TEST_PRODUCT.name,
          price: TEST_PRODUCT.unitValueCents / 100,
          quantity: TEST_PRODUCT.quantity,
        },
      ],
    };
  }, [totalCents]);

  // Retorna true/false (em vez de void) pra quem chama — o
  // onpaymentauthorized da ApplePaySession precisa saber o resultado pra
  // chamar session.completePayment(STATUS_SUCCESS | STATUS_FAILURE).
  const submitApplePayment = useCallback(async (appleToken: AppleToken): Promise<boolean> => {
    const { orderId, customerId, installments, form } = latest.current;
    console.log("[Appmax] onpaymentauthorized — enviando appleToken pro backend", {
      orderId,
      customerId,
      installments,
    });
    if (!orderId || !customerId) {
      setMessage("Finalize os dados do pedido antes de pagar.");
      return false;
    }
    setStep("processing");
    setMessage(null);
    try {
      const res = await fetch("/api/checkout/apple-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          customerId,
          installments,
          holderDocumentNumber: form.documentNumber,
          appleToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Falha no pagamento (HTTP ${res.status})`);
      console.log("[Appmax] Pagamento aprovado", data);
      setStep("success");
      setMessage("Pagamento aprovado! ✅");
      return true;
    } catch (error) {
      console.error("[Appmax] Falha ao efetivar o pagamento", error);
      setStep("error");
      setMessage(error instanceof Error ? error.message : "Erro ao processar pagamento.");
      return false;
    }
  }, []);

  // Efetiva o pagamento via cartão assim que temos o `token` (devolvido pelo
  // `onSuccess` — ver comentário no `declare global` acima). Mesmo
  // shape/tratamento de erro de `submitApplePayment`, só troca o endpoint.
  const submitCreditCardPayment = useCallback(async (token: string) => {
    const { orderId, customerId, installments, form, cardHolderName } = latest.current;
    console.log("[Appmax] token de cartão recebido — enviando pro backend", {
      orderId,
      customerId,
      installments,
    });
    if (!orderId || !customerId) {
      setMessage("Finalize os dados do pedido antes de pagar.");
      return;
    }
    setStep("processing");
    setMessage(null);
    try {
      const res = await fetch("/api/checkout/credit-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          customerId,
          token,
          installments,
          holderDocumentNumber: form.documentNumber,
          holderName: cardHolderName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Falha no pagamento (HTTP ${res.status})`);
      console.log("[Appmax] Pagamento aprovado", data);
      setStep("success");
      setMessage("Pagamento aprovado! ✅");
    } catch (error) {
      console.error("[Appmax] Falha ao efetivar o pagamento com cartão", error);
      // Libera a trava: o pagamento não aconteceu, então uma nova tentativa
      // do usuário precisa passar.
      cardPaymentLockRef.current = null;
      setStep("error");
      setMessage(error instanceof Error ? error.message : "Erro ao processar pagamento.");
    }
  }, []);

  // `onAuthorize` do AppmaxScripts.init. IMPORTANTE (achado da auditoria):
  // internamente o SDK trata sucesso/falha por resolve/reject da Promise
  // (`.then(() => true).catch(() => false)`), não pelo valor que a gente
  // retorna — por isso precisamos lançar quando o pagamento falha, em vez
  // de só devolver `false`, senão o SDK chama completePayment(SUCCESS)
  // mesmo com o pagamento tendo falhado.
  const onAuthorize = useCallback(
    async (appleToken: AppleToken) => {
      const ok = await submitApplePayment(appleToken);
      if (!ok) throw new Error("Pagamento não aprovado");
    },
    [submitApplePayment]
  );

  // Restaura o IP (e os dados do form) se a gente acabou de voltar do
  // round-trip do formulário oculto abaixo — ver comentário no <form
  // data-appmax-customer>. Roda uma vez, lendo a URL (fonte externa), não
  // uma assinatura contínua — por isso um effect de mount, não
  // useSyncExternalStore.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ipFromUrl = params.get("ip");
    if (!ipFromUrl) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIp(ipFromUrl);
    setForm((prev) => ({
      ...prev,
      firstName: params.get("first-name") ?? prev.firstName,
      lastName: params.get("last-name") ?? prev.lastName,
      email: params.get("email") ?? prev.email,
      phone: params.get("phone") ?? prev.phone,
    }));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // Inicializa o AppmaxScripts assim que o script carregou. Fluxo GERENCIADO
  // pelo script (ver comentário no topo do arquivo e FLUXO-APPLE-PAY.md,
  // F07/F08): passamos `externalId` + `onUpdate` + `onAuthorize` — o script
  // injeta o botão dentro do container `.appmax-apple-pay-btn` (renderizado
  // sempre, mais abaixo), registra o clique, monta a ApplePaySession, valida
  // o merchant e nos entrega o appleToken pronto em `onAuthorize`. O
  // `externalId` é pré-requisito dos três (sem ele o `init()` lança
  // "External ID is required for Apple Pay use." — F09), por isso o guard
  // logo abaixo aborta antes em vez de tentar um init degradado.
  //
  // Importante (F08): o container do botão precisa já estar no DOM quando
  // este efeito roda, senão o clique nunca é registrado, em silêncio. Por
  // isso ele é renderizado incondicionalmente no JSX, só escondido via CSS
  // enquanto o pedido não existe.
  useEffect(() => {
    if (!scriptReady || !config || !window.AppmaxScripts) return;

    // Sem external_id não adianta nem chamar o SDK: toda rota interna dele
    // manda o valor no header `external-id`, e a Appmax responde
    // `404 {"message":"Merchant not found"}` — que chega aqui como o
    // genérico "Failed to tokenize card." e parece bug de implementação.
    // O guard duplo (aqui + `missingExternalId` no JSX) é de propósito: o
    // banner explica, este return garante que o `init()` não roda.
    if (!effectiveExternalId) {
      console.warn(
        "[Appmax] init() NÃO chamado: external_id ausente. Salve-o em /configuracao (ou conclua a instalação em /setup)."
      );
      return;
    }

    if (initializedForRef.current) {
      if (initializedForRef.current !== effectiveExternalId) {
        // O SDK já está preso ao id anterior (ver comentário no ref). Um
        // init novo só empilharia listener; recarregar é o único caminho.
        console.warn(
          `[Appmax] external_id mudou de "${initializedForRef.current}" para "${effectiveExternalId}" depois do init(). O SDK não suporta troca em runtime — recarregando a página.`
        );
        window.location.reload();
      }
      return;
    }
    initializedForRef.current = effectiveExternalId;

    // Log explícito do que vai no header `external-id` de TODA chamada do
    // SDK, e de onde esse valor saiu. É o primeiro lugar pra olhar quando a
    // Appmax responde 404 "Merchant not found": compare este id com o que
    // está em /configuracao e com o que a instalação registrou.
    console.log(
      `[Appmax] init() com external_id=${effectiveExternalId} (origem: ${
        effectiveExternalId === config.externalId
          ? "banco (/configuracao)"
          : "override do localStorage"
      }, ambiente: ${config.environment})`
    );
    window.AppmaxScripts.init(
      (data) => {
        // String crua = token do cartão (ver comentário no `declare global`).
        if (typeof data === "string") {
          // Trava síncrona, antes de qualquer await: o segundo onSuccess
          // chega logo atrás do primeiro e precisa ver o lock já posto.
          const { orderId } = latest.current;
          if (cardPaymentLockRef.current === orderId) {
            console.warn(
              `[Appmax] segundo token de cartão para o pedido ${orderId} — ignorando (o SDK dispara 2 submits por clique; ver comentário em cardPaymentLockRef).`
            );
            return;
          }
          cardPaymentLockRef.current = orderId;
          console.log("[Appmax] onSuccess — token de cartão recebido");
          submitCreditCardPayment(data);
          return;
        }
        // Objeto = coleta de IP, no init. Nunca traz token, e o SDK chama
        // isto mais de uma vez por init — daí não mexer em mais nada aqui.
        console.log("[Appmax] onSuccess — IP coletado:", data);
        if (data?.ip) setIp(data.ip);
      },
      (err) => {
        console.error("[Appmax] onError do AppmaxScripts:", err);
        setMessage("Erro ao inicializar o Appmax JS (veja o console).");
      },
      effectiveExternalId,
      getCheckoutData,
      onAuthorize
    );
  }, [scriptReady, config, effectiveExternalId, getCheckoutData, onAuthorize, submitCreditCardPayment]);

  function updateField<K extends keyof typeof emptyForm>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!ip) {
      // O `AppmaxScripts.init(onSuccess, onError)` sozinho não dispara nada
      // (confirmado testando com fetch/XHR/WebRTC instrumentados — nenhum é
      // chamado). A coleta de IP só roda de verdade a partir do submit de um
      // <form data-appmax-customer>, que a Appmax intercepta e usa pra
      // recarregar a página com os dados (incluindo o IP) na querystring —
      // não documentado, mas foi o único jeito que funcionou nos testes.
      // Então: manda o form oculto abaixo, a página recarrega, e o efeito
      // que lê `?ip=` da URL (acima) restaura tudo — inclusive esses campos.
      setMessage(
        "Coletando dados de segurança da Appmax — a página vai recarregar em instantes. Clique em Continuar de novo assim que voltar."
      );
      ipFormRef.current?.requestSubmit();
      return;
    }
    setMessage(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          documentNumber: form.documentNumber || undefined,
          address: form.postcode
            ? {
                postcode: form.postcode,
                street: form.street,
                number: form.number,
                district: form.district,
                city: form.city,
                state: form.state,
              }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Falha ao criar pedido (HTTP ${res.status})`);
      setOrderId(data.orderId);
      setCustomerId(data.customerId);
      setStep("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao criar pedido.");
    }
  }

  /**
   * Volta pro início pra testar outro pedido, sem reload.
   *
   * Não recarrega a página de propósito: o `AppmaxScripts.init()` roda uma
   * única vez por carga (o SDK captura o externalId no construtor e não tem
   * teardown — ver `initializedForRef`), e o IP só é coletado no init. Um
   * reload custaria os dois de volta; manter a página viva reaproveita o
   * mesmo SDK já inicializado.
   *
   * O `cardPaymentLockRef` é zerado por higiene, não por necessidade: ele
   * guarda o ID do pedido que já teve pagamento disparado, e como o pedido
   * novo tem ID diferente, a trava do anterior não o barraria de qualquer
   * forma. Limpar evita carregar estado morto entre pedidos.
   *
   * Os campos do comprador e do cartão ficam como estão — são os dados de
   * teste, e reescrevê-los a cada pedido só daria trabalho.
   */
  function startNewOrder() {
    setOrderId(null);
    setCustomerId(null);
    setMessage(null);
    cardPaymentLockRef.current = null;
    setStep("form");
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16">
      {config && !missingExternalId && (
        <Script
          src={config.scriptUrl}
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
        />
      )}

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Checkout de teste — Apple Pay</h1>
        <p className="text-sm text-am-ink-muted">
          Projeto só para validar o fluxo de pagamento via Apple Pay com a Appmax
          ({config?.environment ?? "…"}). Sem estilo, só o essencial.
        </p>
      </header>

      {missingExternalId && (
        <div className="rounded-lg border border-am-danger-text/30 bg-am-danger-bg p-4 text-sm text-am-danger-text">
          <strong>external_id não configurado ({config?.environment}).</strong>{" "}
          O <code>appmax.min.js</code> não foi inicializado — sem esse id toda
          chamada do SDK volta{" "}
          <code>404 &quot;Merchant not found&quot;</code> (o erro genérico
          &quot;Failed to tokenize card.&quot; no cartão). Conclua a instalação
          em{" "}
          <Link href="/setup" className="underline">
            /setup
          </Link>{" "}
          ou salve o valor em{" "}
          <Link href="/configuracao" className="underline">
            /configuracao
          </Link>
          . Ele é lido só do banco — env var não vale mais.
        </div>
      )}

      {config && !config.merchantConfigured && (
        <div className="rounded-lg border border-am-warn-text/30 bg-am-warn-bg p-4 text-sm text-am-warn-text">
          Integração ainda não instalada.{" "}
          <Link href="/setup" className="underline">
            Vá para /setup
          </Link>{" "}
          para concluir o fluxo de instalação com a Appmax.
        </div>
      )}

      <details className="rounded-lg border border-am-border bg-am-card p-4 text-sm">
        <summary className="cursor-pointer select-none text-am-ink-muted">
          Configuração avançada
        </summary>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-am-ink-muted">
            external_id (sobrepõe o salvo em /configuracao — útil pra testar
            outro valor sem mexer no banco; fica salvo no localStorage deste
            navegador)
          </span>
          <input
            placeholder={config?.externalId ?? "não configurado no banco"}
            className="rounded border border-am-border bg-white px-3 py-2 font-mono text-xs text-am-ink"
            value={externalIdOverride}
            onChange={(e) => updateExternalIdOverride(e.target.value)}
          />
        </label>
      </details>

      {/*
        Form oculto só pra disparar a coleta de IP da Appmax. O
        `data-appmax-customer` faz o appmax.min.js interceptar o submit,
        coletar o IP e recarregar a página anexando os dados na querystring
        (?ip=...) — não documentado publicamente, achei testando ao vivo.
        `handleContinue` dispara isso quando `ip` ainda é null; o efeito lá
        em cima lê a querystring de volta no próximo carregamento.
      */}
      <form ref={ipFormRef} data-appmax-customer action="/" method="get" className="hidden">
        <input type="hidden" name="first-name" value={form.firstName || "Teste"} readOnly />
        <input type="hidden" name="last-name" value={form.lastName || "Teste"} readOnly />
        <input
          type="hidden"
          name="email"
          value={form.email || "teste@example.com"}
          readOnly
        />
        <input type="hidden" name="phone" value={form.phone || "11999999999"} readOnly />
      </form>

      {applePayAvailable === false && (
        <div className="rounded-lg border border-am-border bg-am-purple-soft p-4 text-sm text-am-ink">
          Apple Pay não está disponível neste navegador. Ele só aparece no Safari
          (macOS/iOS) com um cartão configurado na Apple Wallet, e a página precisa
          estar servida via HTTPS pública (não funciona em <code>localhost</code>).
        </div>
      )}

      <section className="rounded-lg border border-am-border bg-am-card p-5 text-sm">
        <div className="flex justify-between">
          <span>{TEST_PRODUCT.name}</span>
          <span>{formatBRL(TEST_PRODUCT.unitValueCents)}</span>
        </div>
        <div className="mt-2 flex justify-between font-medium">
          <span>Total</span>
          <span>{formatBRL(totalCents)}</span>
        </div>
      </section>

      {step === "form" && (
        <form onSubmit={handleContinue} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              placeholder="Nome"
              className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
              value={form.firstName}
              onChange={(e) => updateField("firstName", e.target.value)}
            />
            <input
              required
              placeholder="Sobrenome"
              className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
              value={form.lastName}
              onChange={(e) => updateField("lastName", e.target.value)}
            />
          </div>
          <input
            required
            type="email"
            placeholder="E-mail"
            className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              required
              placeholder="Telefone (DDD+número)"
              className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value)}
            />
            <input
              required
              placeholder="CPF (titular do cartão)"
              className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
              value={form.documentNumber}
              onChange={(e) => updateField("documentNumber", e.target.value)}
            />
          </div>

          <details className="text-sm text-am-ink-muted">
            <summary className="cursor-pointer select-none">
              Endereço (opcional)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <input
                placeholder="CEP"
                className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
                value={form.postcode}
                onChange={(e) => updateField("postcode", e.target.value)}
              />
              <input
                placeholder="Número"
                className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
                value={form.number}
                onChange={(e) => updateField("number", e.target.value)}
              />
              <input
                placeholder="Rua"
                className="col-span-2 rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
                value={form.street}
                onChange={(e) => updateField("street", e.target.value)}
              />
              <input
                placeholder="Bairro"
                className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
                value={form.district}
                onChange={(e) => updateField("district", e.target.value)}
              />
              <input
                placeholder="Cidade"
                className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
                value={form.city}
                onChange={(e) => updateField("city", e.target.value)}
              />
              <input
                placeholder="UF"
                className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
                value={form.state}
                onChange={(e) => updateField("state", e.target.value)}
              />
            </div>
          </details>

          <label className="flex items-center gap-2 text-sm">
            Parcelas
            <select
              className="rounded border border-am-border bg-white px-2 py-1 text-am-ink"
              value={installments}
              onChange={(e) => setInstallments(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}x
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={!config?.merchantConfigured || missingExternalId}
            className="mt-2 rounded-full bg-am-purple px-5 py-2.5 text-sm font-medium text-white hover:bg-am-purple-hover disabled:opacity-40"
          >
            Continuar para pagamento
          </button>
        </form>
      )}

      {step === "ready" && (
        <p className="text-sm text-am-ink-muted">
          Pedido #{orderId} criado. Toque no botão do Apple Pay para abrir a
          PaymentSheet.
        </p>
      )}

      {/*
        Container do botão GERENCIADO pelo appmax.min.js — o script troca o
        innerHTML disso por <button data-appmax-apple-pay> estilizado e
        registra o clique sozinho (ver FLUXO-APPLE-PAY.md). Fica
        SEMPRE renderizado (não só quando step === "ready"): o script só
        acha esse container e registra o listener uma vez, durante o
        `init()` — se ele não existir ainda nesse momento, o clique nunca
        funciona, em silêncio (F08). Por isso escondemos via CSS em vez de
        via condicional do React.
      */}
      <div
        className={`appmax-apple-pay-btn h-12 ${step === "ready" ? "" : "hidden"}`}
      />

      {/*
        Form de tokenização de cartão — `data-appmax-checkout` +
        `appmax-form-element` por campo, conforme /guides/appmax-js. Mesma
        lógica do container do Apple Pay acima (F08): fica sempre montado,
        só escondido via CSS, porque o script provavelmente também precisa
        achar esse form no DOM durante o `init()`. LEMBRETE (F26): só testa
        em produção — em sandbox o endpoint de tokenização do SDK devolve
        404 sempre, então nem o formato do `onSuccess` dá pra confirmar por
        aqui. Ver comentário no `declare global` e FLUXO-CARTAO.md.
      */}
      <form
        ref={cardFormRef}
        data-appmax-checkout
        method="POST"
        className={`flex flex-col gap-3 ${step === "ready" ? "" : "hidden"}`}
        onSubmit={() => setMessage(null)}
      >
        <p className="text-sm text-am-ink-muted">
          Ou pague com cartão de crédito:
        </p>
        <input
          required
          placeholder="Número do cartão"
          defaultValue={TEST_CARD.number}
          inputMode="numeric"
          appmax-form-element="number"
          name="card-number"
          className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
        />
        <input
          required
          placeholder="Nome impresso no cartão"
          appmax-form-element="holder_name"
          name="card-holder-name"
          value={cardHolderName}
          onChange={(e) => setCardHolderName(e.target.value)}
          className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
        />
        <div className="grid grid-cols-3 gap-3">
          <input
            required
            placeholder="MM"
            defaultValue={TEST_CARD.expirationMonth}
            inputMode="numeric"
            appmax-form-element="expiration_month"
            name="exp-month"
            className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
          />
          <input
            required
            placeholder="AAAA"
            defaultValue={TEST_CARD.expirationYear}
            inputMode="numeric"
            appmax-form-element="expiration_year"
            name="exp-year"
            className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
          />
          <input
            required
            placeholder="CVV"
            defaultValue={TEST_CARD.cvv}
            inputMode="numeric"
            appmax-form-element="cvv"
            name="cvv"
            className="rounded border border-am-border bg-white px-3 py-2 text-sm text-am-ink focus:outline-am-purple"
          />
        </div>
        <button
          type="submit"
          className="rounded-full bg-am-purple px-5 py-2.5 text-sm font-medium text-white hover:bg-am-purple-hover"
        >
          Pagar com cartão
        </button>
      </form>

      {step === "processing" && <p className="text-sm">Processando pagamento…</p>}

      {step === "success" && (
        <p className="text-sm text-am-success-text">{message}</p>
      )}

      {step === "error" && (
        <p className="text-sm text-am-danger-text">{message}</p>
      )}

      {message && step !== "success" && step !== "error" && (
        <p className="text-sm text-am-danger-text">{message}</p>
      )}

      {/*
        Recomeçar vale em qualquer estado depois que o pedido existe — não
        só no sucesso. Errar é justamente quando mais se quer tentar de
        novo, e antes disso a única saída era recarregar a página.
        Fica fora do `step === "ready"` pra sobreviver ao success/error.
      */}
      {step !== "form" && (
        <button
          type="button"
          onClick={startNewOrder}
          disabled={step === "processing"}
          className="w-fit rounded-full border border-am-border px-5 py-2.5 text-sm font-medium text-am-ink hover:bg-am-purple-soft disabled:opacity-40"
        >
          Fazer novo pedido
        </button>
      )}
    </div>
  );
}
